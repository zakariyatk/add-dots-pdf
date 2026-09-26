/* Mark styling shared by the screen and the saved PDF. Moved from core.js. */

import type { AnyMark, Mark } from './model';

/** Dash patterns as multiples of the stroke width, so a thick dashed line keeps
    the same rhythm as a thin one. Index = Mark.d (solid, dashed, dotted). */
export const DASH_N: readonly (readonly number[] | null)[] = [null, [4, 3], [1, 2.2]];

export function shOp(s: AnyMark): number {
  return s.o == null ? 1 : s.o;
}
export function shCap(s: Mark): number {
  return s.cap == null ? 1 : s.cap;
}
export function shJoin(s: Mark): number {
  return s.j == null ? 1 : s.j;
}

export function dashOf(s: Mark, sw: number): number[] | null {
  const d = DASH_N[s.d || 0];
  return d ? d.map((n) => +Math.max(0.15, n * sw).toFixed(2)) : null;
}

/** #RRGGBB to 0..1 channels. */
export function hexToRgb01(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
