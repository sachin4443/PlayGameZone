import { type Color, HOME_STEP, LAST_TRACK_STEP, START_CELLS, STAR_CELLS, TRACK_LEN, YARD, colorsFor, globalCell, isOnTrack } from './board';
import type { Rules } from './rules';

/**
 * Pure, deterministic Ludo rules engine.
 *
 * It knows nothing about sockets, databases or clocks: the caller supplies the
 * random source and the current time. Every public function validates the action
 * against the authoritative state and throws EngineError if it is not allowed, so
 * a client can never roll its own dice, move out of turn or make an illegal move.
 */

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Returns an integer 1..6. */
export type Rng = () => number;

export interface PlayerState {
  seat: number;
  userId: string;
  name: string;
  avatar: string;
  color: Color;
  tokens: number[];
  score: number;
  kills: number;
  turnsTaken: number;
  /** false once the player has forfeited / been removed. */
  active: boolean;
  /** Consecutive turns played by the server because the player timed out. */
  missed: number;
  connected: boolean;
  /** Computer-controlled practice opponent. */
  bot?: boolean;
}

export interface LegalMove {
  token: number;
  /** Index into the shared dice pool (PICK mode only). */
  die?: number;
  from: number;
  to: number;
}

export interface GameResultState {
  reason: 'HOME' | 'SCORE' | 'TIME' | 'TURNS' | 'FORFEIT';
  /** Seats of the winner(s); more than one only on an exact score tie. */
  winners: number[];
  /** Every seat, best first. */
  ranking: number[];
}

export interface GameState {
  /** Absent on games stored before Snake & Ladder existed. */
  kind?: 'LUDO';
  rules: Rules;
  players: PlayerState[];
  /** Index into `players` of whoever must act. */
  turn: number;
  phase: 'ROLL' | 'MOVE' | 'DONE';
  dice: number | null;
  /** Distance the rolled die moves a token (differs from `dice` on a power roll). */
  steps: number | null;
  power: boolean;
  pool: number[];
  legal: LegalMove[];
  sixStreak: number;
  seq: number;
  startedAt: number;
  endsAt: number | null;
  turnDeadline: number | null;
  result: GameResultState | null;
}

export type GameEvent =
  | { type: 'roll'; seat: number; dice: number; steps: number; power: boolean }
  | { type: 'pool'; pool: number[] }
  | { type: 'no-move'; seat: number }
  | { type: 'three-sixes'; seat: number }
  | { type: 'move'; seat: number; token: number; from: number; to: number; dice: number }
  | { type: 'kill'; seat: number; victimSeat: number; victimToken: number; cell: number }
  | { type: 'home'; seat: number; token: number }
  | { type: 'turn'; seat: number; extra: boolean }
  | { type: 'forfeit'; seat: number }
  | { type: 'finish'; result: GameResultState };

export interface NewPlayer {
  userId: string;
  name: string;
  avatar: string;
  bot?: boolean;
}

export function createGame(rules: Rules, players: NewPlayer[], rng: Rng, now: number, firstSeat = 0): GameState {
  if (players.length < 2 || players.length > 4) throw new EngineError('BAD_PLAYERS', 'A game needs 2 to 4 players');
  const colors = colorsFor(players.length);
  const state: GameState = {
    kind: 'LUDO',
    rules,
    players: players.map((p, seat) => ({
      seat,
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      color: colors[seat],
      tokens: Array(rules.tokensPerPlayer).fill(rules.sixToRelease ? YARD : 0),
      score: 0,
      kills: 0,
      turnsTaken: 0,
      active: true,
      missed: 0,
      connected: true,
      ...(p.bot ? { bot: true } : {}),
    })),
    turn: firstSeat >= 0 && firstSeat < players.length ? firstSeat : 0,
    phase: 'ROLL',
    dice: null,
    steps: null,
    power: false,
    pool: [],
    legal: [],
    sixStreak: 0,
    seq: 0,
    startedAt: now,
    endsAt: rules.timeLimitSec > 0 ? now + rules.timeLimitSec * 1000 : null,
    turnDeadline: null,
    result: null,
  };
  if (rules.dice === 'PICK') {
    state.pool = Array.from({ length: rules.dicePoolSize }, () => rollDie(rng));
    beginPickTurn(state, rng, []);
  }
  return state;
}

