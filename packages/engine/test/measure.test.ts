import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE, calibrate, distance, formatLength, perPoint, type Scale } from '../src';

const A4_WIDTH_PT = 595.28;

describe('formatLength', () => {
  it('reads an A4 width as 210 mm at 1:1', () => {
    expect(formatLength(A4_WIDTH_PT, { ...DEFAULT_SCALE })).toBe('210 mm');
  });

  it('multiplies by the drawing scale', () => {
    // 72pt = 1in = 25.4mm of paper; at 1:50 that is 1270mm = 1.270m
    expect(formatLength(72, { unit: 'm', denom: 50, custom: null })).toBe('1.270 m');
  });

  it('uses each unit’s decimal places', () => {
    expect(formatLength(72, { unit: 'in', denom: 1, custom: null })).toBe('1.00 in');
    expect(formatLength(72, { unit: 'cm', denom: 1, custom: null })).toBe('2.5 cm');
    expect(formatLength(10, { unit: 'pt', denom: 1, custom: null })).toBe('10 pt');
  });

  it('sizes the precision of a calibrated reading to the number', () => {
    const s = (custom: number): Scale => ({ unit: 'm', denom: 1, custom });
    expect(formatLength(1, s(5))).toBe('5.00 m');
    expect(formatLength(1, s(50))).toBe('50.0 m');
    expect(formatLength(1, s(500))).toBe('500 m');
  });
});

describe('calibrate', () => {
  it('derives the factor and the nearest drawing scale', () => {
    // 100pt of paper that is really 1764mm: 100pt = 35.28mm, so about 1:50
    const r = calibrate(100, '1764 mm', { ...DEFAULT_SCALE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scale.unit).toBe('mm');
    expect(r.scale.custom).toBeCloseTo(17.64);
    expect(r.scale.denom).toBe(50);
    expect(formatLength(100, r.scale)).toBe('1764 mm');
  });

  it('reads inches written as "', () => {
    const r = calibrate(72, '48"', { ...DEFAULT_SCALE });
    expect(r.ok && r.scale.unit).toBe('in');
    expect(r.ok && r.scale.denom).toBe(48);
  });

  it('keeps the current unit when none is given', () => {
    const r = calibrate(10, '1,200', { unit: 'cm', denom: 1, custom: null });
    expect(r.ok && r.scale.unit).toBe('cm');
    expect(r.ok && r.scale.custom).toBe(120);
  });

  it('refuses text it cannot read and non-lengths', () => {
    expect(calibrate(10, 'about a metre', { ...DEFAULT_SCALE })).toEqual({ ok: false, error: 'unreadable' });
    expect(calibrate(10, '0 mm', { ...DEFAULT_SCALE })).toEqual({ ok: false, error: 'not-a-length' });
    expect(calibrate(0, '10 mm', { ...DEFAULT_SCALE })).toEqual({ ok: false, error: 'not-a-length' });
  });

  /* Known gap carried over from v1: the calibrate prompt suggests "4 ft", but
     feet are not a unit, so the number is read in the current unit instead. */
  it('KNOWN GAP: "4 ft" is read as 4 of the current unit', () => {
    const r = calibrate(72, '4 ft', { ...DEFAULT_SCALE });
    expect(r.ok && r.scale.unit).toBe('mm');
  });
});

describe('perPoint and distance', () => {
  it('prefers a calibrated factor over the drawing scale', () => {
    expect(perPoint({ unit: 'mm', denom: 100, custom: 3 })).toBe(3);
  });

  it('measures a 3-4-5 triangle', () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
  });
});
