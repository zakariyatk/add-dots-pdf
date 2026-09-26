/* Measuring: PDF points to real-world lengths.

   Moved from apps/web/public/js/draw.js unchanged; draw.js keeps its own copy
   until Phase 1 switches it over to this module.

   A PDF point is 1/72 inch. A drawing issued at 1:50 is not, which is what
   calibration is for: measure something you know, say what it really is, and
   every dimension after that reads in those units. */

export type UnitId = 'mm' | 'cm' | 'm' | 'in' | 'pt';

export interface Unit {
  label: string;
  /** How much of this unit one PDF point covers at 1:1. */
  per: number;
  /** Decimal places a reading in this unit is shown with. */
  dp: number;
}

export const UNITS: Readonly<Record<UnitId, Unit>> = {
  mm: { label: 'mm', per: 25.4 / 72, dp: 0 },
  cm: { label: 'cm', per: 2.54 / 72, dp: 1 },
  m: { label: 'm', per: 0.0254 / 72, dp: 3 },
  in: { label: 'in', per: 1 / 72, dp: 2 },
  pt: { label: 'pt', per: 1, dp: 0 },
};

/** Drawing scales. A plan issued at 1:50 draws a 50mm wall as 1mm of paper, so
    a paper measurement is multiplied by the denominator to read back as the
    real thing. */
export const SCALES: readonly number[] = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

/** `denom` is the drawing scale and `unit` what to print. `custom` holds a
    points-to-unit factor worked out by calibrating, which overrides both. */
export interface Scale {
  unit: UnitId;
  denom: number;
  custom: number | null;
}

export const DEFAULT_SCALE: Readonly<Scale> = { unit: 'mm', denom: 1, custom: null };

export function isUnit(u: string): u is UnitId {
  return Object.prototype.hasOwnProperty.call(UNITS, u);
}

function unitOf(scale: Scale): Unit {
  return UNITS[scale.unit] ?? UNITS.pt;
}

/** Real-world units covered by one PDF point under this scale. */
export function perPoint(scale: Scale): number {
  if (scale.custom) return scale.custom;
  return unitOf(scale).per * scale.denom;
}

/** A length in PDF points, as the reading for this scale, e.g. "210 mm". */
export function formatLength(points: number, scale: Scale): string {
  const v = points * perPoint(scale);
  const u = unitOf(scale);
  /* a calibrated reading has no tidy unit behind it, so take the precision
     from the size of the number instead */
  const dp = scale.custom ? (v < 10 ? 2 : v < 100 ? 1 : 0) : u.dp;
  return v.toFixed(dp) + ' ' + u.label;
}

/** Distance between two points, in PDF points. */
export function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export type CalibrateResult =
  { ok: true; scale: Scale } | { ok: false; error: 'unreadable' | 'not-a-length' };

/** Works out a scale from a line `points` long that is really `answer`
    ("1200 mm", "48\"", "3.5"). An unknown or missing unit keeps `current.unit`.
    The result also carries the nearest whole drawing scale in `denom`. */
export function calibrate(points: number, answer: string, current: Scale): CalibrateResult {
  const m = String(answer)
    .trim()
    .match(/^([\d.,]+)\s*([A-Za-z"']*)$/);
  if (!m) return { ok: false, error: 'unreadable' };
  const value = parseFloat(m[1]!.replace(/,/g, ''));
  if (!isFinite(value) || value <= 0 || !(points > 0)) return { ok: false, error: 'not-a-length' };

  let unit: string = (m[2] || current.unit).toLowerCase().replace(/[^a-z]/g, '');
  if (m[2] === '"') unit = 'in';
  const id: UnitId = isUnit(unit) ? unit : current.unit;
  const custom = value / points;
  return {
    ok: true,
    scale: { unit: id, custom, denom: Math.max(1, Math.round(custom / UNITS[id].per)) },
  };
}
