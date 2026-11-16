import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { HOME_STEP } from '../../src/modules/games/engine/board';
import { gameManager } from '../../src/modules/games/game.manager';
import { cancelGame, settleGame } from '../../src/modules/games/games.service';
import { getLeaderboard } from '../../src/modules/leaderboard/leaderboard.routes';
import { createRoom, getActiveContext, getRoomView, joinRoom, leaveRoom, quickMatch, setReady, startRoom, sweepExpiredRooms } from '../../src/modules/rooms/rooms.service';
import { debit } from '../../src/modules/wallet/wallet.service';
import { balanceOf, lockedOf, ludo, newPlayer, resetDb, scripted, setSetting } from '../helpers';

type Player = Awaited<ReturnType<typeof newPlayer>>;
beforeAll(resetDb);

const spec = (over: Partial<Parameters<typeof createRoom>[1]> = {}) => ({ name: 'Test room', modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 20, visibility: 'PRIVATE' as const, ...over });

async function startedGame(players: Player[], over: Partial<Parameters<typeof createRoom>[1]> = {}) {
  const room = await createRoom(players[0].id, spec({ maxPlayers: players.length, ...over }));
  for (const p of players.slice(1)) {
    await joinRoom(p.id, room.code);
    await setReady(p.id, room.code, true);
  }
  const gameId = await startRoom(players[0].id, room.code);
  return { gameId, code: room.code, state: ludo(gameId) };
}

/** Puts seat 0 one step from victory and plays the winning move. */
async function winAsHost(gameId: string, host: Player) {
  const state = ludo(gameId);
  state.players[0].tokens = [HOME_STEP, HOME_STEP, HOME_STEP, 55];
  state.turn = 0;
  state.phase = 'ROLL';
  gameManager.rng = scripted([1]);
  await gameManager.roll(gameId, host.id);
  await gameManager.move(gameId, host.id, 3);
}

let a: Player, b: Player;
beforeEach(async () => {
  [a, b] = [await newPlayer(), await newPlayer()];
  gameManager.rng = scripted([1]);
});

