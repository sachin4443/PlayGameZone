import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { gameManager } from '../../src/modules/games/game.manager';
import { createRoom } from '../../src/modules/rooms/rooms.service';
import { createSocketServer } from '../../src/sockets';
import { balanceOf, ludo, newPlayer, resetDb, scripted } from '../helpers';

let http: HttpServer;
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  await resetDb();
  http = createServer(createApp());
  createSocketServer(http);
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await new Promise((r) => http.close(r));
});

function client(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const call = (s: Socket, event: string, payload: unknown) => new Promise<any>((resolve) => s.emit(event, payload, resolve));
const once = <T = any>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));

describe('realtime multiplayer over Socket.IO', () => {
  it('refuses unauthenticated connections', async () => {
    await expect(client('garbage')).rejects.toThrow();
  });

  it('plays a full room → game flow with server-side dice and reconnection', async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    const [sa, sb] = [await client(a.token), await client(b.token)];
    const room = await createRoom(a.id, { name: 'socket room', modeKey: 'CLASSIC', maxPlayers: 2, entryPoints: 20, visibility: 'PRIVATE' });

    // Lobby
    expect((await call(sa, 'watch-room', { code: room.code })).ok).toBe(true);
    const roomUpdate = once(sa, 'room-state');
    const joined = await call(sb, 'join-room', { code: room.code });
    expect(joined.data.players).toHaveLength(2);
    expect((await roomUpdate).players).toHaveLength(2);
    expect((await call(sb, 'start-game', { code: room.code })).error.code).toBe('FORBIDDEN');
    expect((await call(sa, 'start-game', { code: room.code })).error.code).toBe('PLAYERS_NOT_READY');
    await call(sb, 'player-ready', { code: room.code, ready: true });

    // Start
    const startedForB = once(sb, 'game-started');
    const start = await call(sa, 'start-game', { code: room.code });
    expect(start.ok).toBe(true);
    const gameId = start.data.gameId as string;
    expect((await startedForB).gameId).toBe(gameId);

    // Dice come from the server; a client-supplied value is ignored.
    gameManager.rng = scripted([6]);
    expect((await call(sb, 'roll-dice', { gameId })).error.code).toBe('NOT_YOUR_TURN');
    const diceSeenByB = once(sb, 'dice-result');
    expect((await call(sa, 'roll-dice', { gameId, dice: 1, value: 1 })).ok).toBe(true);
    expect(await diceSeenByB).toMatchObject({ seat: 0, dice: 6 });

    // Moves are validated and broadcast to both players.
    expect((await call(sa, 'move-token', { gameId, tokenIndex: 9 })).ok).toBe(false);
    const stateSeenByB = once(sb, 'game-state');
    expect((await call(sa, 'move-token', { gameId, tokenIndex: 0 })).ok).toBe(true);
    const snapshot = await stateSeenByB;
    expect(snapshot.state.players[0].tokens[0]).toBe(0);
    expect(snapshot.events.some((e: any) => e.type === 'move')).toBe(true);

    // Disconnect → opponent is told → reconnect → state is restored.
    const gone = once(sa, 'player-disconnected');
    sb.disconnect();
    expect(await gone).toMatchObject({ seat: 1, userId: b.id });
    const back = once(sa, 'player-reconnected');
    const sb2 = await client(b.token);
    expect(await back).toMatchObject({ seat: 1 });
    const resync = await call(sb2, 'join-game', { gameId });
    expect(resync.data.state.players[0].tokens[0]).toBe(0);
    expect(resync.data.state.players[1].connected).toBe(true);

    // A token kill is announced, and the winner is decided and paid by the server.
    const state = ludo(gameId);
    state.players[0].tokens = [27, 56, 56, 56];
    state.players[1].tokens = [4, -10, -10, -10];
    gameManager.rng = scripted([3]);
    const kill = once(sb2, 'token-killed');
    await call(sa, 'roll-dice', { gameId });
    await call(sa, 'move-token', { gameId, tokenIndex: 0 });
    expect(await kill).toMatchObject({ seat: 0, victimSeat: 1, victimToken: 0 });

    state.players[0].tokens = [55, 56, 56, 56];
    gameManager.rng = scripted([1]);
    const finishedA = once(sa, 'game-finished');
    const finishedB = once(sb2, 'game-finished');
    await call(sa, 'roll-dice', { gameId });
    await call(sa, 'move-token', { gameId, tokenIndex: 0 });
    const fin = await finishedA;
    expect(fin.result.winners).toEqual([0]);
    expect(fin.payouts.find((p: any) => p.userId === a.id).pointsWon).toBe(40);
    expect((await finishedB).gameId).toBe(gameId);
    expect(await balanceOf(a.id)).toBe(120);
    expect(await balanceOf(b.id)).toBe(80);
    expect((await call(sa, 'roll-dice', { gameId })).ok).toBe(false);
  });
});