function rollDie(rng: Rng): number {
  const v = rng();
  if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`RNG produced an invalid die value: ${v}`);
  return v;
}

const current = (s: GameState) => s.players[s.turn];
const hasTurnsLeft = (s: GameState, p: PlayerState) => s.rules.turnLimit === 0 || p.turnsTaken < s.rules.turnLimit;
const homeCount = (p: PlayerState) => p.tokens.filter((t) => t === HOME_STEP).length;

function isSafeCell(rules: Rules, cell: number): boolean {
  return START_CELLS.has(cell) || (rules.starSafe && STAR_CELLS.has(cell));
}

/** Where a token would land, or null if the move is not allowed. */
function destination(s: GameState, p: PlayerState, from: number, die: number, distance: number): number | null {
  if (from === HOME_STEP) return null;
  if (from === YARD) return s.rules.sixToRelease && die === 6 ? 0 : null;
  const to = from + distance;
  if (from <= LAST_TRACK_STEP && to > LAST_TRACK_STEP && s.rules.killRequiredForHome && p.kills === 0) {
    // Home column is closed: keep circling the ring.
    return to - TRACK_LEN;
  }
  return to > HOME_STEP ? null : to;
}

function movesFor(s: GameState, p: PlayerState, die: number, distance: number, dieIndex?: number): LegalMove[] {
  const out: LegalMove[] = [];
  p.tokens.forEach((from, token) => {
    const to = destination(s, p, from, die, distance);
    if (to !== null) out.push({ token, from, to, ...(dieIndex === undefined ? {} : { die: dieIndex }) });
  });
  return out;
}

function assertTurn(s: GameState, seat: number, phase: 'ROLL' | 'MOVE') {
  if (s.phase === 'DONE') throw new EngineError('GAME_OVER', 'The game is over');
  if (current(s).seat !== seat) throw new EngineError('NOT_YOUR_TURN', 'It is not your turn');
  if (s.phase !== phase) throw new EngineError('WRONG_PHASE', phase === 'ROLL' ? 'You have already rolled' : 'Roll the dice first');
}

/** Rolls the die for the current player (ROLL mode). The value comes from `rng`, never from the client. */
export function roll(s: GameState, seat: number, rng: Rng): GameEvent[] {
  if (s.rules.dice !== 'ROLL') throw new EngineError('WRONG_MODE', 'This mode uses the shared dice');
  assertTurn(s, seat, 'ROLL');
  const p = current(s);
  const events: GameEvent[] = [];

  const dice = rollDie(rng);
  p.turnsTaken += 1;
  s.seq += 1;
  const power = s.rules.powerTurnEvery > 0 && p.turnsTaken % s.rules.powerTurnEvery === 0;
  const steps = power ? dice * 2 : dice;
  s.dice = dice;
  s.steps = steps;
  s.power = power;
  events.push({ type: 'roll', seat, dice, steps, power });

  s.sixStreak = dice === 6 ? s.sixStreak + 1 : 0;
  if (s.rules.maxConsecutiveSixes > 0 && s.sixStreak >= s.rules.maxConsecutiveSixes) {
    events.push({ type: 'three-sixes', seat });
    endTurn(s, false, rng, events);
    return events;
  }

  s.legal = movesFor(s, p, dice, steps);
  if (s.legal.length === 0) {
    events.push({ type: 'no-move', seat });
    endTurn(s, dice === 6 && s.rules.extraTurnOnSix, rng, events);
    return events;
  }
  s.phase = 'MOVE';
  return events;
}

