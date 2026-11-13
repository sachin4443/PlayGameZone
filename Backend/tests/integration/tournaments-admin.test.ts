import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { gameManager } from '../../src/modules/games/game.manager';
import { createRoom, joinRoom, setReady, startRoom } from '../../src/modules/rooms/rooms.service';
import { cancelTournament, getTournament, onGameSettled, registerForTournament, startTournament, unregisterFromTournament } from '../../src/modules/tournaments/tournaments.service';
import { balanceOf, newPlayer, resetDb, scripted } from '../helpers';

const app = createApp();
let adminToken = '';
let supportToken = '';

async function staff(username: string, role: 'SUPER_ADMIN' | 'SUPPORT') {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash('Sup3r-secret-pw', 4), referralCode: `S-${username}`, welcomeBonusGranted: true, roles: { create: { roleId: r.id } } } });
  const res = await request(app).post('/api/admin/auth/login').send({ username, password: 'Sup3r-secret-pw' }).expect(200);
  return res.body.token as string;
}

beforeAll(async () => {
  await resetDb();
  gameManager.onFinished(onGameSettled);
  gameManager.rng = scripted([1]);
  adminToken = await staff('root', 'SUPER_ADMIN');
  supportToken = await staff('helper', 'SUPPORT');
});

async function makeTournament(over: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/admin/tournaments').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Friday Cup', modeKey: 'CLASSIC', entryPoints: 10, capacity: 4, startsAt: new Date(Date.now() + 3600_000).toISOString(), ...over });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Finishes a tournament match by having the given player's opponent forfeit. */
async function winMatch(tournamentId: string, round: number, winnerId: string) {
  const t = await getTournament(tournamentId);
  const m = t.matches.find((x) => x.round === round && (x.player1?.userId === winnerId || x.player2?.userId === winnerId))!;
  const loser = m.player1!.userId === winnerId ? m.player2!.userId : m.player1!.userId;
  await gameManager.leave(m.gameId!, loser);
  return loser;
}

describe('tournaments', () => {
  it('runs a four-player bracket and pays prizes by rank', async () => {
    const id = await makeTournament();
    const players = await Promise.all([newPlayer(), newPlayer(), newPlayer(), newPlayer()]);
    for (const p of players) await registerForTournament(p.id, id);
    for (const p of players) expect(await balanceOf(p.id)).toBe(90);
    await expect(registerForTournament(players[0].id, id)).rejects.toMatchObject({ code: 'ALREADY_REGISTERED' });
    const late = await newPlayer();
    await expect(registerForTournament(late.id, id)).rejects.toMatchObject({ code: 'TOURNAMENT_FULL' });

    expect(await startTournament(id)).toBe('started');
    expect(await startTournament(id)).toBe('skipped');
    let t = await getTournament(id);
    expect(t).toMatchObject({ status: 'RUNNING', totalRounds: 2, prizePool: 40 });
    const semis = t.matches.filter((m) => m.round === 1);
    expect(semis).toHaveLength(2);
    expect(semis.every((m) => m.status === 'IN_PROGRESS' && m.gameId)).toBe(true);
    // Tournament games take no extra entry.
    for (const p of players) expect(await balanceOf(p.id)).toBe(90);

    const finalists = semis.map((m) => m.player1!.userId);
    const semiLosers = [await winMatch(id, 1, finalists[0]), await winMatch(id, 1, finalists[1])];
    t = await getTournament(id);
    const final = t.matches.find((m) => m.round === 2)!;
    expect(final.status).toBe('IN_PROGRESS');
    expect([final.player1!.userId, final.player2!.userId].sort()).toEqual([...finalists].sort());

    await winMatch(id, 2, finalists[0]);
    t = await getTournament(id);
    expect(t.status).toBe('COMPLETED');
    expect(t.winner!.userId).toBe(finalists[0]);
    expect(await balanceOf(finalists[0])).toBe(90 + 28); // 70% of 40
    expect(await balanceOf(finalists[1])).toBe(90 + 12); // 30% of 40
    for (const l of semiLosers) expect(await balanceOf(l)).toBe(90);
    expect(t.players.find((p) => p.userId === finalists[0])).toMatchObject({ finalRank: 1, prize: 28, status: 'WINNER' });
    expect(t.players.find((p) => p.userId === semiLosers[0])).toMatchObject({ finalRank: 3, status: 'ELIMINATED' });
    expect(await prisma.walletTransaction.count({ where: { refId: id, type: 'TOURNAMENT_REWARD' } })).toBe(2);
  });

  it('gives byes when the bracket is not full', async () => {
    const id = await makeTournament({ capacity: 8, bonusPool: 100 });
    const players = await Promise.all([newPlayer(), newPlayer(), newPlayer()]);
    for (const p of players) await registerForTournament(p.id, id);
    await startTournament(id);
    let t = await getTournament(id);
    expect(t.matches.filter((m) => m.round === 1).map((m) => m.status).sort()).toEqual(['BYE', 'IN_PROGRESS']);
    const live = t.matches.find((m) => m.status === 'IN_PROGRESS')!;
    await winMatch(id, 1, live.player1!.userId);
    t = await getTournament(id);
    const final = t.matches.find((m) => m.round === 2)!;
    await winMatch(id, 2, final.player2!.userId);
    t = await getTournament(id);
    expect(t.status).toBe('COMPLETED');
    expect(await balanceOf(final.player2!.userId)).toBe(90 + Math.floor(130 * 0.7));
  });

  it('refunds on unregister and on cancellation, without double refunds', async () => {
    const id = await makeTournament();
    const [p, q] = [await newPlayer(), await newPlayer()];
    await registerForTournament(p.id, id);
    await unregisterFromTournament(p.id, id);
    expect(await balanceOf(p.id)).toBe(100);
    await registerForTournament(p.id, id); // re-registering pays again
    expect(await balanceOf(p.id)).toBe(90);
    await registerForTournament(q.id, id);
    await cancelTournament(id, 'test');
    await expect(cancelTournament(id, 'again')).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' });
    expect(await balanceOf(p.id)).toBe(100);
    expect(await balanceOf(q.id)).toBe(100);
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: q.id } });
    expect([w.totalEarned, w.totalSpent]).toEqual([100, 0]);
  });

  it('cancels with refunds when fewer than two players registered', async () => {
    const id = await makeTournament();
    const p = await newPlayer();
    await registerForTournament(p.id, id);
    expect(await startTournament(id)).toBe('cancelled');
    expect(await balanceOf(p.id)).toBe(100);
  });
});

