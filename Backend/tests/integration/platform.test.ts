import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { registerWithPin } from '../../src/modules/auth/auth.service';
import { HOME_STEP } from '../../src/modules/games/engine/board';
import type { SnakesState } from '../../src/modules/games/engine/snakes';
import { gameManager } from '../../src/modules/games/game.manager';
import { getLeaderboard } from '../../src/modules/leaderboard/leaderboard.routes';
import { balanceOf, ludo, newPlayer, nextMobile, resetDb, scripted } from '../helpers';

const app = createApp();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
let root = '';

async function staffAccount(username: string, role: 'ROOT_OWNER' | 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT', password = 'Sup3r-secret-pw') {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash(password, 4), referralCode: `S-${username}`, welcomeBonusGranted: true, roles: { create: { roleId: r.id } } } });
  return login(username, password);
}
async function login(username: string, password: string) {
  const res = await request(app).post('/api/admin/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  await resetDb();
  gameManager.rng = scripted([1]);
  root = await staffAccount('owner', 'ROOT_OWNER');
});

describe('root owner and staff permissions', () => {
  it('forces a new staff account to change its password before anything else', async () => {
    const created = await request(app).post('/api/admin/staff').set(bearer(root)).send({ username: 'chief', password: 'Temp-pass-12345', role: 'SUPER_ADMIN' });
    expect(created.status).toBe(201);
    const token = await login('chief', 'Temp-pass-12345');
    const blocked = await request(app).get('/api/admin/dashboard').set(bearer(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get('/api/admin/me').set(bearer(token))).body.mustChangePassword).toBe(true);
    await request(app).post('/api/admin/auth/change-password').set(bearer(token)).send({ currentPassword: 'wrong-one-123', newPassword: 'Brand-new-pass-77' }).expect(400);
    await request(app).post('/api/admin/auth/change-password').set(bearer(token)).send({ currentPassword: 'Temp-pass-12345', newPassword: 'short1' }).expect(400);
    await request(app).post('/api/admin/auth/change-password').set(bearer(token)).send({ currentPassword: 'Temp-pass-12345', newPassword: 'Brand-new-pass-77' }).expect(200);
    await request(app).get('/api/admin/dashboard').set(bearer(token)).expect(200);
    await request(app).post('/api/admin/auth/login').send({ username: 'chief', password: 'Temp-pass-12345' }).expect(401);
  });

  it('keeps the hierarchy: root > super admin > staff', async () => {
    const chief = await login('chief', 'Brand-new-pass-77');
    const rootId = (await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } })).id;
    const chiefId = (await prisma.user.findUniqueOrThrow({ where: { username: 'chief' } })).id;

    // Nobody can touch the root owner – not even the root owner through the staff API.
    for (const token of [chief, root]) {
      await request(app).patch(`/api/admin/staff/${rootId}`).set(bearer(token)).send({ status: 'BLOCKED' }).expect(403);
      await request(app).delete(`/api/admin/staff/${rootId}`).set(bearer(token)).expect(403);
      await request(app).post(`/api/admin/staff/${rootId}/reset-password`).set(bearer(token)).send({ password: 'Hijack-pass-123' }).expect(403);
      await request(app).put(`/api/admin/staff/${rootId}/permissions`).set(bearer(token)).send({}).expect(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rootId } })).status).toBe('ACTIVE');
    // The root role cannot be handed out.
    await request(app).post('/api/admin/staff').set(bearer(root)).send({ username: 'second', password: 'Another-pass-123', role: 'ROOT_OWNER' }).expect(400);

    // A super admin cannot create or manage super admins, nor change itself.
    await request(app).post('/api/admin/staff').set(bearer(chief)).send({ username: 'peer', password: 'Another-pass-123', role: 'SUPER_ADMIN' }).expect(403);
    await request(app).patch(`/api/admin/staff/${chiefId}`).set(bearer(chief)).send({ role: 'ADMIN' }).expect(403);
    // …but can create ordinary staff, and cannot promote them to super admin.
    const made = await request(app).post('/api/admin/staff').set(bearer(chief)).send({ username: 'desk', password: 'Desk-pass-12345', role: 'SUPPORT' }).expect(201);
    await request(app).patch(`/api/admin/staff/${made.body.id}`).set(bearer(chief)).send({ role: 'SUPER_ADMIN' }).expect(403);

    // The root owner manages super admins.
    await request(app).patch(`/api/admin/staff/${chiefId}`).set(bearer(root)).send({ status: 'BLOCKED' }).expect(200);
    await request(app).get('/api/admin/dashboard').set(bearer(chief)).expect(403);
    await request(app).patch(`/api/admin/staff/${chiefId}`).set(bearer(root)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('enforces per-module actions on the API, not just in the menu', async () => {
    const deskId = (await prisma.user.findUniqueOrThrow({ where: { username: 'desk' } })).id;
    await request(app).post(`/api/admin/staff/${deskId}/reset-password`).set(bearer(root)).send({ password: 'Desk-pass-67890' }).expect(200);
    let desk = await login('desk', 'Desk-pass-67890');
    await request(app).post('/api/admin/auth/change-password').set(bearer(desk)).send({ currentPassword: 'Desk-pass-67890', newPassword: 'Desk-final-pass-1' }).expect(200);
    const player = await newPlayer();

    // Support defaults: read-only everywhere, no staff module.
    await request(app).get('/api/admin/users').set(bearer(desk)).expect(200);
    await request(app).post(`/api/admin/users/${player.id}/status`).set(bearer(desk)).send({ status: 'BLOCKED' }).expect(403);
    await request(app).get('/api/admin/staff').set(bearer(desk)).expect(403);
    await request(app).get('/api/admin/export/users').set(bearer(desk)).expect(403);

    // Root narrows the account to exactly: users (read, update, download).
    await request(app).put(`/api/admin/staff/${deskId}/permissions`).set(bearer(root)).send({ users: ['read', 'update', 'download'], nonsense: ['read'] }).expect(400);
    await request(app).put(`/api/admin/staff/${deskId}/permissions`).set(bearer(root)).send({ users: ['read', 'update', 'download'] }).expect(200);
    const me = await request(app).get('/api/admin/me').set(bearer(desk));
    expect(me.body.permissions.users).toEqual(['view', 'read', 'update', 'download']);
    expect(me.body.permissions.games).toEqual([]);

    await request(app).post(`/api/admin/users/${player.id}/status`).set(bearer(desk)).send({ status: 'BLOCKED', reason: 'test' }).expect(200);
    await request(app).post(`/api/admin/users/${player.id}/status`).set(bearer(desk)).send({ status: 'ACTIVE' }).expect(200);
    await request(app).post(`/api/admin/users/${player.id}/wallet-adjust`).set(bearer(desk)).send({ direction: 'CREDIT', amount: 50, reason: 'not allowed' }).expect(403);
    // Modules that are no longer granted are blocked even by direct URL.
    await request(app).get('/api/admin/games').set(bearer(desk)).expect(403);
    await request(app).get('/api/admin/dashboard').set(bearer(desk)).expect(403);
    await request(app).get('/api/admin/settings').set(bearer(desk)).expect(403);

    const csv = await request(app).get('/api/admin/export/users').set(bearer(desk)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(player.mobile);
    await request(app).get('/api/admin/export/audit').set(bearer(desk)).expect(403);

    // Staff cannot widen their own access, directly or through someone else's account.
    await request(app).put(`/api/admin/staff/${deskId}/permissions`).set(bearer(desk)).send({ staff: ['manage'], users: ['read'] }).expect(403);
    await prisma.staffPermission.update({ where: { userId_module: { userId: deskId, module: 'staff' } }, data: { actions: ['view', 'read', 'create', 'update', 'manage'] } });
    await request(app).put(`/api/admin/staff/${deskId}/permissions`).set(bearer(desk)).send({ wallet: ['update'] }).expect(403); // own account
    const other = await request(app).post('/api/admin/staff').set(bearer(root)).send({ username: 'other', password: 'Other-pass-12345', role: 'SUPPORT' });
    await request(app).put(`/api/admin/staff/${other.body.id}/permissions`).set(bearer(desk)).send({ wallet: ['update'] }).expect(403); // not a top role
    await request(app).post('/api/admin/staff').set(bearer(desk)).send({ username: 'sneaky', password: 'Sneaky-pass-123', role: 'ADMIN' }).expect(403);

    // Every sensitive action left a trail, attributable per staff member.
    const trail = await request(app).get(`/api/admin/audit-logs?adminId=${deskId}`).set(bearer(root)).expect(200);
    const actions = trail.body.items.map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_BLOCK', 'USER_UNBLOCK', 'EXPORT_DOWNLOAD', 'PASSWORD_CHANGE']));
    expect(await prisma.adminAuditLog.count({ where: { action: 'STAFF_PERMISSIONS_UPDATE' } })).toBe(1);

    // Deleting staff keeps the audit history but ends the account.
    await request(app).delete(`/api/admin/staff/${deskId}`).set(bearer(root)).expect(200);
    await request(app).get('/api/admin/users').set(bearer(desk)).expect(403);
    await request(app).post('/api/admin/auth/login').send({ username: 'desk', password: 'Desk-final-pass-1' }).expect(401);
    expect(await prisma.adminAuditLog.count({ where: { adminId: deskId } })).toBeGreaterThan(3);
  });
});