/** Moves a token. In PICK mode `dieIndex` selects which shared die to use. */
export function move(s: GameState, seat: number, token: number, dieIndex: number | undefined, rng: Rng): GameEvent[] {
  assertTurn(s, seat, 'MOVE');
  const p = current(s);
  const pick = s.rules.dice === 'PICK';
  const chosen = s.legal.find((m) => m.token === token && (pick ? m.die === dieIndex : true));
  if (!chosen) throw new EngineError('ILLEGAL_MOVE', 'That move is not allowed');

  const events: GameEvent[] = [];
  const dice = pick ? s.pool[chosen.die!] : s.dice!;
  const distance = pick ? dice : s.steps!;
  if (pick) p.turnsTaken += 1;
  s.seq += 1;

  p.tokens[token] = chosen.to;
  p.score += s.rules.scorePerStep * (chosen.from === YARD ? 1 : distance);
  events.push({ type: 'move', seat, token, from: chosen.from, to: chosen.to, dice });

  let killed = false;
  if (isOnTrack(chosen.to)) {
    const cell = globalCell(p.color, chosen.to);
    if (!isSafeCell(s.rules, cell)) {
      for (const other of s.players) {
        if (other.seat === seat || !other.active) continue;
        const onCell = other.tokens
          .map((steps, i) => ({ steps, i }))
          .filter((t) => isOnTrack(t.steps) && globalCell(other.color, t.steps) === cell);
        if (onCell.length === 0 || (s.rules.blockSafe && onCell.length >= 2)) continue;
        for (const t of onCell) {
          other.score = Math.max(0, other.score - s.rules.scorePerStep * Math.max(0, t.steps));
          other.tokens[t.i] = s.rules.sixToRelease ? YARD : 0;
          p.kills += 1;
          p.score += s.rules.scoreKill;
          killed = true;
          events.push({ type: 'kill', seat, victimSeat: other.seat, victimToken: t.i, cell });
        }
      }
    }
  }

  const reachedHome = chosen.to === HOME_STEP;
  if (reachedHome) {
    p.score += s.rules.scoreHome;
    events.push({ type: 'home', seat, token });
  }

  if (pick) {
    s.pool[chosen.die!] = rollDie(rng);
    events.push({ type: 'pool', pool: [...s.pool] });
  }

  if (homeCount(p) === s.rules.tokensPerPlayer) {
    finish(s, s.rules.winBy === 'HOME' ? 'HOME' : 'SCORE', events, s.rules.winBy === 'HOME' ? seat : undefined);
    return events;
  }

  const extra =
    (dice === 6 && s.rules.extraTurnOnSix) || (killed && s.rules.extraTurnOnKill) || (reachedHome && s.rules.extraTurnOnHome);
  endTurn(s, extra, rng, events);
  return events;
}

/** Passes play on (or back to the same player on an extra turn). Ends the game when nobody can act. */
function endTurn(s: GameState, extra: boolean, rng: Rng, events: GameEvent[]) {
  s.dice = null;
  s.steps = null;
  s.power = false;
  s.legal = [];
  const p = current(s);

  if (extra && p.active && hasTurnsLeft(s, p)) {
    s.phase = 'ROLL';
    events.push({ type: 'turn', seat: p.seat, extra: true });
  } else {
    s.sixStreak = 0;
    let next = -1;
    for (let i = 1; i <= s.players.length; i++) {
      const idx = (s.turn + i) % s.players.length;
      const cand = s.players[idx];
      if (cand.active && hasTurnsLeft(s, cand)) {
        next = idx;
        break;
      }
    }
    if (next === -1) {
      finish(s, 'TURNS', events);
      return;
    }
    s.turn = next;
    s.phase = 'ROLL';
    events.push({ type: 'turn', seat: s.players[next].seat, extra: false });
  }
  if (s.rules.dice === 'PICK') beginPickTurn(s, rng, events);
}

/** PICK mode has no roll phase: the turn opens straight into choosing a die and a token. */
function beginPickTurn(s: GameState, rng: Rng, events: GameEvent[]) {
  // Bounded: every pass consumes one of the player's limited turns.
  for (let guard = 0; guard < 1000 && s.phase !== 'DONE'; guard++) {
    const p = current(s);
    s.legal = s.pool.flatMap((die, i) => movesFor(s, p, die, die, i));
    if (s.legal.length > 0) {
      s.phase = 'MOVE';
      return;
    }
    // Nothing playable with any shared die: the turn is spent and the pool is re-rolled.
    p.turnsTaken += 1;
    s.seq += 1;
    events.push({ type: 'no-move', seat: p.seat });
    s.pool = s.pool.map(() => rollDie(rng));
    events.push({ type: 'pool', pool: [...s.pool] });
    advanceWithoutPick(s, events);
  }
  // Pathological configuration (nobody can ever move): end the game instead of hanging.
  if (s.phase !== 'DONE') finish(s, 'TURNS', events);
}

