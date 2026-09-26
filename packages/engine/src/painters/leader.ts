/* The leader (callout): a head at the tip a, a diagonal to the elbow m, then a
   level landing line to b. Moved from enhance.js. */

import type { Mark, Pt } from '../model';
import { arrowHead } from '../geometry';
import { hexRgb } from '../save';
import { fillPolygon, type Painter } from './common';

export interface LeaderMark extends Mark {
  t: 'leader';
  m: Pt;
  head?: 'arrow' | 'dot';
}

const leader: Painter = (p, s: LeaderMark) => {
  const col = hexRgb(s.c);
  const th = Math.max(0.4, s.w || 1.2);
  p.drawLine({ start: { x: s.a[0], y: s.a[1] }, end: { x: s.m[0], y: s.m[1] }, thickness: th, color: col });
  p.drawLine({ start: { x: s.m[0], y: s.m[1] }, end: { x: s.b[0], y: s.b[1] }, thickness: th, color: col });
  if (s.head === 'dot') {
    p.drawCircle({ x: s.a[0], y: s.a[1], size: Math.max(1.2, th * 1.6), color: col, borderWidth: 0 });
  } else {
    const wing = arrowHead(s.m[0], s.m[1], s.a[0], s.a[1], th);
    fillPolygon(p, [wing[0], s.a, wing[1]], col);
  }
};

export const leaderPainters: Record<string, Painter> = { leader };
