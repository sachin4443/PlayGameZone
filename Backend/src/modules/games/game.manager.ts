import { randomInt } from 'crypto';
import type { Prisma } from '@prisma/client';
import { getSettings } from '../../config/settings';
import { prisma } from '../../lib/prisma';
import { realtime } from '../../services/realtime';
import { AppError, badRequest, forbidden, notFound } from '../../utils/errors';
import { EngineError, autoPlay, forfeit, move, roll, timeUp, type GameEvent, type GameState, type Rng } from './engine/engine';
import { cancelGame, settleGame, type SettleOutcome, type StartedGame } from './games.service';

/**
 * Runtime owner of every live game: holds the authoritative state in memory,
 * serialises actions per game, runs the server-side clocks (turn timer, game
 * clock, reconnect grace), persists each step and broadcasts it.
 *
 * Single-process by design; to scale out, pin a game to one node (sticky
 * routing) or move this state to Redis.
 */

interface Runtime {
  gameId: string;
  state: GameState;
  /** Tail of the per-game action queue: actions never interleave. */
  queue: Promise<unknown>;
  moveNo: number;
  turnTimer?: NodeJS.Timeout;
  gameTimer?: NodeJS.Timeout;
  graceTimers: Map<number, NodeJS.Timeout>;
}

type FinishListener = (outcome: SettleOutcome) => void | Promise<void>;

const DISCONNECTED_TURN_MS = 5_000;

class GameManager {
  private runtimes = new Map<string, Runtime>();
  private userGames = new Map<string, Set<string>>();
  private finishListeners: FinishListener[] = [];

  /** Server-side dice. Cryptographically strong, replaceable in tests. */
  rng: Rng = () => randomInt(1, 7);

  onFinished(fn: FinishListener) {
    this.finishListeners.push(fn);
  }

  // ── registration ────────────────────────────────────────────────

  async register(started: StartedGame) {
    const rt: Runtime = { gameId: started.gameId, state: started.state, queue: Promise.resolve(), moveNo: 0, graceTimers: new Map() };
    this.track(rt);
    for (const userId of started.userIds) realtime.joinUser(userId, `game:${rt.gameId}`);
    for (const p of rt.state.players) p.connected = realtime.isOnline(p.userId) || !realtimeAttached();
    await this.enqueue(rt, async () => {
      await this.armTurn(rt);
      await this.persist(rt, null);
      this.armClock(rt);
      for (const p of rt.state.players) if (!p.connected) await this.startGrace(rt, p.seat);
    });
    if (started.roomCode) realtime.toRoom(started.roomCode, 'game-started', { gameId: rt.gameId });
    for (const userId of started.userIds) {
      realtime.toUser(userId, 'game-started', { gameId: rt.gameId });
      realtime.toUser(userId, 'wallet-update', {});
    }
    this.broadcast(rt, []);
  }

  /** Reloads unfinished games after a server restart. */
  async resumeAll() {
    const games = await prisma.game.findMany({ where: { status: 'ACTIVE' }, include: { state: true, _count: { select: { moves: true } } } });
    for (const g of games) {
      if (!g.state) {
        await cancelGame(g.id, 'Game state was lost');
        continue;
      }
      const state = g.state.state as unknown as GameState;
      const rt: Runtime = { gameId: g.id, state, queue: Promise.resolve(), moveNo: g._count.moves, graceTimers: new Map() };
      this.track(rt);
      await this.enqueue(rt, async () => {
        if (state.phase === 'DONE') return this.conclude(rt);
        // Nobody is connected right after a restart: everyone gets a fresh reconnect window.
        for (const p of state.players) {
          if (!p.active) continue;
          p.connected = false;
          await this.startGrace(rt, p.seat);
        }
        await this.armTurn(rt);
        this.armClock(rt);
      });
    }
    return games.length;
  }

  private track(rt: Runtime) {
    this.runtimes.set(rt.gameId, rt);
    for (const p of rt.state.players) {
      if (!this.userGames.has(p.userId)) this.userGames.set(p.userId, new Set());
      this.userGames.get(p.userId)!.add(rt.gameId);
    }
  }

  private untrack(rt: Runtime) {
    clearTimeout(rt.turnTimer);
    clearTimeout(rt.gameTimer);
    for (const t of rt.graceTimers.values()) clearTimeout(t);
    rt.graceTimers.clear();
    this.runtimes.delete(rt.gameId);
    for (const p of rt.state.players) {
      const set = this.userGames.get(p.userId);
      set?.delete(rt.gameId);
      if (set && set.size === 0) this.userGames.delete(p.userId);
    }
  }

  // ── queries ─────────────────────────────────────────────────────

  getState(gameId: string): GameState | undefined {
    return this.runtimes.get(gameId)?.state;
  }

  activeGameIds(userId: string): string[] {
    const out: string[] = [];
    for (const id of this.userGames.get(userId) ?? []) {
      const p = this.runtimes.get(id)?.state.players.find((x) => x.userId === userId);
      if (p?.active) out.push(id);
    }
    return out;
  }