function advanceWithoutPick(s: GameState, events: GameEvent[]) {
  let next = -1;
  for (let i = 1; i <= s.players.length; i++) {
    const idx = (s.turn + i) % s.players.length;
    const cand = s.players[idx];
    if (cand.active && hasTurnsLeft(s, cand)) {
      next = idx;
      break;
    }
  }
  if (next === -1) {
    finish(s, 'TURNS', events);
    return;
  }
  s.turn = next;
  events.push({ type: 'turn', seat: s.players[next].seat, extra: false });
}

function rankPlayers(s: GameState): PlayerState[] {
  return [...s.players].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (s.rules.winBy === 'HOME' ? homeCount(b) - homeCount(a) : 0) ||
      b.score - a.score ||
      homeCount(b) - homeCount(a) ||
      b.kills - a.kills ||
      a.seat - b.seat,
  );
}

function finish(s: GameState, reason: GameResultState['reason'], events: GameEvent[], winnerSeat?: number) {
  const ranked = rankPlayers(s);
  let winners: number[];
  if (winnerSeat !== undefined) {
    winners = [winnerSeat];
    ranked.sort((a, b) => Number(b.seat === winnerSeat) - Number(a.seat === winnerSeat));
  } else {
    const top = ranked[0];
    const tied = (p: PlayerState) =>
      p.active === top.active && p.score === top.score && homeCount(p) === homeCount(top) && p.kills === top.kills;
    winners = ranked.filter(tied).map((p) => p.seat);
  }
  s.phase = 'DONE';
  s.dice = null;
  s.steps = null;
  s.legal = [];
  s.turnDeadline = null;
  s.result = { reason, winners, ranking: ranked.map((p) => p.seat) };
  events.push({ type: 'finish', result: s.result });
}

/** Removes a player (left, timed out or disconnected for too long). */
export function forfeit(s: GameState, seat: number, rng: Rng): GameEvent[] {
  if (s.phase === 'DONE') return [];
  const p = s.players.find((x) => x.seat === seat);
  if (!p || !p.active) return [];
  const events: GameEvent[] = [];
  p.active = false;
  // Forfeited tokens leave the board so they can neither block nor be captured.
  p.tokens = p.tokens.map((t) => (t === HOME_STEP ? t : YARD));
  s.seq += 1;
  events.push({ type: 'forfeit', seat });

  const remaining = s.players.filter((x) => x.active);
  if (remaining.length <= 1) {
    finish(s, 'FORFEIT', events, remaining[0]?.seat);
    return events;
  }
  if (current(s).seat === seat) endTurn(s, false, rng, events);
  else if (s.rules.dice === 'PICK' && s.phase === 'MOVE') {
    // Board changed: refresh the current player's options.
    const cur = current(s);
    s.legal = s.pool.flatMap((die, i) => movesFor(s, cur, die, die, i));
  }
  return events;
}

/** Ends a timed game when the server clock runs out. */
export function timeUp(s: GameState): GameEvent[] {
  if (s.phase === 'DONE') return [];
  const events: GameEvent[] = [];
  s.seq += 1;
  finish(s, 'TIME', events);
  return events;
}

/** Plays the pending action for the current player (used when their turn timer expires). */
export function autoPlay(s: GameState, rng: Rng): GameEvent[] {
  if (s.phase === 'DONE') return [];
  const seat = current(s).seat;
  if (s.phase === 'ROLL') return roll(s, seat, rng);
  const best = chooseMove(s);
  return move(s, seat, best.token, best.die, rng);
}

/**
 * Simple playing strategy used for computer players and for turns the server
 * plays on behalf of an absent player: capture if possible, otherwise get home,
 * leave the yard, reach a safe cell, and finally advance the leading token.
 */
export function chooseMove(s: GameState): LegalMove {
  const p = current(s);
  const score = (m: LegalMove): number => {
    let v = m.to;
    if (m.to === HOME_STEP) v += 400;
    if (m.from === YARD) v += 250;
    if (isOnTrack(m.to)) {
      const cell = globalCell(p.color, m.to);
      const safe = isSafeCell(s.rules, cell);
      if (safe) v += 60;
      else {
        for (const other of s.players) {
          if (other.seat === p.seat || !other.active) continue;
          const there = other.tokens.filter((t) => isOnTrack(t) && globalCell(other.color, t) === cell).length;
          if (there > 0 && !(s.rules.blockSafe && there >= 2)) v += 600;
        }
      }
    }
    return v;
  };
  return [...s.legal].sort((a, b) => score(b) - score(a))[0];
}
