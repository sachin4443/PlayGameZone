import { describe, expect, it } from 'vitest';
import { HOME_STEP, YARD, globalCell } from '../../src/modules/games/engine/board';
import { EngineError, autoPlay, createGame, forfeit, move, roll, timeUp, type GameState } from '../../src/modules/games/engine/engine';
import { PRESETS, resolveRules } from '../../src/modules/games/engine/rules';
import { scripted } from '../helpers';

const P = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `P${i}`, avatar: 'a1' }));
const classic = (n = 2) => createGame(PRESETS.CLASSIC, P(n), scripted([1]), 0);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as EngineError).code;
  }
  return null;
};

describe('setup', () => {
  it('seats two players on opposite colours with every token in the yard', () => {
    const s = classic();
    expect(s.players.map((p) => p.color)).toEqual(['red', 'yellow']);
    expect(s.players[0].tokens).toEqual([YARD, YARD, YARD, YARD]);
    expect(s.phase).toBe('ROLL');
    expect(s.turn).toBe(0);
  });

  it('seats four players in board order', () => {
    expect(classic(4).players.map((p) => p.color)).toEqual(['red', 'green', 'yellow', 'blue']);
  });

  it('rejects invalid player counts', () => {
    expect(() => createGame(PRESETS.CLASSIC, P(1), scripted([1]), 0)).toThrow();
    expect(() => createGame(PRESETS.CLASSIC, P(5), scripted([1]), 0)).toThrow();
  });
});

describe('dice and turn validation', () => {
  it('only the current player may roll', () => {
    const s = classic();
    expect(code(() => roll(s, 1, scripted([6])))).toBe('NOT_YOUR_TURN');
  });

  it('uses the server RNG value and rejects out-of-range values', () => {
    const s = classic();
    const ev = roll(s, 0, scripted([6]));
    expect(ev[0]).toMatchObject({ type: 'roll', dice: 6 });
    expect(() => roll(classic(), 0, () => 7)).toThrow();
  });

  it('cannot roll twice or move before rolling', () => {
    const s = classic();
    expect(code(() => move(s, 0, 0, undefined, scripted([1])))).toBe('WRONG_PHASE');
    roll(s, 0, scripted([6]));
    expect(code(() => roll(s, 0, scripted([6])))).toBe('WRONG_PHASE');
  });

  it('passes the turn when nothing can move', () => {
    const s = classic();
    const ev = roll(s, 0, scripted([3]));
    expect(ev.map((e) => e.type)).toEqual(['roll', 'no-move', 'turn']);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('ROLL');
  });

  it('three sixes in a row forfeit the turn', () => {
    const s = classic();
    roll(s, 0, scripted([6]));
    move(s, 0, 0, undefined, scripted([1]));
    roll(s, 0, scripted([6]));
    move(s, 0, 0, undefined, scripted([1]));
    const ev = roll(s, 0, scripted([6]));
    expect(ev.some((e) => e.type === 'three-sixes')).toBe(true);
    expect(s.turn).toBe(1);
    expect(s.players[0].tokens[0]).toBe(6);
  });
});

describe('movement', () => {
  it('needs a six to leave the yard, then grants another roll', () => {
    const s = classic();
    roll(s, 0, scripted([6]));
    expect(s.legal).toHaveLength(4);
    const ev = move(s, 0, 2, undefined, scripted([1]));
    expect(s.players[0].tokens[2]).toBe(0);
    expect(ev.at(-1)).toMatchObject({ type: 'turn', seat: 0, extra: true });
  });

  it('rejects a token that is not in the legal list', () => {
    const s = classic();
    s.players[0].tokens = [5, YARD, YARD, YARD];
    roll(s, 0, scripted([3]));
    expect(code(() => move(s, 0, 1, undefined, scripted([1])))).toBe('ILLEGAL_MOVE');
    expect(code(() => move(s, 1, 0, undefined, scripted([1])))).toBe('NOT_YOUR_TURN');
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[0].tokens[0]).toBe(8);
    expect(s.turn).toBe(1);
  });

  it('requires an exact roll to get home', () => {
    const s = classic();
    s.players[0].tokens = [54, YARD, YARD, YARD];
    roll(s, 0, scripted([3]));
    expect(s.turn).toBe(1); // overshoot: no legal move
    s.turn = 0;
    roll(s, 0, scripted([2]));
    const ev = move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[0].tokens[0]).toBe(HOME_STEP);
    expect(ev.some((e) => e.type === 'home')).toBe(true);
    expect(ev.at(-1)).toMatchObject({ type: 'turn', seat: 0, extra: true });
  });
});