  liveCount() {
    return this.runtimes.size;
  }

  // ── player actions ──────────────────────────────────────────────

  roll(gameId: string, userId: string) {
    return this.playerAction(gameId, userId, (rt, seat) => roll(rt.state, seat, this.rng), 'ROLL');
  }

  move(gameId: string, userId: string, token: number, die?: number) {
    return this.playerAction(gameId, userId, (rt, seat) => move(rt.state, seat, token, die, this.rng), 'MOVE');
  }

  /** Voluntarily leaving a running game forfeits it. */
  leave(gameId: string, userId: string) {
    return this.playerAction(gameId, userId, (rt, seat) => forfeit(rt.state, seat, this.rng), 'FORFEIT');
  }

  private playerAction(gameId: string, userId: string, fn: (rt: Runtime, seat: number) => GameEvent[], type: string) {
    const rt = this.runtimes.get(gameId);
    if (!rt) throw notFound('Game');
    return this.enqueue(rt, async () => {
      const player = rt.state.players.find((p) => p.userId === userId);
      if (!player || !player.active) throw forbidden('You are not playing in this game');
      let events: GameEvent[];
      try {
        events = fn(rt, player.seat);
      } catch (e) {
        if (e instanceof EngineError) throw badRequest(e.code, e.message);
        throw e;
      }
      player.missed = 0;
      await this.commit(rt, events, { type, seat: player.seat, userId });
    });
  }

  // ── connectivity ────────────────────────────────────────────────

  async setConnected(userId: string, connected: boolean) {
    for (const gameId of [...(this.userGames.get(userId) ?? [])]) {
      const rt = this.runtimes.get(gameId);
      if (!rt) continue;
      await this.enqueue(rt, async () => {
        const p = rt.state.players.find((x) => x.userId === userId);
        if (!p || !p.active || p.connected === connected || rt.state.phase === 'DONE') return;
        p.connected = connected;
        if (connected) {
          clearTimeout(rt.graceTimers.get(p.seat));
          rt.graceTimers.delete(p.seat);
          realtime.joinUser(userId, `game:${gameId}`);
          realtime.toGame(gameId, 'player-reconnected', { gameId, seat: p.seat, userId });
        } else {
          const graceSec = await this.startGrace(rt, p.seat);
          realtime.toGame(gameId, 'player-disconnected', { gameId, seat: p.seat, userId, graceSec });
        }
        await this.persist(rt, null);
        this.broadcast(rt, []);
      }).catch(() => undefined);
    }
  }

  private async startGrace(rt: Runtime, seat: number): Promise<number> {
    const { disconnectTimeoutSec } = await getSettings();
    clearTimeout(rt.graceTimers.get(seat));
    const timer = setTimeout(() => {
      this.enqueue(rt, async () => {
        const p = rt.state.players.find((x) => x.seat === seat);
        if (!p || p.connected || !p.active) return;
        await this.commit(rt, forfeit(rt.state, seat, this.rng), { type: 'DISCONNECT_FORFEIT', seat, userId: p.userId });
      }).catch((e) => console.error('[game] grace timer failed', e));
    }, disconnectTimeoutSec * 1000);
    timer.unref();
    rt.graceTimers.set(seat, timer);
    return disconnectTimeoutSec;
  }

  // ── admin ───────────────────────────────────────────────────────

  async cancel(gameId: string, reason: string) {
    const rt = this.runtimes.get(gameId);
    const run = async () => {
      const out = await cancelGame(gameId, reason);
      if (out) realtime.toGame(gameId, 'game-cancelled', { gameId, reason });
      if (rt) {
        this.untrack(rt);
        realtime.leaveAll(`game:${gameId}`);
      }
      return out;
    };
    return rt ? this.enqueue(rt, run) : run();
  }

  // ── internals ───────────────────────────────────────────────────

  private enqueue<T>(rt: Runtime, fn: () => Promise<T>): Promise<T> {
    const next = rt.queue.then(fn, fn);
    rt.queue = next.catch(() => undefined);
    return next;
  }

  private async armTurn(rt: Runtime) {
    clearTimeout(rt.turnTimer);
    const s = rt.state;
    if (s.phase === 'DONE') return;
    const { turnTimeSec } = await getSettings();
    const current = s.players[s.turn];
    const ms = current.connected ? turnTimeSec * 1000 : Math.min(turnTimeSec * 1000, DISCONNECTED_TURN_MS);
    s.turnDeadline = Date.now() + ms;
    rt.turnTimer = setTimeout(() => {
      this.enqueue(rt, () => this.onTurnTimeout(rt)).catch((e) => console.error('[game] turn timer failed', e));
    }, ms);
    rt.turnTimer.unref();
  }

