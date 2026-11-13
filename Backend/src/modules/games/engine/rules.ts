import { z } from 'zod';

/**
 * A rules configuration fully describes how a game mode plays. Each game mode in
 * the database points at a preset (by key) and may override individual fields,
 * so new variants can be configured from the admin panel without code changes.
 */
export const rulesSchema = z.object({
  tokensPerPlayer: z.number().int().min(1).max(4),
  /** true: tokens wait in the yard and need a six. false: tokens start on the start cell. */
  sixToRelease: z.boolean(),
  extraTurnOnSix: z.boolean(),
  extraTurnOnKill: z.boolean(),
  extraTurnOnHome: z.boolean(),
  /** Rolling this many sixes in a row forfeits the turn (0 = no limit). */
  maxConsecutiveSixes: z.number().int().min(0).max(10),
  /** Star cells protect tokens (start cells always do). */
  starSafe: z.boolean(),
  /** Two or more tokens of one colour on a cell cannot be captured. */
  blockSafe: z.boolean(),
  /** A player must capture at least once before any token may enter the home column. */
  killRequiredForHome: z.boolean(),
  /** HOME: first to bring every token home. SCORE: highest score when the game ends. */
  winBy: z.enum(['HOME', 'SCORE']),
  /** Rolls (or picks) each player gets; 0 = unlimited. */
  turnLimit: z.number().int().min(0).max(500),
  /** Whole-game clock in seconds, enforced by the server; 0 = none. */
  timeLimitSec: z.number().int().min(0).max(3600),
  /** ROLL: one private die per turn. PICK: choose one die from a shared pool. */
  dice: z.enum(['ROLL', 'PICK']),
  dicePoolSize: z.number().int().min(2).max(5),
  /** Every Nth roll of a player moves double the rolled value (0 = off). */
  powerTurnEvery: z.number().int().min(0).max(50),
  scorePerStep: z.number().int().min(0).max(100),
  scoreKill: z.number().int().min(0).max(1000),
  scoreHome: z.number().int().min(0).max(1000),
});

export type Rules = z.infer<typeof rulesSchema>;

const CLASSIC: Rules = {
  tokensPerPlayer: 4,
  sixToRelease: true,
  extraTurnOnSix: true,
  extraTurnOnKill: true,
  extraTurnOnHome: true,
  maxConsecutiveSixes: 3,
  starSafe: true,
  blockSafe: true,
  killRequiredForHome: false,
  winBy: 'HOME',
  turnLimit: 0,
  timeLimitSec: 0,
  dice: 'ROLL',
  dicePoolSize: 3,
  powerTurnEvery: 0,
  scorePerStep: 1,
  scoreKill: 20,
  scoreHome: 56,
};

export const PRESETS = {
  /** Standard Ludo. */
  CLASSIC,
  /** Classic, but the home column stays closed until you have captured a token. */
  KILL_TO_ENTER: { ...CLASSIC, killRequiredForHome: true },
  /** Five-minute score attack: all tokens start on the board, highest score wins. */
  SCORE: { ...CLASSIC, sixToRelease: false, winBy: 'SCORE', timeLimitSec: 300 },
  /** 25 rolls each, no star shelters, no blocks, double-distance power roll every 5th roll. */
  MANIA: {
    ...CLASSIC, sixToRelease: false, winBy: 'SCORE', turnLimit: 25,
    starSafe: false, blockSafe: false, powerTurnEvery: 5, scoreKill: 40,
  },
  /** Three shared dice on the table: pick one, it is re-rolled for the next player. 30 picks each. */
  PICK_DICE: {
    ...CLASSIC, sixToRelease: false, winBy: 'SCORE', turnLimit: 30,
    dice: 'PICK', dicePoolSize: 3, extraTurnOnSix: false, maxConsecutiveSixes: 0,
  },
} satisfies Record<string, Rules>;

export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

/** Preset for `key` with validated overrides applied. Throws on invalid overrides. */
export function resolveRules(key: string, overrides: unknown = {}): Rules {
  const preset = PRESETS[key as PresetKey];
  if (!preset) throw new Error(`Unknown rules preset: ${key}`);
  const partial = rulesSchema.partial().strict().parse(overrides ?? {});
  return rulesSchema.parse({ ...preset, ...partial });
}