describe('capturing', () => {
  // Red step 30 is ring cell 30; yellow (start 26) reaches it at step 4.
  const setup = (): GameState => {
    const s = classic();
    s.players[0].tokens = [27, YARD, YARD, YARD];
    s.players[1].tokens = [4, YARD, YARD, YARD];
    expect(globalCell('yellow', 4)).toBe(globalCell('red', 30));
    return s;
  };

  it('sends a captured token back to the yard and grants another roll', () => {
    const s = setup();
    roll(s, 0, scripted([3]));
    const ev = move(s, 0, 0, undefined, scripted([1]));
    expect(ev.find((e) => e.type === 'kill')).toMatchObject({ seat: 0, victimSeat: 1, victimToken: 0 });
    expect(s.players[1].tokens[0]).toBe(YARD);
    expect(s.players[0].kills).toBe(1);
    expect(s.turn).toBe(0);
  });

  it('does not capture on a star cell', () => {
    const s = classic();
    // Ring cell 34 is a star: red step 34, yellow step 8.
    s.players[0].tokens = [31, YARD, YARD, YARD];
    s.players[1].tokens = [8, YARD, YARD, YARD];
    roll(s, 0, scripted([3]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[1].tokens[0]).toBe(8);
    expect(s.players[0].kills).toBe(0);
  });

  it('does not capture on a start cell', () => {
    const s = classic();
    s.players[0].tokens = [23, YARD, YARD, YARD];
    s.players[1].tokens = [0, YARD, YARD, YARD]; // yellow start = ring 26
    roll(s, 0, scripted([3]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[1].tokens[0]).toBe(0);
  });

  it('a block of two tokens is safe', () => {
    const s = setup();
    s.players[1].tokens = [4, 4, YARD, YARD];
    roll(s, 0, scripted([3]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[1].tokens).toEqual([4, 4, YARD, YARD]);
  });

  it('tokens in a home column cannot be captured', () => {
    const s = classic();
    s.players[0].tokens = [1, YARD, YARD, YARD];
    s.players[1].tokens = [52, YARD, YARD, YARD];
    roll(s, 0, scripted([3]));
    const ev = move(s, 0, 0, undefined, scripted([1]));
    expect(ev.some((e) => e.type === 'kill')).toBe(false);
  });
});

describe('winning', () => {
  it('the first player with every token home wins a classic game', () => {
    const s = classic(4);
    s.players[0].tokens = [HOME_STEP, HOME_STEP, HOME_STEP, 55];
    roll(s, 0, scripted([1]));
    const ev = move(s, 0, 3, undefined, scripted([1]));
    expect(s.phase).toBe('DONE');
    expect(s.result).toMatchObject({ reason: 'HOME', winners: [0] });
    expect(s.result!.ranking[0]).toBe(0);
    expect(s.result!.ranking).toHaveLength(4);
    expect(ev.at(-1)!.type).toBe('finish');
    expect(code(() => roll(s, 1, scripted([1])))).toBe('GAME_OVER');
  });

  it('the last player standing wins when others forfeit', () => {
    const s = classic(4);
    forfeit(s, 1, scripted([1]));
    forfeit(s, 0, scripted([1])); // current player leaves: turn moves on
    expect(s.players[s.turn].seat).toBe(2);
    forfeit(s, 3, scripted([1]));
    expect(s.result).toMatchObject({ reason: 'FORFEIT', winners: [2] });
  });
});

describe('kill-to-enter mode', () => {
  it('keeps circling until the player has captured', () => {
    const s = createGame(PRESETS.KILL_TO_ENTER, P(2), scripted([1]), 0);
    s.players[0].tokens = [49, YARD, YARD, YARD];
    roll(s, 0, scripted([4]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[0].tokens[0]).toBe(1); // 53 - 52: back on the ring
    s.turn = 0;
    s.players[0].tokens = [49, YARD, YARD, YARD];
    s.players[0].kills = 1;
    roll(s, 0, scripted([4]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[0].tokens[0]).toBe(53); // home column is open
  });
});

describe('score mode', () => {
  it('starts with tokens on the board and is won on score when time runs out', () => {
    const s = createGame(PRESETS.SCORE, P(2), scripted([1]), 1000);
    expect(s.players[0].tokens).toEqual([0, 0, 0, 0]);
    expect(s.endsAt).toBe(1000 + 300_000);
    roll(s, 0, scripted([5]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[0].score).toBe(5);
    roll(s, 1, scripted([2]));
    move(s, 1, 0, undefined, scripted([1]));
    timeUp(s);
    expect(s.result).toMatchObject({ reason: 'TIME', winners: [0] });
  });

  it('splits the win on an exact tie', () => {
    const s = createGame(PRESETS.SCORE, P(2), scripted([1]), 0);
    timeUp(s);
    expect(s.result!.winners).toEqual([0, 1]);
  });

  it('a captured token returns to its start cell and loses its progress points', () => {
    const s = createGame(PRESETS.SCORE, P(2), scripted([1]), 0);
    s.players[0].tokens = [27, 0, 0, 0];
    s.players[1].tokens = [4, 0, 0, 0];
    s.players[1].score = 4;
    roll(s, 0, scripted([3]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[1].tokens[0]).toBe(0);
    expect(s.players[1].score).toBe(0);
    expect(s.players[0].score).toBe(3 + 20);
  });
});

describe('mania mode', () => {
  it('ends after 25 rolls each and doubles every fifth roll', () => {
    const s = createGame(PRESETS.MANIA, P(2), scripted([1]), 0);
    const rng = scripted([2]);
    let power = 0;
    let guard = 0;
    while (s.phase !== 'DONE' && guard++ < 500) {
      const ev = autoPlay(s, rng);
      power += ev.filter((e) => e.type === 'roll' && e.power && e.steps === 4).length;
    }
    expect(s.phase).toBe('DONE');
    expect(s.result!.reason).toBe('TURNS');
    expect(s.players.map((p) => p.turnsTaken)).toEqual([25, 25]);
    expect(power).toBe(10);
  });

  it('star cells do not protect', () => {
    const s = createGame(PRESETS.MANIA, P(2), scripted([1]), 0);
    s.players[0].tokens = [31, 0, 0, 0];
    s.players[1].tokens = [8, 0, 0, 0];
    roll(s, 0, scripted([3]));
    move(s, 0, 0, undefined, scripted([1]));
    expect(s.players[1].tokens[0]).toBe(0);
    expect(s.players[0].kills).toBe(1);
  });
});

describe('pick-your-dice mode', () => {
  it('offers a shared pool, re-rolls the picked die and ends after 30 picks each', () => {
    const s = createGame(PRESETS.PICK_DICE, P(2), scripted([1, 2, 3, 6]), 0);
    expect(s.pool).toEqual([1, 2, 3]);
    expect(s.phase).toBe('MOVE');
    expect(code(() => roll(s, 0, scripted([1])))).toBe('WRONG_MODE');
    expect(code(() => move(s, 0, 0, 7, scripted([1])))).toBe('ILLEGAL_MOVE');
    const ev = move(s, 0, 0, 2, scripted([5]));
    expect(s.players[0].tokens[0]).toBe(3);
    expect(s.pool).toEqual([1, 2, 5]); // only the used die changed
    expect(ev.some((e) => e.type === 'pool')).toBe(true);
    expect(s.turn).toBe(1);

    let guard = 0;
    while (s.phase !== 'DONE' && guard++ < 500) autoPlay(s, scripted([3]));
    expect(s.players.map((p) => p.turnsTaken)).toEqual([30, 30]);
    expect(s.result!.reason === 'TURNS' || s.result!.reason === 'SCORE').toBe(true);
  });
});

describe('rules configuration', () => {
  it('merges validated overrides onto a preset', () => {
    expect(resolveRules('MANIA', { turnLimit: 10 }).turnLimit).toBe(10);
    expect(() => resolveRules('CLASSIC', { turnLimit: -1 })).toThrow();
    expect(() => resolveRules('CLASSIC', { notARule: true })).toThrow();
    expect(() => resolveRules('NOPE')).toThrow();
  });

  it('whole random games always terminate with a valid result', () => {
    for (const key of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      for (let seed = 1; seed <= 5; seed++) {
        let x = seed * 7919;
        const rng = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), (x >> 8) % 6) + 1;
        const s = createGame(PRESETS[key], P(seed % 2 ? 2 : 4), rng, 0);
        let guard = 0;
        while (s.phase !== 'DONE' && guard++ < 20000) {
          autoPlay(s, rng);
          if (PRESETS[key].timeLimitSec && guard > 600) timeUp(s);
        }
        expect(s.phase, `${key} seed ${seed}`).toBe('DONE');
        expect(s.result!.winners.length).toBeGreaterThan(0);
        expect([...s.result!.ranking].sort()).toEqual(s.players.map((p) => p.seat));
      }
    }
  });
});