describe('account requests', () => {
  const pinLogin = (mobile: string, pin: string) => request(app).post('/api/auth/login').send({ mobile, pin });

  it('changes a mobile number only after staff approval', async () => {
    const mobile = nextMobile();
    const taken = nextMobile();
    const fresh = nextMobile();
    const me = await registerWithPin(mobile, '4826');
    await registerWithPin(taken, '4826');
    const auth = bearer(me.token);

    await request(app).post('/api/users/me/requests').set(auth).send({ type: 'MOBILE_CHANGE', reason: 'New SIM card' }).expect(400);
    const dup = await request(app).post('/api/users/me/requests').set(auth).send({ type: 'MOBILE_CHANGE', newMobile: taken, reason: 'New SIM card' });
    expect(dup.status).toBe(409);
    const made = await request(app).post('/api/users/me/requests').set(auth).send({ type: 'MOBILE_CHANGE', newMobile: fresh, reason: 'New SIM card' }).expect(201);
    await request(app).post('/api/users/me/requests').set(auth).send({ type: 'MOBILE_CHANGE', newMobile: nextMobile(), reason: 'Another one' }).expect(409);
    expect((await pinLogin(fresh, '4826')).status).toBe(401); // nothing changes until approval

    expect((await request(app).get('/api/admin/notifications/summary').set(bearer(root))).body.accountRequests).toBe(1);
    await request(app).post(`/api/admin/account-requests/${made.body.id}/approve`).set(bearer(root)).send({}).expect(200);
    await request(app).post(`/api/admin/account-requests/${made.body.id}/approve`).set(bearer(root)).send({}).expect(409);
    expect((await pinLogin(fresh, '4826')).status).toBe(200);
    expect((await pinLogin(mobile, '4826')).status).toBe(401);
    expect((await request(app).get('/api/users/me/requests').set(auth)).body.items[0]).toMatchObject({ status: 'APPROVED', newMobile: fresh });
    expect(await prisma.adminAuditLog.count({ where: { action: 'ACCOUNT_REQUEST_APPROVE_MOBILE_CHANGE', targetId: me.user.id } })).toBe(1);
  });

  it('rejects with a reason the player can read', async () => {
    const me = await registerWithPin(nextMobile(), '4826');
    const made = await request(app).post('/api/users/me/requests').set(bearer(me.token)).send({ type: 'ACCOUNT_DELETE', reason: 'Taking a break' }).expect(201);
    await request(app).post(`/api/admin/account-requests/${made.body.id}/reject`).set(bearer(root)).send({}).expect(400);
    await request(app).post(`/api/admin/account-requests/${made.body.id}/reject`).set(bearer(root)).send({ remark: 'Please contact support first' }).expect(200);
    expect((await request(app).get('/api/users/me/requests').set(bearer(me.token))).body.items[0]).toMatchObject({ status: 'REJECTED', adminRemark: 'Please contact support first' });
    await request(app).get('/api/wallet').set(bearer(me.token)).expect(200);
  });

  it('deletes an account on approval and frees the number for a new registration', async () => {
    const mobile = nextMobile();
    const me = await registerWithPin(mobile, '4826');
    const made = await request(app).post('/api/users/me/requests').set(bearer(me.token)).send({ type: 'ACCOUNT_DELETE', reason: 'No longer playing' }).expect(201);
    await request(app).post(`/api/admin/account-requests/${made.body.id}/approve`).set(bearer(root)).send({ remark: 'ok' }).expect(200);
    await request(app).get('/api/wallet').set(bearer(me.token)).expect(403);
    expect((await pinLogin(mobile, '4826')).status).toBe(401);
    expect(await prisma.walletTransaction.count({ where: { userId: me.user.id } })).toBe(1); // history kept
    const again = await registerWithPin(mobile, '7391');
    expect(again.user.id).not.toBe(me.user.id);
  });

  it('lets authorised staff set a new PIN for a player who forgot it', async () => {
    const mobile = nextMobile();
    const me = await registerWithPin(mobile, '4826');
    await request(app).post(`/api/admin/users/${me.user.id}/set-pin`).set(bearer(root)).send({ pin: '90' }).expect(400);
    await request(app).post(`/api/admin/users/${me.user.id}/set-pin`).set(bearer(root)).send({ pin: '9053' }).expect(200);
    expect((await pinLogin(mobile, '4826')).status).toBe(401);
    expect((await pinLogin(mobile, '9053')).status).toBe(200);
  });
});

