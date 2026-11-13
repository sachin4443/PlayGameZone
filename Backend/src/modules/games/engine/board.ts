/**
 * Board model shared by every rules preset.
 *
 * The main track is a ring of 52 cells (global index 0..51). Each colour enters
 * the ring on its own start cell and measures its own progress in "steps":
 *
 *   YARD (-10)  token is in the yard / base
 *   -1          only reachable in kill-to-enter mode: the cell just before the start cell
 *   0           the colour's start cell
 *   1..50       main track
 *   51..55      the colour's private home column
 *   56          home
 */
export const TRACK_LEN = 52;
export const LAST_TRACK_STEP = 50;
export const HOME_STEP = 56;
export const YARD = -10;

export type Color = 'red' | 'green' | 'yellow' | 'blue';
export const COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];

/** Global index of each colour's start cell. */
export const START_CELL: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const START_CELLS = new Set(Object.values(START_CELL));
/** Star cells, eight steps after each start cell. */
export const STAR_CELLS = new Set([8, 21, 34, 47]);

/** Colours handed out by seat so that two players sit opposite each other. */
export function colorsFor(playerCount: number): Color[] {
  if (playerCount === 2) return ['red', 'yellow'];
  if (playerCount === 3) return ['red', 'green', 'yellow'];
  return ['red', 'green', 'yellow', 'blue'];
}

export const isOnTrack = (steps: number) => steps >= -1 && steps <= LAST_TRACK_STEP;

/** Global ring index for a token on the main track. */
export function globalCell(color: Color, steps: number): number {
  return (START_CELL[color] + steps + TRACK_LEN) % TRACK_LEN;
}
