import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { gameManager } from '../../src/modules/games/game.manager';
import { firstTurn } from '../../src/modules/games/games.service';
import { createRoom, getRoomView, joinRoom, quickMatch, setFirstTurn, setReady, startRoom } from '../../src/modules/rooms/rooms.service';
import { debit } from '../../src/modules/wallet/wallet.service';
import { balanceOf, lockedOf, ludo, newPlayer, resetDb, scripted, setSetting } from '../helpers';

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let admin = '';

beforeAll(async () => {
  await resetDb();
  gameManager.rng = scripted([1]);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  await prisma.user.create({ data: { username: 'boss', passwordHash: await bcrypt.hash('Sup3r-secret-pw', 4), referralCode: 'S-boss', welcomeBonusGranted: true, roles: { create: { roleId: role.id } } } });
  admin = (await request(app).post('/api/admin/auth/login').send({ username: 'boss', password: 'Sup3r-secret-pw' })).body.token;
});

const ask = (token: string, body: object) => request(app).post('/api/wallet/requests').set(bearer(token)).send(body);
const decide = (id: string, action: 'approve' | 'reject', body: object = {}) => request(app).post(`/api/admin/point-requests/${id}/${action}`).set(bearer(admin)).send(body);
const types = async (userId: string) => (await prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map((t) => t.type);

describe('requests to add virtual points', () => {
  it('credits only after approval, exactly once', async () => {
    const p = await newPlayer();
    const made = await ask(p.token, { type: 'ADD', amount: 250, note: 'Need more to join the cup' });
    expect(made.status).toBe(201);
    expect(await balanceOf(p.id)).toBe(100); // nothing until staff approve
    expect((await ask(p.token, { type: 'ADD', amount: 50 })).body.error.code).toBe('REQUEST_PENDING');
    expect((await request(app).get('/api/admin/notifications/summary').set(bearer(admin))).body.pointRequests).toBeGreaterThanOrEqual(1);

    const results = await Promise.all(Array.from({ length: 4 }, () => decide(made.body.id, 'approve')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await balanceOf(p.id)).toBe(350);
    expect(await types(p.id)).toEqual(['WELCOME_BONUS', 'POINTS_REQUEST']);
    await decide(made.body.id, 'reject', { remark: 'changed my mind' }).expect(409);
    expect(await balanceOf(p.id)).toBe(350);

    const mine = await request(app).get('/api/wallet/requests').set(bearer(p.token)).expect(200);
    expect(mine.body.items[0]).toMatchObject({ type: 'ADD', amount: 250, status: 'APPROVED' });
    expect(await prisma.adminAuditLog.count({ where: { action: 'POINT_REQUEST_APPROVE_ADD', targetId: p.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: p.id, type: 'POINT_REQUEST' } })).toBe(1);
  });

  it('a rejected request changes nothing and carries the reason', async () => {
    const p = await newPlayer();
    const made = await ask(p.token, { type: 'ADD', amount: 500 });
    await decide(made.body.id, 'reject').expect(400); // a reason is required
    await decide(made.body.id, 'reject', { remark: 'Too many requests this week' }).expect(200);
    expect(await balanceOf(p.id)).toBe(100);
    expect(await types(p.id)).toEqual(['WELCOME_BONUS']);
    const mine = await request(app).get('/api/wallet/requests').set(bearer(p.token));
    expect(mine.body.items[0]).toMatchObject({ status: 'REJECTED', adminRemark: 'Too many requests this week' });
    expect((await ask(p.token, { type: 'ADD', amount: 20 })).status).toBe(201); // may ask again afterwards
  });

  it('validates amounts and respects the configuration', async () => {
    const p = await newPlayer();
    expect((await ask(p.token, { type: 'ADD', amount: 0 })).status).toBe(400);
    expect((await ask(p.token, { type: 'ADD', amount: 12.5 })).status).toBe(400);
    expect((await ask(p.token, { type: 'ADD', amount: 10001 })).body.error.code).toBe('AMOUNT_TOO_LARGE');
    await setSetting('pointRequestsEnabled', false);
    expect((await ask(p.token, { type: 'ADD', amount: 10 })).status).toBe(403);
    await setSetting('pointRequestsEnabled', true);
    // Players cannot decide requests.
    await request(app).post('/api/admin/point-requests/x/approve').set(bearer(p.token)).send({}).expect(403);
  });
});

describe('requests to withdraw virtual points', () => {
  it('reserves the points on submission and removes them on approval', async () => {
    const p = await newPlayer();
    expect((await ask(p.token, { type: 'WITHDRAW', amount: 101 })).status).toBe(402);
    const made = await ask(p.token, { type: 'WITHDRAW', amount: 60 });
    expect(made.status).toBe(201);
    expect([await balanceOf(p.id), await lockedOf(p.id)]).toEqual([40, 60]);
    // Reserved points cannot be requested again or spent elsewhere.
    expect((await ask(p.token, { type: 'WITHDRAW', amount: 30 })).body.error.code).toBe('REQUEST_PENDING');
    await expect(prisma.$transaction((tx) => debit(tx, p.id, 50, 'ADMIN_DEBIT', `x:${p.id}`))).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    await expect(createRoom(p.id, { name: 'too rich', modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 50, visibility: 'PRIVATE' })).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });

    await decide(made.body.id, 'approve', { remark: 'ok' }).expect(200);
    await decide(made.body.id, 'approve').expect(409);
    expect([await balanceOf(p.id), await lockedOf(p.id)]).toEqual([40, 0]);
    expect(await types(p.id)).toEqual(['WELCOME_BONUS', 'WITHDRAW_HOLD', 'WITHDRAW']);
  });

  it('returns the reserved points when rejected', async () => {
    const p = await newPlayer();
    const made = await ask(p.token, { type: 'WITHDRAW', amount: 70 });
    await decide(made.body.id, 'reject', { remark: 'Not this time' }).expect(200);
    expect([await balanceOf(p.id), await lockedOf(p.id)]).toEqual([100, 0]);
    expect(await types(p.id)).toEqual(['WELCOME_BONUS', 'WITHDRAW_HOLD', 'WITHDRAW_RELEASE']);
    const last = await prisma.walletTransaction.findFirstOrThrow({ where: { userId: p.id, type: 'WITHDRAW_RELEASE' } });
    expect(last).toMatchObject({ amount: 70, balanceAfter: 100, lockedAfter: 0 });
  });

  it('cannot reserve the same points twice under concurrent requests', async () => {
    const p = await newPlayer();
    const results = await Promise.all(Array.from({ length: 5 }, () => ask(p.token, { type: 'WITHDRAW', amount: 80 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect([await balanceOf(p.id), await lockedOf(p.id)]).toEqual([20, 80]);
    expect(await prisma.pointRequest.count({ where: { userId: p.id } })).toBe(1);
  });

  it('stores no payment information at all', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'PointRequest'`;
    expect(columns.map((c) => c.column_name).sort()).toEqual(['adminRemark', 'amount', 'createdAt', 'decidedAt', 'decidedById', 'id', 'note', 'status', 'type', 'userId']);
  });
});

describe('first turn and room management', () => {
  const spec = { name: 'Turn room', modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 10, visibility: 'PRIVATE' as const };
  async function lobby() {
    const [a, b] = [await newPlayer(), await newPlayer()];
    const room = await createRoom(a.id, spec);
    await joinRoom(b.id, room.code);
    await setReady(b.id, room.code, true);
    return { a, b, code: room.code, id: room.id };
  }

  it('draws the first turn at random unless the room names a player', async () => {
    const original = firstTurn.pick;
    try {
      firstTurn.pick = () => 1;
      const { a, b, code } = await lobby();
      expect((await getRoomView(code)).firstTurnUserId).toBeNull();
      const gameId = await startRoom(a.id, code);
      expect(ludo(gameId).players[ludo(gameId).turn].userId).toBe(b.id);
      await gameManager.cancel(gameId, 'cleanup');
    } finally {
      firstTurn.pick = original;
    }
  });

  it('lets the host choose who starts, visibly to everyone, and only among seated players', async () => {
    const { a, b, code } = await lobby();
    const outsider = await newPlayer();
    await request(app).post(`/api/rooms/${code}/first-turn`).set(bearer(b.token)).send({ userId: b.id }).expect(403); // not the host
    await request(app).post(`/api/rooms/${code}/first-turn`).set(bearer(a.token)).send({ userId: outsider.id }).expect(400);
    const set = await request(app).post(`/api/rooms/${code}/first-turn`).set(bearer(a.token)).send({ userId: b.id }).expect(200);
    expect(set.body).toMatchObject({ firstTurnUserId: b.id, firstTurnSetBy: 'HOST' });
    // The guest sees the same setting.
    expect((await request(app).get(`/api/rooms/${code}`).set(bearer(b.token))).body.firstTurnUserId).toBe(b.id);
    const gameId = await startRoom(a.id, code);
    const state = ludo(gameId);
    expect(state.players[state.turn].userId).toBe(b.id);
    await expect(gameManager.roll(gameId, a.id)).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    // Changing it after the start is refused, and the dice stay the server's.
    await expect(setFirstTurn(code, a.id, 'HOST', a.id)).rejects.toMatchObject({ code: 'ROOM_STARTED' });
    gameManager.rng = scripted([4]);
    await gameManager.roll(gameId, b.id);
    expect(state.players[0].turnsTaken + state.players[1].turnsTaken).toBe(1);
    gameManager.rng = scripted([1]);
    await gameManager.cancel(gameId, 'cleanup');
  });

  it('lets authorised staff set or clear it, with an audit entry the host cannot override', async () => {
    const { a, b, code, id } = await lobby();
    await request(app).patch(`/api/admin/rooms/${id}`).set(bearer(admin)).send({ firstTurnUserId: b.id }).expect(200);
    expect(await getRoomView(code)).toMatchObject({ firstTurnUserId: b.id, firstTurnSetBy: 'ADMIN' });
    await request(app).post(`/api/rooms/${code}/first-turn`).set(bearer(a.token)).send({ userId: a.id }).expect(403);
    await request(app).patch(`/api/admin/rooms/${id}`).set(bearer(admin)).send({ firstTurnUserId: null }).expect(200);
    expect(await getRoomView(code)).toMatchObject({ firstTurnUserId: null, firstTurnSetBy: null });
    expect(await prisma.adminAuditLog.count({ where: { action: 'ROOM_FIRST_TURN', targetId: id } })).toBe(2);
    // Players cannot use the staff route.
    await request(app).patch(`/api/admin/rooms/${id}`).set(bearer(a.token)).send({ firstTurnUserId: a.id }).expect(403);

    await request(app).post(`/api/admin/rooms/${id}/close`).set(bearer(admin)).send({ reason: 'Abandoned room' }).expect(200);
    expect((await getRoomView(code)).status).toBe('CANCELLED');
    await request(app).post(`/api/admin/rooms/${id}/close`).set(bearer(admin)).send({ reason: 'Abandoned room' }).expect(409);
    expect(await balanceOf(a.id)).toBe(100);
  });

  it('never allows a first-turn choice on matchmaking tables', async () => {
    const a = await newPlayer();
    const room = await quickMatch(a.id, { modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 10 });
    await request(app).post(`/api/rooms/${room.code}/first-turn`).set(bearer(a.token)).send({ userId: a.id }).expect(400);
    const res = await request(app).patch(`/api/admin/rooms/${room.id}`).set(bearer(admin)).send({ firstTurnUserId: a.id });
    expect(res.body.error.code).toBe('RANDOM_ONLY');
  });

  it('clears the choice when the chosen player leaves', async () => {
    const { a, b, code } = await lobby();
    await setFirstTurn(code, b.id, 'HOST', a.id);
    const { leaveRoom } = await import('../../src/modules/rooms/rooms.service');
    await leaveRoom(b.id, code);
    expect((await getRoomView(code)).firstTurnUserId).toBeNull();
  });
});