  private armClock(rt: Runtime) {
    clearTimeout(rt.gameTimer);
    const s = rt.state;
    if (s.endsAt === null || s.phase === 'DONE') return;
    rt.gameTimer = setTimeout(() => {
      this.enqueue(rt, async () => {
        if (rt.state.phase === 'DONE') return;
        await this.commit(rt, timeUp(rt.state), { type: 'TIME_UP', seat: -1 });
      }).catch((e) => console.error('[game] clock failed', e));
    }, Math.max(0, s.endsAt - Date.now()));
    rt.gameTimer.unref();
  }

  /** The player ran out of time: the server plays for them, or removes them after too many misses. */
  private async onTurnTimeout(rt: Runtime) {
    const s = rt.state;
    if (s.phase === 'DONE' || !this.runtimes.has(rt.gameId)) return;
    const { maxMissedTurns } = await getSettings();
    const p = s.players[s.turn];
    p.missed += 1;
    if (p.missed > maxMissedTurns) {
      await this.commit(rt, forfeit(s, p.seat, this.rng), { type: 'TIMEOUT_FORFEIT', seat: p.seat, userId: p.userId });
      return;
    }
    const events = autoPlay(s, this.rng);
    // Finish the whole turn in one go so idle players do not stall the table twice.
    if (s.phase === 'MOVE' && s.players[s.turn].seat === p.seat) events.push(...autoPlay(s, this.rng));
    await this.commit(rt, events, { type: 'AUTO', seat: p.seat, userId: p.userId });
  }

  private async commit(rt: Runtime, events: GameEvent[], meta: { type: string; seat: number; userId?: string }) {
    const done = rt.state.phase === 'DONE';
    if (!done) await this.armTurn(rt);
    await this.persist(rt, { ...meta, events });

    for (const e of events) {
      if (e.type === 'forfeit') {
        const p = rt.state.players.find((x) => x.seat === e.seat)!;
        clearTimeout(rt.graceTimers.get(e.seat));
        rt.graceTimers.delete(e.seat);
        await prisma.gamePlayer.updateMany({ where: { gameId: rt.gameId, userId: p.userId }, data: { status: 'LEFT' } });
      }
    }
    this.broadcast(rt, events);
    if (done) await this.conclude(rt);
  }

  private async persist(rt: Runtime, moveRow: { type: string; seat: number; userId?: string; events: GameEvent[] } | null) {
    const json = rt.state as unknown as Prisma.InputJsonValue;
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.gameState.update({ where: { gameId: rt.gameId }, data: { state: json, version: { increment: 1 } } }),
    ];
    if (moveRow) {
      rt.moveNo += 1;
      ops.push(
        prisma.gameMove.create({
          data: { gameId: rt.gameId, seq: rt.moveNo, seat: moveRow.seat, userId: moveRow.userId, type: moveRow.type, payload: moveRow.events as unknown as Prisma.InputJsonValue },
        }),
      );
    }
    await prisma.$transaction(ops);
  }

  /** Pushes the documented per-event messages plus the full authoritative snapshot. */
  private broadcast(rt: Runtime, events: GameEvent[]) {
    const gameId = rt.gameId;
    for (const e of events) {
      if (e.type === 'roll') realtime.toGame(gameId, 'dice-result', { gameId, seat: e.seat, dice: e.dice, steps: e.steps, power: e.power });
      else if (e.type === 'kill') realtime.toGame(gameId, 'token-killed', { gameId, seat: e.seat, victimSeat: e.victimSeat, victimToken: e.victimToken });
      else if (e.type === 'turn') realtime.toGame(gameId, 'player-turn', { gameId, seat: e.seat, extra: e.extra, deadline: rt.state.turnDeadline });
    }
    realtime.toGame(gameId, 'game-state', { gameId, state: rt.state, events, serverTime: Date.now() });
  }

  private async conclude(rt: Runtime) {
    this.untrack(rt);
    let outcome: SettleOutcome | null = null;
    try {
      outcome = await settleGame(rt.gameId, rt.state);
    } catch (e) {
      // Leave the game ACTIVE in the database: resumeAll() will retry settlement on restart.
      console.error('[game] settlement failed', rt.gameId, e);
      realtime.toGame(rt.gameId, 'game-finished', { gameId: rt.gameId, result: rt.state.result, payouts: null, pending: true });
      return;
    }
    realtime.toGame(rt.gameId, 'game-finished', { gameId: rt.gameId, result: rt.state.result, pool: outcome?.pool, commission: outcome?.commission, payouts: outcome?.payouts ?? null });
    realtime.leaveAll(`game:${rt.gameId}`);
    if (outcome) for (const fn of this.finishListeners) await Promise.resolve(fn(outcome)).catch((e) => console.error('[game] finish listener failed', e));
  }
}

let attached = false;
export const markRealtimeAttached = () => { attached = true; };
/** Without a socket server (unit/integration tests) players are treated as connected. */
const realtimeAttached = () => attached;

export const gameManager = new GameManager();
export type { AppError };