describe('referrals', () => {
  it('rewards both sides once, after the invited player finishes a first game', async () => {
    const referrer = await newPlayer();
    const invited = await newPlayer(referrer.referralCode);
    expect(await balanceOf(referrer.id)).toBe(100); // nothing yet
    const play = async () => {
      const room = await createRoom(invited.id, { name: 'ref game', modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 10, visibility: 'PRIVATE' });
      const opp = await newPlayer();
      await joinRoom(opp.id, room.code);
      await setReady(opp.id, room.code, true);
      const gameId = await startRoom(invited.id, room.code);
      await gameManager.leave(gameId, opp.id);
    };
    await play();
    expect(await balanceOf(referrer.id)).toBe(120);
    expect(await balanceOf(invited.id)).toBe(100 + 10 + 10);
    await play();
    expect(await balanceOf(referrer.id)).toBe(120);
    expect(await prisma.walletTransaction.count({ where: { type: 'REFERRAL_BONUS' } })).toBe(2);
  });

  it('ignores self-referral, unknown codes and referrals on later logins', async () => {
    const p = await newPlayer('NOSUCHCODE');
    expect(await prisma.referral.count({ where: { refereeId: p.id } })).toBe(0);
    const other = await newPlayer();
    const { loginWithVerifiedMobile } = await import('../../src/modules/auth/auth.service');
    await loginWithVerifiedMobile(p.mobile, other.referralCode);
    expect(await prisma.referral.count({ where: { refereeId: p.id } })).toBe(0);
  });
});

