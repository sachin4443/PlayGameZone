import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { authenticateToken, type AuthUser } from '../middlewares/auth';
import { gameManager, markRealtimeAttached } from '../modules/games/game.manager';
import { getRoomView, joinRoom, leaveRoom, setReady, startRoom } from '../modules/rooms/rooms.service';
import { realtime } from '../services/realtime';
import { AppError } from '../utils/errors';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void;

const codeSchema = z.object({ code: z.string().trim().min(4).max(10) });
const gameSchema = z.object({ gameId: z.string().min(1).max(40) });
const moveSchema = gameSchema.extend({ tokenIndex: z.number().int().min(0).max(3), dieIndex: z.number().int().min(0).max(4).optional() });
const readySchema = codeSchema.extend({ ready: z.boolean() });

/** Simple per-socket token bucket so a client cannot flood the game loop. */
function limiter(perSecond: number, burst: number) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function createSocketServer(http: HttpServer): Server {
  const io = new Server(http, { cors: { origin: env.corsOrigins, credentials: true }, maxHttpBufferSize: 16 * 1024 });
  realtime.attach(io);
  markRealtimeAttached();

  // Every connection must present a valid player JWT.
  io.use(async (socket, next) => {
    try {
      const user = await authenticateToken(socket.handshake.auth?.token);
      if (user.kind !== 'player') throw new Error('Player account required');
      socket.data.user = user;
      next();
    } catch (e: any) {
      next(new Error(e?.message ?? 'Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthUser;
    const allow = limiter(8, 16);
    socket.join(`user:${user.id}`);

    void prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    void gameManager.setConnected(user.id, true);

    /** Registers a validated, rate-limited, acknowledged event handler. */
    const on = <S extends z.ZodTypeAny>(event: string, schema: S, handler: (input: z.infer<S>) => Promise<unknown>) => {
      socket.on(event, async (payload: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
        if (!allow()) return reply({ ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down' } });
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid payload' } });
        try {
          reply({ ok: true, data: await handler(parsed.data) });
        } catch (e) {
          if (e instanceof AppError) return reply({ ok: false, error: { code: e.code, message: e.message } });
          console.error(`[socket] ${event} failed`, e);
          reply({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
        }
      });
    };

    // ── lobby ──
    on('join-room', codeSchema, async ({ code }) => {
      const view = await joinRoom(user.id, code);
      socket.join(`room:${view.code}`);
      return view;
    });
    /** Subscribe to lobby updates without taking a seat (used after joining over REST). */
    on('watch-room', codeSchema, async ({ code }) => {
      const view = await getRoomView(code);
      socket.join(`room:${view.code}`);
      return view;
    });
    on('leave-room', codeSchema, async ({ code }) => {
      await leaveRoom(user.id, code);
      socket.leave(`room:${code.toUpperCase()}`);
    });
    on('player-ready', readySchema, ({ code, ready }) => setReady(user.id, code, ready));
    on('start-game', codeSchema, async ({ code }) => ({ gameId: await startRoom(user.id, code) }));

    // ── game ──
    /** Subscribe to a game (players resync after reconnecting; others spectate read-only). */
    on('join-game', gameSchema, async ({ gameId }) => {
      const state = gameManager.getState(gameId);
      if (!state) throw new AppError(404, 'GAME_NOT_ACTIVE', 'This game is not running');
      socket.join(`game:${gameId}`);
      return { gameId, state, serverTime: Date.now() };
    });
    on('roll-dice', gameSchema, ({ gameId }) => gameManager.roll(gameId, user.id));
    on('move-token', moveSchema, ({ gameId, tokenIndex, dieIndex }) => gameManager.move(gameId, user.id, tokenIndex, dieIndex));
    on('leave-game', gameSchema, ({ gameId }) => gameManager.leave(gameId, user.id));

    socket.on('disconnect', () => {
      // Only when the player's last tab/device is gone.
      if (!realtime.isOnline(user.id)) void gameManager.setConnected(user.id, false);
    });
  });

  return io;
}