describe('prize pools', () => {
  it('validates pools and pays the advertised prize', async () => {
    const auth = bearer(root);
    const body = { name: 'Classic 25', modeKey: 'CLASSIC', players: 2, entryPoints: 25, prizePoints: 47 };
    await request(app).post('/api/admin/prize-pools').set(auth).send({ ...body, prizePoints: 51 }).expect(400);
    await request(app).post('/api/admin/prize-pools').set(auth).send({ ...body, players: 3 }).expect(400);
    const made = await request(app).post('/api/admin/prize-pools').set(auth).send(body).expect(201);
    const poolId = made.body.id as string;

    const [a, b] = [await newPlayer(), await newPlayer()];
    let list = await request(app).get('/api/rooms/pools').set(bearer(a.token)).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: poolId, entryPoints: 25, prizePoints: 47, joined: 0, slotsLeft: 2, status: 'OPEN' });

    const first = await request(app).post(`/api/rooms/pools/${poolId}/join`).set(bearer(a.token)).expect(200);
    expect(first.body).toMatchObject({ status: 'WAITING', prizePool: 47 });
    expect(await balanceOf(a.id)).toBe(100); // seat reserved, entry taken at start
    list = await request(app).get('/api/rooms/pools').set(bearer(b.token));
    expect(list.body.items[0]).toMatchObject({ joined: 1, slotsLeft: 1, status: 'FILLING' });

    const second = await request(app).post(`/api/rooms/pools/${poolId}/join`).set(bearer(b.token)).expect(200);
    expect(second.body.status).toBe('IN_GAME');
    const gameId = second.body.gameId as string;
    expect([await balanceOf(a.id), await balanceOf(b.id)]).toEqual([75, 75]);

    const state = ludo(gameId);
    state.players[0].tokens = [HOME_STEP, HOME_STEP, HOME_STEP, 55];
    await gameManager.roll(gameId, a.id);
    await gameManager.move(gameId, a.id, 3);
    expect(await balanceOf(a.id)).toBe(75 + 47);
    expect(await balanceOf(b.id)).toBe(75);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game).toMatchObject({ status: 'FINISHED', pool: 50, fixedPrize: 47, commissionAmount: 3, prizePoolId: poolId });

    // Without enough points the seat is refused.
    const poor = await newPlayer();
    await request(app).put(`/api/admin/prize-pools/${poolId}`).set(auth).send({ ...body, entryPoints: 500, prizePoints: 900 }).expect(200);
    await request(app).post(`/api/rooms/pools/${poolId}/join`).set(bearer(poor.token)).expect(402);

    // A played pool is switched off rather than erased; it disappears from the lobby.
    const del = await request(app).delete(`/api/admin/prize-pools/${poolId}`).set(auth).expect(200);
    expect(del.body.disabledOnly).toBe(true);
    expect((await request(app).get('/api/rooms/pools').set(bearer(a.token))).body.items).toHaveLength(0);
    await request(app).post(`/api/rooms/pools/${poolId}/join`).set(bearer(a.token)).expect(400);
  });
});

