import type { Color } from './types';

/**
 * Board geometry on a 15×15 grid. Mirrors the backend's track model:
 * steps 0..50 are ring cells (relative to the colour's start), 51..55 the home
 * column, 56 home, -10 the yard and -1 the ring cell before the start cell.
 */
export const YARD = -10;
export const HOME = 56;
export const COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];
export const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const STARS = [8, 21, 34, 47];
export const HEX: Record<Color, string> = { red: '#ef4444', green: '#22c55e', yellow: '#f5b800', blue: '#3b82f6' };
export const HEX_DARK: Record<Color, string> = { red: '#b91c1c', green: '#15803d', yellow: '#b78103', blue: '#1d4ed8' };
export const COLOR_NAME: Record<Color, string> = { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };

type RC = [row: number, col: number];

function buildTrack(): RC[] {
  const t: RC[] = [];
  for (let c = 1; c <= 5; c++) t.push([6, c]);
  for (let r = 5; r >= 0; r--) t.push([r, 6]);
  t.push([0, 7], [0, 8]);
  for (let r = 1; r <= 5; r++) t.push([r, 8]);
  for (let c = 9; c <= 14; c++) t.push([6, c]);
  t.push([7, 14], [8, 14]);
  for (let c = 13; c >= 9; c--) t.push([8, c]);
  for (let r = 9; r <= 14; r++) t.push([r, 8]);
  t.push([14, 7], [14, 6]);
  for (let r = 13; r >= 9; r--) t.push([r, 6]);
  for (let c = 5; c >= 0; c--) t.push([8, c]);
  t.push([7, 0], [6, 0]);
  return t;
}

export const TRACK = buildTrack();

export const HOME_COLUMN: Record<Color, RC[]> = {
  red: [1, 2, 3, 4, 5].map((c) => [7, c] as RC),
  green: [1, 2, 3, 4, 5].map((r) => [r, 7] as RC),
  yellow: [13, 12, 11, 10, 9].map((c) => [7, c] as RC),
  blue: [13, 12, 11, 10, 9].map((r) => [r, 7] as RC),
};

/** Top-left corner (col, row) of each colour's 6×6 yard. */
export const YARD_ORIGIN: Record<Color, [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };
const YARD_SPOTS: [number, number][] = [[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]];
const HOME_SPOT: Record<Color, [number, number]> = { red: [6.55, 7.5], green: [7.5, 6.55], yellow: [8.45, 7.5], blue: [7.5, 8.45] };

/** Centre point (x, y) in grid units of a token. */
export function tokenPoint(color: Color, steps: number, tokenIndex: number): [number, number] {
  if (steps === YARD) {
    const [ox, oy] = YARD_ORIGIN[color];
    const [dx, dy] = YARD_SPOTS[tokenIndex % 4];
    return [ox + dx, oy + dy];
  }
  if (steps >= HOME) return HOME_SPOT[color];
  if (steps > 50) {
    const [r, c] = HOME_COLUMN[color][steps - 51];
    return [c + 0.5, r + 0.5];
  }
  const [r, c] = TRACK[(START[color] + steps + 52) % 52];
  return [c + 0.5, r + 0.5];
}

/** Identifies the square a token stands on, to fan out stacked tokens. */
export function cellKey(color: Color, steps: number, tokenIndex: number): string {
  if (steps === YARD) return `yard-${color}-${tokenIndex}`;
  if (steps >= HOME) return `home-${color}`;
  if (steps > 50) return `col-${color}-${steps}`;
  return `ring-${(START[color] + steps + 52) % 52}`;
}

/** Degrees to rotate the board so the given colour's yard sits bottom-left. */
export const ROTATION: Record<Color, number> = { blue: 0, red: -90, green: 180, yellow: 90 };

/** Screen corner (0 TL, 1 TR, 2 BR, 3 BL) of a colour when `mine` is rotated to bottom-left. */
export function cornerOf(color: Color, mine: Color): number {
  return (COLORS.indexOf(color) + 3 - COLORS.indexOf(mine) + 4) % 4;
}