describe('room creation and joining', () => {
  it('creates a private room with a unique code and the host seated', async () => {
    const room = await createRoom(a.id, spec());
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(room).toMatchObject({ status: 'WAITING', entryPoints: 20, maxPlayers: 2, hostId: a.id, visibility: 'PRIVATE' });
    expect(room.players).toHaveLength(1);
    expect(await balanceOf(a.id)).toBe(100); // nothing is taken until the game starts
  });

  it('validates mode, table size and entry range', async () => {
    await expect(createRoom(a.id, spec({ modeKey: 'NOPE' }))).rejects.toMatchObject({ code: 'MODE_UNAVAILABLE' });
    await expect(createRoom(a.id, spec({ maxPlayers: 3 }))).rejects.toMatchObject({ code: 'PLAYERS_NOT_ALLOWED' });
    await expect(createRoom(a.id, spec({ entryPoints: 5 }))).rejects.toMatchObject({ code: 'ENTRY_OUT_OF_RANGE' });
    await expect(createRoom(a.id, spec({ entryPoints: 150 }))).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
  });

  it('joins by code, case-insensitively, and rejects unknown codes', async () => {
    const room = await createRoom(a.id, spec());
    await expect(joinRoom(b.id, 'ZZZZZZ')).rejects.toMatchObject({ status: 404 });
    const joined = await joinRoom(b.id, room.code.toLowerCase());
    expect(joined.players.map((p) => p.userId)).toEqual([a.id, b.id]);
    expect(joined.players[1].isReady).toBe(false);
  });

  it('refuses players who cannot afford the entry', async () => {
    const room = await createRoom(a.id, spec({ entryPoints: 60 }));
    await prisma.$transaction((tx) => debit(tx, b.id, 50, 'ADMIN_DEBIT', `t:${b.id}`));
    await expect(joinRoom(b.id, room.code)).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    expect((await getRoomView(room.code)).players).toHaveLength(1);
  });

  it('refuses joining a full room and being in two rooms', async () => {
    const c = await newPlayer();
    const room = await createRoom(a.id, spec());
    await joinRoom(b.id, room.code);
    await expect(joinRoom(c.id, room.code)).rejects.toMatchObject({ code: 'ROOM_FULL' });
    await expect(createRoom(b.id, spec())).rejects.toMatchObject({ code: 'ALREADY_IN_ROOM' });
  });

  it('never double-books seats under concurrent joins', async () => {
    const others = await Promise.all(Array.from({ length: 6 }, () => newPlayer()));
    const room = await createRoom(a.id, spec({ maxPlayers: 4 }));
    const results = await Promise.allSettled(others.map((p) => joinRoom(p.id, room.code)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const view = await getRoomView(room.code);
    expect(view.players.map((p) => p.seat).sort()).toEqual([0, 1, 2, 3]);
  });

  it('lets players leave before the start and hands the room over', async () => {
    const room = await createRoom(a.id, spec());
    await joinRoom(b.id, room.code);
    await leaveRoom(a.id, room.code);
    let view = await getRoomView(room.code);
    expect(view.hostId).toBe(b.id);
    await leaveRoom(b.id, room.code);
    view = await getRoomView(room.code);
    expect(view.status).toBe('CANCELLED');
  });

  it('only the host can start, and only when everyone is ready', async () => {
    const room = await createRoom(a.id, spec());
    await expect(startRoom(a.id, room.code)).rejects.toMatchObject({ code: 'NOT_ENOUGH_PLAYERS' });
    await joinRoom(b.id, room.code);
    await expect(startRoom(b.id, room.code)).rejects.toMatchObject({ status: 403 });
    await expect(startRoom(a.id, room.code)).rejects.toMatchObject({ code: 'PLAYERS_NOT_READY' });
  });
});

describe('game start and escrow', () => {
  it('locks every entry in escrow when the game starts', async () => {
    const { gameId, state, code } = await startedGame([a, b]);
    expect(state.players.map((p) => p.userId)).toEqual([a.id, b.id]);
    expect([await balanceOf(a.id), await lockedOf(a.id)]).toEqual([80, 20]);
    expect([await balanceOf(b.id), await lockedOf(b.id)]).toEqual([80, 20]);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game).toMatchObject({ status: 'ACTIVE', pool: 40, entryPoints: 20 });
    expect((await getRoomView(code)).status).toBe('IN_GAME');
    expect(await prisma.walletTransaction.count({ where: { refId: gameId, type: 'GAME_ENTRY' } })).toBe(2);
    expect((await getActiveContext(a.id)).gameIds).toEqual([gameId]);
    // Escrowed points cannot be spent elsewhere.
    await expect(prisma.$transaction((tx) => debit(tx, a.id, 90, 'ADMIN_DEBIT', `t2:${a.id}`))).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    await expect(startRoom(a.id, code)).rejects.toMatchObject({ code: 'ROOM_NOT_WAITING' });
  });

  it('does not start (and takes nothing) if a player can no longer pay', async () => {
    const room = await createRoom(a.id, spec({ entryPoints: 60 }));
    await joinRoom(b.id, room.code);
    await setReady(b.id, room.code, true);
    await prisma.$transaction((tx) => debit(tx, b.id, 50, 'ADMIN_DEBIT', `t:${b.id}`));
    await expect(startRoom(a.id, room.code)).rejects.toMatchObject({ code: 'PLAYER_INSUFFICIENT_POINTS' });
    expect([await balanceOf(a.id), await lockedOf(a.id)]).toEqual([100, 0]);
    const view = await getRoomView(room.code);
    expect(view.status).toBe('WAITING');
    expect(view.players.map((p) => p.userId)).toEqual([a.id]);
    expect(await prisma.game.count({ where: { roomId: view.id } })).toBe(0);
  });
});

describe('server-authoritative play', () => {
  it('rolls on the server, enforces turns and validates moves', async () => {
    const { gameId, state } = await startedGame([a, b]);
    await expect(gameManager.roll(gameId, b.id)).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    gameManager.rng = scripted([6]);
    await gameManager.roll(gameId, a.id);
    expect(state.dice).toBe(6);
    await expect(gameManager.roll(gameId, a.id)).rejects.toMatchObject({ code: 'WRONG_PHASE' });
    await expect(gameManager.move(gameId, b.id, 0)).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    await gameManager.move(gameId, a.id, 0);
    expect(state.players[0].tokens[0]).toBe(0);
    const outsider = await newPlayer();
    await expect(gameManager.roll(gameId, outsider.id)).rejects.toMatchObject({ status: 403 });

    const moves = await prisma.gameMove.findMany({ where: { gameId }, orderBy: { seq: 'asc' } });
    expect(moves.map((m) => m.type)).toEqual(['ROLL', 'MOVE']);
    const saved = (await prisma.gameState.findUniqueOrThrow({ where: { gameId } })).state as any;
    expect(saved.players[0].tokens[0]).toBe(0);
  });
});

describe('settlement', () => {
  it('pays the whole pool to the winner at 0% commission', async () => {
    const { gameId, code } = await startedGame([a, b]);
    await winAsHost(gameId, a);
    expect([await balanceOf(a.id), await lockedOf(a.id)]).toEqual([120, 0]);
    expect([await balanceOf(b.id), await lockedOf(b.id)]).toEqual([80, 0]);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId }, include: { results: true } });
    expect(game.status).toBe('FINISHED');
    expect(game.commissionAmount).toBe(0);
    expect(game.results.find((r) => r.userId === a.id)).toMatchObject({ isWinner: true, rank: 1, pointsWon: 40 });
    expect(game.results.find((r) => r.userId === b.id)).toMatchObject({ isWinner: false, rank: 2, pointsWon: 0 });
    expect((await getRoomView(code)).status).toBe('COMPLETED');
    const types = async (id: string) => (await prisma.walletTransaction.findMany({ where: { userId: id, refId: gameId }, orderBy: { createdAt: 'asc' } })).map((t) => t.type);
    expect(await types(a.id)).toEqual(['GAME_ENTRY', 'GAME_WIN']);
    expect(await types(b.id)).toEqual(['GAME_ENTRY', 'GAME_LOSS']);
    expect(gameManager.getState(gameId)).toBeUndefined();
    expect((await getActiveContext(a.id)).gameIds).toEqual([]);
  });

  it('pays a four-player pool from all four entries', async () => {
    const [c, d] = [await newPlayer(), await newPlayer()];
    const { gameId } = await startedGame([a, b, c, d], { entryPoints: 25 });
    await winAsHost(gameId, a);
    expect(await balanceOf(a.id)).toBe(175);
    for (const p of [b, c, d]) expect(await balanceOf(p.id)).toBe(75);
  });

  it('keeps the configured platform commission', async () => {
    await setSetting('platformCommissionPct', 10);
    const { gameId } = await startedGame([a, b], { entryPoints: 50 });
    await setSetting('platformCommissionPct', 0); // rate is fixed when the game starts
    await winAsHost(gameId, a);
    expect(await balanceOf(a.id)).toBe(140);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).commissionAmount).toBe(10);
  });

  it('cannot be settled twice, nor cancelled after settlement', async () => {
    const { gameId, state } = await startedGame([a, b]);
    await winAsHost(gameId, a);
    expect(await settleGame(gameId, state)).toBeNull();
    expect(await settleGame(gameId, state)).toBeNull();
    expect(await cancelGame(gameId, 'late')).toBeNull();
    expect(await balanceOf(a.id)).toBe(120);
    expect(await balanceOf(b.id)).toBe(80);
    expect(await prisma.gameResult.count({ where: { gameId } })).toBe(2);
    expect(await prisma.walletTransaction.count({ where: { refId: gameId } })).toBe(4);
  });

  it('settles exactly once under concurrent settlement attempts', async () => {
    const { gameId, state } = await startedGame([a, b]);
    state.players[0].tokens = [HOME_STEP, HOME_STEP, HOME_STEP, HOME_STEP];
    state.phase = 'DONE';
    state.result = { reason: 'HOME', winners: [0], ranking: [0, 1] };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => settleGame(gameId, state)));
    const applied = results.filter((r) => r.status === 'fulfilled' && r.value !== null);
    expect(applied).toHaveLength(1);
    expect(await balanceOf(a.id)).toBe(120);
    expect(await balanceOf(b.id)).toBe(80);
    await gameManager.cancel(gameId, 'cleanup'); // no-op on a settled game; frees the runtime
  });

  it('a player who leaves mid-game forfeits to the opponent', async () => {
    const { gameId } = await startedGame([a, b]);
    await gameManager.leave(gameId, a.id);
    expect(await balanceOf(a.id)).toBe(80);
    expect(await balanceOf(b.id)).toBe(120);
    const gp = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId, userId: a.id } });
    expect(gp.status).toBe('LEFT');
  });

  it('feeds the leaderboard', async () => {
    const { gameId } = await startedGame([a, b]);
    await winAsHost(gameId, a);
    const board = await getLeaderboard('daily', 500);
    const row = board.find((r) => r.userId === a.id)!;
    expect(row).toMatchObject({ matches: 1, wins: 1, winPct: 100, points: 40 });
    expect(board.find((r) => r.userId === b.id)).toMatchObject({ matches: 1, wins: 0, winPct: 0 });
    expect(board.indexOf(row)).toBeLessThan(board.findIndex((r) => r.userId === b.id));
  });
});