describe('practice against computer players', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('plays Snake & Ladder against a bot with no points involved', async () => {
    const me = await newPlayer();
    const res = await request(app).post('/api/games/practice').set(bearer(me.token)).send({ modeKey: 'SNAKES', players: 2 }).expect(201);
    const gameId = res.body.gameId as string;
    const state = gameManager.getState(gameId) as SnakesState;
    expect(state.kind).toBe('SNAKES');
    expect(state.players.map((p) => !!p.bot)).toEqual([false, true]);
    expect(await balanceOf(me.id)).toBe(100);
    await request(app).post('/api/games/practice').set(bearer(me.token)).send({ modeKey: 'SNAKES', players: 2 }).expect(409);

    gameManager.rng = scripted([3]);
    await gameManager.roll(gameId, me.id);
    expect(state.players[0].pos).toBe(3);
    expect(state.turn).toBe(1);
    await expect(gameManager.move(gameId, me.id, 0)).rejects.toMatchObject({ code: 'WRONG_MODE' });
    // The computer takes its turn by itself.
    await expect.poll(() => state.players[1].pos, { timeout: 5000 }).toBe(3);
    expect(state.turn).toBe(0);
    const botMove = await prisma.gameMove.findFirstOrThrow({ where: { gameId, type: 'BOT' } });
    expect(botMove.seat).toBe(1);

    // Finish: the human wins from 97 with a three.
    state.players[0].pos = 97;
    await gameManager.roll(gameId, me.id);
    await expect.poll(async () => (await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).status).toBe('FINISHED');
    expect(await balanceOf(me.id)).toBe(100);
    expect(await prisma.walletTransaction.count({ where: { refId: gameId } })).toBe(0);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game).toMatchObject({ isPractice: true, pool: 0 });
    // Practice never reaches the leaderboard or the player's record.
    expect((await getLeaderboard('all', 500)).some((r) => r.userId === me.id)).toBe(false);
    expect((await request(app).get('/api/users/me/stats').set(bearer(me.token))).body.matches).toBe(0);
    gameManager.rng = scripted([1]);
  });

  it('runs a four-player Ludo table with three bots and ends when the human leaves', async () => {
    const me = await newPlayer();
    const res = await request(app).post('/api/games/practice').set(bearer(me.token)).send({ modeKey: 'CLASSIC', players: 4 }).expect(201);
    const gameId = res.body.gameId as string;
    const state = ludo(gameId);
    expect(state.players.map((p) => !!p.bot)).toEqual([false, true, true, true]);
    expect(new Set(state.players.map((p) => p.userId)).size).toBe(4);

    gameManager.rng = scripted([2]);
    await gameManager.roll(gameId, me.id); // no six: turn passes to the bots
    await wait(3800);
    expect(state.players.slice(1).every((p) => p.turnsTaken >= 1)).toBe(true);
    expect(state.players[state.turn].seat).toBe(0); // back to the human, who is never auto-forfeited by bots

    await gameManager.leave(gameId, me.id);
    await expect.poll(async () => (await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).status).toBe('CANCELLED');
    expect(gameManager.getState(gameId)).toBeUndefined();
    expect(await prisma.notification.count({ where: { userId: me.id } })).toBe(0);
    gameManager.rng = scripted([1]);
  });

  it('does not let a practice game satisfy a referral', async () => {
    const referrer = await newPlayer();
    const invited = await newPlayer(referrer.referralCode);
    const res = await request(app).post('/api/games/practice').set(bearer(invited.token)).send({ modeKey: 'SNAKES', players: 2 }).expect(201);
    const state = gameManager.getState(res.body.gameId) as SnakesState;
    state.players[0].pos = 99;
    await gameManager.roll(res.body.gameId, invited.id);
    await expect.poll(async () => (await prisma.game.findUniqueOrThrow({ where: { id: res.body.gameId } })).status).toBe('FINISHED');
    expect(await balanceOf(referrer.id)).toBe(100);
    expect((await prisma.referral.findFirstOrThrow({ where: { refereeId: invited.id } })).status).toBe('PENDING');
  });
});
