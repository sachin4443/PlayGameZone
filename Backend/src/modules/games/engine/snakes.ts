import { EngineError, type GameResultState, type NewPlayer, type Rng } from './engine';
import type { SnakesRules } from './rules';

/**
 * Snake & Ladder rules engine. Same contract as the Ludo engine: pure,
 * deterministic, server-side dice, and every action is validated.
 */

export const FINISH = 100;
/** [from, to] pairs. A square is never both a ladder foot and a snake head. */
export const LADDERS: [number, number][] = [[4, 25], [13, 46], [33, 49], [42, 63], [50, 69], [62, 81], [74, 92]];
export const SNAKES: [number, number][] = [[27, 5], [40, 3], [43, 18], [54, 31], [66, 45], [76, 58], [89, 53], [99, 41]];
const JUMP = new Map<number, number>([...LADDERS, ...SNAKES]);

const PIECE_COLORS = ['red', 'blue', 'green', 'yellow'] as const;

export interface SnakesPlayer {
  seat: number;
  userId: string;
  name: string;
  avatar: string;
  color: (typeof PIECE_COLORS)[number];
  /** 0 = not on the board yet, 100 = finished. */
  pos: number;
  score: number;
  turnsTaken: number;
  active: boolean;
  missed: number;
  connected: boolean;
  bot?: boolean;
}

export interface SnakesState {
  kind: 'SNAKES';
  rules: SnakesRules;
  board: { ladders: [number, number][]; snakes: [number, number][] };
  players: SnakesPlayer[];
  turn: number;
  phase: 'ROLL' | 'DONE';
  dice: number | null;
  sixStreak: number;
  seq: number;
  startedAt: number;
  endsAt: number | null;
  turnDeadline: number | null;
  result: GameResultState | null;
}

export type SnakesEvent =
  | { type: 'roll'; seat: number; dice: number; steps: number; power: boolean }
  | { type: 'step'; seat: number; from: number; to: number }
  | { type: 'ladder' | 'snake'; seat: number; from: number; to: number }
  | { type: 'no-move'; seat: number }
  | { type: 'three-sixes'; seat: number }
  | { type: 'turn'; seat: number; extra: boolean }
  | { type: 'forfeit'; seat: number }
  | { type: 'finish'; result: GameResultState };

export function createSnakesGame(rules: SnakesRules, players: NewPlayer[], now: number, firstSeat = 0): SnakesState {
  if (players.length < 2 || players.length > 4) throw new EngineError('BAD_PLAYERS', 'A game needs 2 to 4 players');
  return {
    kind: 'SNAKES',
    rules,
    board: { ladders: LADDERS, snakes: SNAKES },
    players: players.map((p, seat) => ({
      seat, userId: p.userId, name: p.name, avatar: p.avatar, color: PIECE_COLORS[seat],
      pos: 0, score: 0, turnsTaken: 0, active: true, missed: 0, connected: true, ...(p.bot ? { bot: true } : {}),
    })),
    turn: firstSeat >= 0 && firstSeat < players.length ? firstSeat : 0,
    phase: 'ROLL',
    dice: null,
    sixStreak: 0,
    seq: 0,
    startedAt: now,
    endsAt: null,
    turnDeadline: null,
    result: null,
  };
}

function finish(s: SnakesState, reason: GameResultState['reason'], winnerSeat: number | undefined, events: SnakesEvent[]) {
  const ranked = [...s.players].sort((a, b) => Number(b.seat === winnerSeat) - Number(a.seat === winnerSeat) || Number(b.active) - Number(a.active) || b.pos - a.pos || a.seat - b.seat);
  s.phase = 'DONE';
  s.turnDeadline = null;
  s.result = { reason, winners: [winnerSeat ?? ranked[0].seat], ranking: ranked.map((p) => p.seat) };
  events.push({ type: 'finish', result: s.result });
}

function passTurn(s: SnakesState, extra: boolean, events: SnakesEvent[]) {
  const p = s.players[s.turn];
  if (extra && p.active) {
    events.push({ type: 'turn', seat: p.seat, extra: true });
    return;
  }
  s.sixStreak = 0;
  for (let i = 1; i <= s.players.length; i++) {
    const idx = (s.turn + i) % s.players.length;
    if (s.players[idx].active) {
      s.turn = idx;
      events.push({ type: 'turn', seat: s.players[idx].seat, extra: false });
      return;
    }
  }
}

/** Rolls and moves in one step: there is nothing to choose in Snake & Ladder. */
export function snakesRoll(s: SnakesState, seat: number, rng: Rng): SnakesEvent[] {
  if (s.phase === 'DONE') throw new EngineError('GAME_OVER', 'The game is over');
  const p = s.players[s.turn];
  if (p.seat !== seat) throw new EngineError('NOT_YOUR_TURN', 'It is not your turn');
  const dice = rng();
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new Error(`RNG produced an invalid die value: ${dice}`);

  const events: SnakesEvent[] = [{ type: 'roll', seat, dice, steps: dice, power: false }];
  p.turnsTaken += 1;
  s.seq += 1;
  s.dice = dice;
  s.sixStreak = dice === 6 ? s.sixStreak + 1 : 0;

  if (s.rules.maxConsecutiveSixes > 0 && s.sixStreak >= s.rules.maxConsecutiveSixes) {
    events.push({ type: 'three-sixes', seat });
    passTurn(s, false, events);
    return events;
  }

  let target = p.pos + dice;
  if (target > FINISH) {
    if (s.rules.exactFinish) {
      events.push({ type: 'no-move', seat });
      passTurn(s, dice === 6 && s.rules.extraTurnOnSix, events);
      return events;
    }
    target = FINISH;
  }
  events.push({ type: 'step', seat, from: p.pos, to: target });
  p.pos = target;
  const jump = JUMP.get(target);
  if (jump !== undefined) {
    events.push({ type: jump > target ? 'ladder' : 'snake', seat, from: target, to: jump });
    p.pos = jump;
  }
  p.score = p.pos;

  if (p.pos === FINISH) {
    finish(s, 'HOME', seat, events);
    return events;
  }
  passTurn(s, dice === 6 && s.rules.extraTurnOnSix, events);
  return events;
}

export function snakesForfeit(s: SnakesState, seat: number): SnakesEvent[] {
  if (s.phase === 'DONE') return [];
  const p = s.players.find((x) => x.seat === seat);
  if (!p || !p.active) return [];
  const events: SnakesEvent[] = [{ type: 'forfeit', seat }];
  p.active = false;
  s.seq += 1;
  const remaining = s.players.filter((x) => x.active);
  if (remaining.length <= 1) {
    finish(s, 'FORFEIT', remaining[0]?.seat, events);
    return events;
  }
  if (s.players[s.turn].seat === seat) passTurn(s, false, events);
  return events;
}