describe('cancellation and refunds', () => {
  it('refunds every escrowed entry and is idempotent', async () => {
    const { gameId, code, state } = await startedGame([a, b]);
    const out = await gameManager.cancel(gameId, 'Cancelled by admin');
    expect(out!.userIds.sort()).toEqual([a.id, b.id].sort());
    expect(await gameManager.cancel(gameId, 'again')).toBeNull();
    for (const p of [a, b]) expect([await balanceOf(p.id), await lockedOf(p.id)]).toEqual([100, 0]);
    expect(await prisma.walletTransaction.count({ where: { refId: gameId, type: 'REFUND' } })).toBe(2);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).status).toBe('CANCELLED');
    expect((await getRoomView(code)).status).toBe('CANCELLED');
    // A cancelled game can never be paid out afterwards.
    state.phase = 'DONE';
    state.result = { reason: 'HOME', winners: [0], ranking: [0, 1] };
    expect(await settleGame(gameId, state)).toBeNull();
    expect(await balanceOf(a.id)).toBe(100);
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'GAME_CANCELLED' } })).toBe(1);
  });
});

describe('reconnection', () => {
  it('keeps the game running while a player is away and restores it on return', async () => {
    const { gameId, state } = await startedGame([a, b]);
    await gameManager.setConnected(b.id, false);
    expect(state.players[1].connected).toBe(false);
    gameManager.rng = scripted([6]);
    await gameManager.roll(gameId, a.id);
    await gameManager.move(gameId, a.id, 1);
    await gameManager.setConnected(b.id, true);
    expect(state.players[1].connected).toBe(true);
    expect(gameManager.activeGameIds(b.id)).toEqual([gameId]);
    expect(ludo(gameId).players[0].tokens[1]).toBe(0);
    await gameManager.cancel(gameId, 'cleanup');
  });

  it('forfeits a player who stays away longer than the configured timeout', async () => {
    await setSetting('disconnectTimeoutSec', 5);
    const { gameId } = await startedGame([a, b]);
    const { vi } = await import('vitest');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await gameManager.setConnected(b.id, false);
      await vi.advanceTimersByTimeAsync(5_100);
    } finally {
      vi.useRealTimers();
    }
    await expect.poll(async () => (await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).status, { timeout: 5000 }).toBe('FINISHED');
    expect(await balanceOf(a.id)).toBe(120);
    expect(await balanceOf(b.id)).toBe(80);
    await setSetting('disconnectTimeoutSec', 60);
  });

  it('resumes persisted games after a server restart', async () => {
    const { gameId } = await startedGame([a, b]);
    gameManager.rng = scripted([6]);
    await gameManager.roll(gameId, a.id);
    await gameManager.move(gameId, a.id, 2);
    // Simulate a crash: drop all in-memory runtimes without touching the database.
    (gameManager as any).runtimes.clear();
    (gameManager as any).userGames.clear();
    expect(gameManager.getState(gameId)).toBeUndefined();

    await gameManager.resumeAll();
    const restored = ludo(gameId);
    expect(restored.players[0].tokens[2]).toBe(0);
    expect(restored.turn).toBe(0); // the six earned another roll
    await gameManager.setConnected(a.id, true);
    await gameManager.roll(gameId, a.id);
    await winAsHost(gameId, a);
    expect(await balanceOf(a.id)).toBe(120);
  });
});

