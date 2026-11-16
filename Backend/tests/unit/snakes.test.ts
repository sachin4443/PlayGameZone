import { describe, expect, it } from 'vitest';
import { engine } from '../../src/modules/games/engine';
import { createGame, chooseMove, roll } from '../../src/modules/games/engine/engine';
import { PRESETS, SNAKES_PRESET, resolveModeRules } from '../../src/modules/games/engine/rules';
import { LADDERS, SNAKES, createSnakesGame, snakesForfeit, snakesRoll } from '../../src/modules/games/engine/snakes';
import { YARD } from '../../src/modules/games/engine/board';
import { scripted } from '../helpers';

const P = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `P${i}`, avatar: 'a1' }));
const game = (n = 2) => createSnakesGame(SNAKES_PRESET, P(n), 0);

describe('snake & ladder board', () => {
  it('has consistent snakes and ladders', () => {
    const starts = [...LADDERS, ...SNAKES].map(([from]) => from);
    expect(new Set(starts).size).toBe(starts.length);
    for (const [from, to] of LADDERS) expect(to).toBeGreaterThan(from);
    for (const [from, to] of SNAKES) expect(to).toBeLessThan(from);
    const ends = new Set([...LADDERS, ...SNAKES].map(([, to]) => to));
    for (const s of starts) expect(ends.has(s)).toBe(false); // no chained jumps
    expect(starts).not.toContain(100);
  });
});

describe('snake & ladder rules', () => {
  it('moves by the server roll and passes the turn', () => {
    const s = game();
    const ev = snakesRoll(s, 0, scripted([3]));
    expect(s.players[0].pos).toBe(3);
    expect(ev.map((e) => e.type)).toEqual(['roll', 'step', 'turn']);
    expect(s.turn).toBe(1);
    expect(() => snakesRoll(s, 0, scripted([3]))).toThrow(/not your turn/i);
    expect(() => snakesRoll(s, 1, () => 9)).toThrow();
  });

  it('climbs ladders and slides down snakes', () => {
    const s = game();
    const up = snakesRoll(s, 0, scripted([4]));
    expect(up.find((e) => e.type === 'ladder')).toMatchObject({ from: 4, to: 25 });
    expect(s.players[0].pos).toBe(25);
    s.players[1].pos = 25;
    const down = snakesRoll(s, 1, scripted([2]));
    expect(down.find((e) => e.type === 'snake')).toMatchObject({ from: 27, to: 5 });
    expect(s.players[1].pos).toBe(5);
  });

  it('a six rolls again, three sixes end the turn', () => {
    const s = game();
    snakesRoll(s, 0, scripted([6]));
    expect(s.turn).toBe(0);
    snakesRoll(s, 0, scripted([6]));
    const third = snakesRoll(s, 0, scripted([6]));
    expect(third.some((e) => e.type === 'three-sixes')).toBe(true);
    expect(s.players[0].pos).toBe(12);
    expect(s.turn).toBe(1);
  });

  it('needs the exact number to finish, and the first to 100 wins', () => {
    const s = game(3);
    s.players[0].pos = 97;
    const over = snakesRoll(s, 0, scripted([5]));
    expect(over.some((e) => e.type === 'no-move')).toBe(true);
    expect(s.players[0].pos).toBe(97);
    s.turn = 0;
    snakesRoll(s, 0, scripted([3]));
    expect(s.phase).toBe('DONE');
    expect(s.result).toMatchObject({ reason: 'HOME', winners: [0] });
    expect(s.result!.ranking).toHaveLength(3);
    expect(() => snakesRoll(s, 1, scripted([1]))).toThrow(/over/i);
  });

  it('the last player left wins after forfeits', () => {
    const s = game(3);
    snakesForfeit(s, 0);
    expect(s.players[s.turn].seat).toBe(1);
    snakesForfeit(s, 2);
    expect(s.result).toMatchObject({ reason: 'FORFEIT', winners: [1] });
  });

  it('random games always finish', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let x = seed * 104729;
      const rng = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), (x >> 8) % 6) + 1;
      const s = game((seed % 3) + 2);
      let guard = 0;
      while (s.phase !== 'DONE' && guard++ < 20000) engine.autoPlay(s, rng);
      expect(s.phase).toBe('DONE');
      expect(s.players.find((p) => p.seat === s.result!.winners[0])!.pos).toBe(100);
    }
  });

  it('resolves rules for both board games and rejects token moves in snake & ladder', () => {
    expect(resolveModeRules('SNAKES').game).toBe('SNAKES');
    expect(resolveModeRules('CLASSIC').game).toBe('LUDO');
    expect(() => resolveModeRules('SNAKES', { turnLimit: 5 })).toThrow();
    expect(() => engine.move(game(), 0, 0, undefined, scripted([1]))).toThrow();
  });
});

describe('computer player strategy (Ludo)', () => {
  it('prefers a capture, then home, then leaving the yard', () => {
    const s = createGame(PRESETS.CLASSIC, P(2), scripted([1]), 0);
    s.players[0].tokens = [27, 10, YARD, YARD];
    s.players[1].tokens = [4, YARD, YARD, YARD]; // ring cell 30, three ahead of red's 27
    roll(s, 0, scripted([3]));
    expect(chooseMove(s).token).toBe(0);

    const h = createGame(PRESETS.CLASSIC, P(2), scripted([1]), 0);
    h.players[0].tokens = [53, 10, YARD, YARD];
    roll(h, 0, scripted([3]));
    expect(chooseMove(h).token).toBe(0);

    const y = createGame(PRESETS.CLASSIC, P(2), scripted([1]), 0);
    y.players[0].tokens = [10, YARD, YARD, YARD];
    roll(y, 0, scripted([6]));
    expect(chooseMove(y).from).toBe(YARD);
  });
});