describe('admin panel API', () => {
  it('rejects wrong credentials and player logins', async () => {
    await request(app).post('/api/admin/auth/login').send({ username: 'root', password: 'wrong-password' }).expect(401);
    await request(app).post('/api/admin/auth/login').send({ username: 'ghost', password: 'whatever-pass' }).expect(401);
    await request(app).get('/api/admin/dashboard').expect(401);
  });

  it('credits and debits wallets with an audit trail, idempotently', async () => {
    const p = await newPlayer();
    const requestId = '7b0e5a52-6d0f-4c58-9d5e-0b4f4a3a9c11';
    const send = () => request(app).post(`/api/admin/users/${p.id}/wallet-adjust`).set('Authorization', `Bearer ${adminToken}`).send({ direction: 'CREDIT', amount: 500, reason: 'Compensation', requestId });
    expect((await send()).body).toMatchObject({ applied: true, balanceAfter: 600 });
    expect((await send()).body).toMatchObject({ applied: false });
    expect(await balanceOf(p.id)).toBe(600);
    await request(app).post(`/api/admin/users/${p.id}/wallet-adjust`).set('Authorization', `Bearer ${adminToken}`).send({ direction: 'DEBIT', amount: 700, reason: 'Too much' }).expect(402);
    await request(app).post(`/api/admin/users/${p.id}/wallet-adjust`).set('Authorization', `Bearer ${adminToken}`).send({ direction: 'DEBIT', amount: 100 }).expect(400);
    const logs = await prisma.adminAuditLog.findMany({ where: { targetId: p.id } });
    expect(logs.map((l) => l.action)).toEqual(['WALLET_CREDIT']);
    const tx = await prisma.walletTransaction.findFirstOrThrow({ where: { userId: p.id, type: 'ADMIN_CREDIT' } });
    expect(tx.createdById).toBeTruthy();
  });

  it('enforces staff roles', async () => {
    const p = await newPlayer();
    await request(app).get('/api/admin/users').set('Authorization', `Bearer ${supportToken}`).expect(200);
    await request(app).post(`/api/admin/users/${p.id}/wallet-adjust`).set('Authorization', `Bearer ${supportToken}`).send({ direction: 'CREDIT', amount: 5, reason: 'nope' }).expect(403);
    await request(app).put('/api/admin/settings').set('Authorization', `Bearer ${supportToken}`).send({ welcomeBonusPoints: 5000 }).expect(403);
    // A staff token is not a player token.
    await request(app).get('/api/wallet').set('Authorization', `Bearer ${adminToken}`).expect(403);
  });

  it('blocks and unblocks players', async () => {
    const p = await newPlayer();
    await request(app).post(`/api/admin/users/${p.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'BLOCKED', reason: 'abuse' }).expect(200);
    await request(app).get('/api/wallet').set('Authorization', `Bearer ${p.token}`).expect(403);
    await request(app).post(`/api/admin/users/${p.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    await request(app).get('/api/wallet').set('Authorization', `Bearer ${p.token}`).expect(200);
  });

  it('updates validated settings and game mode rules', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    await request(app).put('/api/admin/settings').set(auth).send({ platformCommissionPct: 80 }).expect(400);
    await request(app).put('/api/admin/settings').set(auth).send({ madeUp: 1 }).expect(400);
    await request(app).put('/api/admin/settings').set(auth).send({ platformCommissionPct: 5 }).expect(200);
    const s = await request(app).get('/api/admin/settings').set(auth);
    expect(s.body.items.find((i: any) => i.key === 'platformCommissionPct').value).toBe(5);
    await request(app).put('/api/admin/settings').set(auth).send({ platformCommissionPct: 0 }).expect(200);

    const modes = await request(app).get('/api/admin/modes').set(auth);
    const mania = modes.body.items.find((m: any) => m.key === 'MANIA');
    await request(app).patch(`/api/admin/modes/${mania.id}`).set(auth).send({ rules: { turnLimit: 9999 } }).expect(400);
    const ok = await request(app).patch(`/api/admin/modes/${mania.id}`).set(auth).send({ rules: { turnLimit: 15 } }).expect(200);
    expect(ok.body.effectiveRules.turnLimit).toBe(15);
    expect(await prisma.adminAuditLog.count({ where: { action: { in: ['SETTINGS_UPDATE', 'MODE_UPDATE'] } } })).toBe(3);
  });

  it('cancels a live game with refunds and reports dashboard totals', async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    const room = await createRoom(a.id, { name: 'to cancel', modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 20, visibility: 'PUBLIC' });
    await joinRoom(b.id, room.code);
    await setReady(b.id, room.code, true);
    const gameId = await startRoom(a.id, room.code);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const dash = await request(app).get('/api/admin/dashboard').set(auth).expect(200);
    expect(dash.body.liveGames).toBeGreaterThanOrEqual(1);
    expect(dash.body.pointsInEscrow).toBeGreaterThanOrEqual(40);
    await request(app).post(`/api/admin/games/${gameId}/cancel`).set(auth).send({ reason: 'Stuck table' }).expect(200);
    await request(app).post(`/api/admin/games/${gameId}/cancel`).set(auth).send({ reason: 'Stuck table' }).expect(409);
    expect(await balanceOf(a.id)).toBe(100);
    expect(await balanceOf(b.id)).toBe(100);
    const list = await request(app).get('/api/admin/games?status=CANCELLED').set(auth);
    expect(list.body.items.some((g: any) => g.id === gameId)).toBe(true);
  });
});
