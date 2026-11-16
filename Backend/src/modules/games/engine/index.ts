import { EngineError, autoPlay, forfeit, move, roll, timeUp, type GameEvent, type GameState, type Rng } from './engine';
import { snakesForfeit, snakesRoll, type SnakesEvent, type SnakesState } from './snakes';

/** Either board game. The live-game manager only talks to this facade. */
export type AnyState = GameState | SnakesState;
export type AnyEvent = GameEvent | SnakesEvent;

const isSnakes = (s: AnyState): s is SnakesState => s.kind === 'SNAKES';

export const engine = {
  roll(s: AnyState, seat: number, rng: Rng): AnyEvent[] {
    return isSnakes(s) ? snakesRoll(s, seat, rng) : roll(s, seat, rng);
  },
  move(s: AnyState, seat: number, token: number, die: number | undefined, rng: Rng): AnyEvent[] {
    if (isSnakes(s)) throw new EngineError('WRONG_MODE', 'Snake & Ladder has no token choice – just roll');
    return move(s, seat, token, die, rng);
  },
  forfeit(s: AnyState, seat: number, rng: Rng): AnyEvent[] {
    return isSnakes(s) ? snakesForfeit(s, seat) : forfeit(s, seat, rng);
  },
  timeUp(s: AnyState): AnyEvent[] {
    return isSnakes(s) ? [] : timeUp(s);
  },
  /** One pending action for whoever must act (a roll, or a move after a roll). */
  autoPlay(s: AnyState, rng: Rng): AnyEvent[] {
    if (s.phase === 'DONE') return [];
    return isSnakes(s) ? snakesRoll(s, s.players[s.turn].seat, rng) : autoPlay(s, rng);
  },
};