describe('public matchmaking', () => {
  const mm = { modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 30 };

  it('pairs two players with the same mode and entry and starts automatically', async () => {
    const first = await quickMatch(a.id, mm);
    expect(first).toMatchObject({ isMatchmaking: true, status: 'WAITING' });
    const second = await quickMatch(b.id, mm);
    expect(second.code).toBe(first.code);
    expect(second.status).toBe('IN_GAME');
    expect(second.gameId).toBeTruthy();
    expect([await balanceOf(a.id), await lockedOf(b.id)]).toEqual([70, 30]);
    await gameManager.cancel(second.gameId!, 'cleanup');
  });

  it('does not mix different entries or modes', async () => {
    const first = await quickMatch(a.id, mm);
    const other = await quickMatch(b.id, { ...mm, entryPoints: 40 });
    expect(other.code).not.toBe(first.code);
    expect(other.status).toBe('WAITING');
    await leaveRoom(a.id, first.code);
    await leaveRoom(b.id, other.code);
  });

  it('matches simultaneous players into the same room', async () => {
    const [r1, r2] = await Promise.all([quickMatch(a.id, { ...mm, entryPoints: 35 }), quickMatch(b.id, { ...mm, entryPoints: 35 })]);
    expect(r1.code).toBe(r2.code);
    const view = await getRoomView(r1.code);
    expect(view.status).toBe('IN_GAME');
    await gameManager.cancel(view.gameId!, 'cleanup');
  });

  it('can be cancelled before a match, and times out', async () => {
    const room = await quickMatch(a.id, mm);
    await leaveRoom(a.id, room.code);
    expect((await getRoomView(room.code)).status).toBe('CANCELLED');

    const waiting = await quickMatch(a.id, mm);
    await prisma.gameRoom.update({ where: { code: waiting.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sweepExpiredRooms()).toBeGreaterThanOrEqual(1);
    expect((await getRoomView(waiting.code)).status).toBe('CANCELLED');
    expect(await balanceOf(a.id)).toBe(100);
    // Free to queue again afterwards.
    const again = await quickMatch(a.id, mm);
    await leaveRoom(a.id, again.code);
  });
});

describe('idle rooms', () => {
  it('closes an unused room after the idle timeout (default two minutes) and frees the host', async () => {
    const room = await createRoom(a.id, spec());
    const view = await getRoomView(room.code);
    const ttl = new Date(view.expiresAt!).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(110_000);
    expect(ttl).toBeLessThanOrEqual(120_000);
    expect(await sweepExpiredRooms()).toBe(0); // not yet

    await prisma.gameRoom.update({ where: { code: room.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sweepExpiredRooms()).toBe(1);
    expect((await getRoomView(room.code)).status).toBe('CANCELLED');
    await expect(joinRoom(b.id, room.code)).rejects.toMatchObject({ code: 'ROOM_CLOSED' });
    expect(await balanceOf(a.id)).toBe(100);
    await createRoom(a.id, spec()); // host is free to open a new room
  });

  it('restarts the timer when someone joins or readies up, and never closes a started game', async () => {
    const room = await createRoom(a.id, spec());
    await prisma.gameRoom.update({ where: { code: room.code }, data: { expiresAt: new Date(Date.now() + 5000) } });
    await joinRoom(b.id, room.code);
    const afterJoin = new Date((await getRoomView(room.code)).expiresAt!).getTime();
    expect(afterJoin - Date.now()).toBeGreaterThan(110_000);
    await prisma.gameRoom.update({ where: { code: room.code }, data: { expiresAt: new Date(Date.now() + 5000) } });
    await setReady(b.id, room.code, true);
    expect(new Date((await getRoomView(room.code)).expiresAt!).getTime() - Date.now()).toBeGreaterThan(110_000);

    const gameId = await startRoom(a.id, room.code);
    expect((await getRoomView(room.code)).expiresAt).toBeNull();
    expect(await sweepExpiredRooms()).toBe(0);
    expect((await getRoomView(room.code)).status).toBe('IN_GAME');
    await gameManager.cancel(gameId, 'cleanup');
  });
});
