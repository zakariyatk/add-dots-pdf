import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  angFrame,
  arcFrame,
  buildPdf,
  createTextMeasurer,
  dimLayout,
  dimMeasure,
  dimSvgMarkup,
  dimText,
  dimTextOrigin,
  dimxPainters,
  makeRef,
  refPoint,
  resolveDims,
  saveHooks,
  type AnyMark,
  type DimXMark,
  type PageItem,
  type Pt,
  type Scale,
} from '../src';

/* The Dimension Engine: every kind measured, written and laid out, its
   associations followed, and the same display list drawn into SVG and PDF. */

const MM: Scale = { unit: 'mm', denom: 1, custom: null };
const PT: Scale = { unit: 'pt', denom: 1, custom: null };
const measure = (str: string, size: number) => str.length * size * 0.5;
const dim = (o: Partial<DimXMark>): DimXMark =>
  ({ t: 'dimx', k: 'lin', pts: [], c: '#000000', w: 0.5, ...o }) as DimXMark;
const close = (a: Pt, b: Pt, d = 1e-6) => Math.abs(a[0] - b[0]) < d && Math.abs(a[1] - b[1]) < d;
const DEG = Math.PI / 180;

describe('linear: horizontal, vertical, rotated', () => {
  const P: Pt[] = [
    [100, 100],
    [172, 160],
  ];
  it('horizontal measures the run along x, whatever the rise', () => {
    const s = dim({ pts: [...P, [130, 200]], dir: [1, 0] });
    expect(dimMeasure(s).v).toBeCloseTo(72);
    expect(dimText(s, PT)).toBe('72 pt');
    expect(dimText(s, MM)).toBe('25 mm');
  });
  it('vertical measures the rise', () => {
    expect(dimMeasure(dim({ pts: [...P, [200, 130]], dir: [0, 1] })).v).toBeCloseTo(60);
  });
  it('the dimension line passes through its location; extension lines from the points to past it', () => {
    const s = dim({ pts: [...P, [130, 200]], dir: [1, 0] });
    const D = dimLayout(s, PT, measure);
    /* the line itself: the long one at y=200 */
    const at200 = D.lines.filter((l) => l[0][1] === 200 && l[1][1] === 200);
    expect(at200.some((l) => Math.abs(l[0][0] - 100) < 1e-9 && Math.abs(l[1][0] - 172) < 1e-9)).toBe(true);
    /* extension lines: gap 1.5 off each point, 2 past the line */
    expect(D.ext).toHaveLength(2);
    expect(close(D.ext[0]![0], [100, 101.5])).toBe(true);
    expect(close(D.ext[0]![1], [100, 202])).toBe(true);
    expect(close(D.ext[1]![0], [172, 161.5])).toBe(true);
    /* two closed arrowheads, inside, tips on the ends */
    const tips = D.polys.filter((q) => q.fill).map((q) => q.pts[0]!);
    expect(tips.some((t) => close(t, [100, 200]))).toBe(true);
    expect(tips.some((t) => close(t, [172, 200]))).toBe(true);
    /* the text above the line, level, centred on it */
    expect(D.text.ang).toBe(0);
    expect(D.text.at[0]).toBeCloseTo(136);
    expect(D.text.at[1]).toBeGreaterThan(200);
  });
  it('arrows go outside when there is no room for them', () => {
    const s = dim({
      pts: [
        [0, 0],
        [8, 0],
        [4, 20],
      ],
      dir: [1, 0],
    });
    const D = dimLayout(s, PT, measure);
    const heads = D.polys.filter((q) => q.fill);
    /* the arrow at x=0 points right (in), its body out to the left */
    const left = heads.find((q) => close(q.pts[0]!, [0, 20]))!;
    expect(left.pts[1]![0]).toBeLessThan(0);
    expect(D.lines.some((l) => l[0][0] < -5)).toBe(true);
  });
  it('the text centred breaks the line round it', () => {
    const s = dim({
      pts: [
        [0, 0],
        [200, 0],
        [100, 30],
      ],
      dir: [1, 0],
      sty: { tp: 'center' },
    });
    const D = dimLayout(s, PT, measure);
    expect(D.text.at).toEqual([100, 30]);
    expect(D.lines.filter((l) => l[0][1] === 30)).toHaveLength(2);
  });
  it('below, and level text on a vertical dimension', () => {
    const s = dim({
      pts: [
        [0, 0],
        [0, 100],
        [40, 50],
      ],
      dir: [0, 1],
      sty: { ta: 'horizontal' },
    });
    const D = dimLayout(s, PT, measure);
    expect(D.text.ang).toBe(0);
    /* away from the points: to the right of the line at x=40 */
    expect(D.text.at[0]).toBeGreaterThan(40);
    /* aligned, it reads up the line: "above" is its left, as AutoCAD's */
    const a = dimLayout({ ...s, sty: {} }, PT, measure);
    expect(a.text.ang).toBeCloseTo(Math.PI / 2);
    expect(a.text.at[0]).toBeLessThan(40);
    const b = dimLayout({ ...s, sty: { tp: 'below' } }, PT, measure);
    expect(b.text.at[0]).toBeGreaterThan(40);
  });
});

describe('aligned', () => {
  it('measures the true distance, the line parallel to it', () => {
    const s = dim({
      k: 'ali',
      pts: [
        [0, 0],
        [30, 40],
        [-20, 40],
      ],
    });
    expect(dimMeasure(s).v).toBeCloseTo(50);
    const D = dimLayout(s, PT, measure);
    expect(D.text.ang).toBeCloseTo(Math.atan2(40, 30));
  });
});

describe('angular', () => {
  it('three points: the angle on the side of the location, or its reflex', () => {
    const s = dim({
      k: 'ang',
      pts: [
        [0, 0],
        [100, 0],
        [0, 100],
        [50, 50],
      ],
    });
    expect(dimMeasure(s).v / DEG).toBeCloseTo(90);
    expect(dimText(s, MM)).toBe('90°');
    const r = { ...s, pts: [s.pts[0]!, s.pts[1]!, s.pts[2]!, [-50, -50] as Pt] };
    expect(dimMeasure(r).v / DEG).toBeCloseTo(270);
  });
  it('two lines: the vertex where they cross, the quadrant the location is in', () => {
    /* y=0 and y=x, crossing at the origin */
    const base: Pt[] = [
      [10, 0],
      [100, 0],
      [10, 10],
      [100, 100],
    ];
    const at = (loc: Pt) => angFrame({ pts: base, am: 'll' }, loc)!;
    expect(at([50, 10]).sweep / DEG).toBeCloseTo(45);
    expect(at([0, 50]).sweep / DEG).toBeCloseTo(135);
    expect(at([-50, -10]).sweep / DEG).toBeCloseTo(45);
    expect(close(at([50, 10]).V, [0, 0])).toBe(true);
  });
  it('extension lines run out to an arc beyond the arms', () => {
    const s = dim({
      k: 'ang',
      pts: [
        [0, 0],
        [20, 0],
        [0, 20],
        [100, 100],
      ],
    });
    const D = dimLayout(s, PT, measure);
    expect(D.ext).toHaveLength(2);
    expect(D.ext[0]![1][0]).toBeCloseTo(Math.hypot(100, 100) + 2);
  });
  it('decimal places for angles', () => {
    const s = dim({
      k: 'ang',
      pts: [
        [0, 0],
        [100, 0],
        [100, 50],
        [80, 10],
      ],
      sty: { adp: 2 },
    });
    expect(dimText(s, MM)).toBe((Math.atan2(50, 100) / DEG).toFixed(2) + '°');
  });
});

describe('radius and diameter', () => {
  const C: Pt = [100, 100],
    E: Pt = [140, 100];
  it('read R and Ø', () => {
    expect(dimText(dim({ k: 'rad', pts: [C, E, [110, 110]] }), PT)).toBe('R40 pt');
    expect(dimText(dim({ k: 'dia', pts: [C, E, [110, 110]] }), PT)).toBe('Ø80 pt');
  });
  it('inside: a line from the centre to the edge, the arrow on the edge', () => {
    const D = dimLayout(dim({ k: 'rad', pts: [C, E, [120, 100]] }), PT, measure);
    expect(D.lines.some((l) => close(l[0], C) && close(l[1], [140, 100]))).toBe(true);
    expect(D.polys.some((q) => q.fill && close(q.pts[0]!, [140, 100]))).toBe(true);
    /* and a centre mark */
    expect(D.ext).toHaveLength(2);
  });
  it('outside: a leader to the edge and a level landing with the text on it', () => {
    const D = dimLayout(dim({ k: 'dia', pts: [C, E, [200, 100]] }), PT, measure);
    expect(D.lines.some((l) => close(l[0], [60, 100]) && close(l[1], [200, 100]))).toBe(true);
    expect(D.text.ang).toBe(0);
    expect(D.text.at[0]).toBeGreaterThan(200);
    expect(D.polys.filter((q) => q.fill)).toHaveLength(2);
  });
});

describe('arc length', () => {
  it('the length along the arc, with the arc symbol', () => {
    const C: Pt = [0, 0];
    const s = dim({ k: 'arc', pts: [C, [50, 0], [0, 50], [35.36, 35.36], [60, 60]] });
    expect(arcFrame(s).sweep / DEG).toBeCloseTo(90);
    expect(dimMeasure(s).v).toBeCloseTo((Math.PI / 2) * 50);
    const D = dimLayout(s, PT, measure);
    expect(D.polys.some((q) => q.text)).toBe(true);
    /* the other way round, through the far side */
    const r = { ...s, pts: [C, [50, 0], [0, 50], [-35.36, -35.36], [60, 60]] as Pt[] };
    expect(arcFrame(r).sweep / DEG).toBeCloseTo(270);
  });
});

describe('ordinate', () => {
  it('measures from the datum along its axis', () => {
    const s = dim({
      k: 'ord',
      pts: [
        [10, 10],
        [110, 60],
        [110, 120],
      ],
      dir: [1, 0],
      ax: 'x',
    });
    expect(dimText(s, PT)).toBe('100 pt');
    const y = {
      ...s,
      ax: 'y' as const,
      pts: [
        [10, 10],
        [110, 60],
        [160, 60],
      ] as Pt[],
    };
    expect(dimText(y, PT)).toBe('50 pt');
  });
  it('a leader with a jog when the text is set aside', () => {
    const s = dim({
      k: 'ord',
      pts: [
        [0, 0],
        [100, 50],
        [130, 150],
      ],
      dir: [1, 0],
      ax: 'x',
    });
    expect(dimLayout(s, PT, measure).lines).toHaveLength(3);
    const st = dim({
      k: 'ord',
      pts: [
        [0, 0],
        [100, 50],
        [100, 150],
      ],
      dir: [1, 0],
      ax: 'x',
    });
    expect(dimLayout(st, PT, measure).lines).toHaveLength(1);
  });
});

describe('the text', () => {
  const s = dim({
    pts: [
      [0, 0],
      [72, 0],
      [36, 20],
    ],
    dir: [1, 0],
  });
  it('units, precision, unit name, prefix and suffix', () => {
    expect(dimText({ ...s, sty: { u: 'in' } }, MM)).toBe('1.00 in');
    expect(dimText({ ...s, sty: { u: 'cm', dp: 3 } }, MM)).toBe('2.540 cm');
    expect(dimText({ ...s, sty: { u: 'm' } }, MM)).toBe('0.025 m');
    expect(dimText({ ...s, sty: { ul: false, dp: 1 } }, MM)).toBe('25.4');
    expect(dimText({ ...s, sty: { pre: '2× ', suf: ' TYP' } }, MM)).toBe('2× 25 mm TYP');
  });
  it('the drawing scale, and a calibrated one in another unit', () => {
    expect(dimText(s, { unit: 'mm', denom: 50, custom: null })).toBe('1270 mm');
    /* calibrated: 1 pt is 10 mm; read in cm, that is 72 cm */
    expect(dimText({ ...s, sty: { u: 'cm' } }, { unit: 'mm', denom: 1, custom: 10 })).toBe('72.0 cm');
  });
  it('an override, with <> for the measured value', () => {
    expect(dimText({ ...s, label: 'MAX <>' }, MM)).toBe('MAX 25 mm');
    expect(dimText({ ...s, label: 'TBC' }, MM)).toBe('TBC');
  });
  it('moved on its own, with a leader back when well clear', () => {
    const D = dimLayout({ ...s, tm: true, pts: [...s.pts, [36, 80]] }, PT, measure);
    expect(D.text.at).toEqual([36, 80]);
    expect(D.lines.some((l) => close(l[0], D.grips.line))).toBe(true);
  });
  it('the size, the gap and the whole look scaled together', () => {
    const a = dimLayout(s, PT, measure),
      b = dimLayout({ ...s, sty: { sc: 2 } }, PT, measure);
    expect(b.text.size).toBe(a.text.size * 2);
    expect(dimLayout({ ...s, sty: { th: 12 } }, PT, measure).text.size).toBe(12);
  });
  it('turned by its rotation on top of its alignment, its box with it', () => {
    const a = dimLayout(s, PT, measure),
      b = dimLayout({ ...s, sty: { tr: 90 } }, PT, measure);
    expect(a.text.ang).toBeCloseTo(0);
    expect(b.text.ang).toBeCloseTo(90 * DEG);
    /* the box is as tall as the text is wide now */
    const h = (D: typeof a) => Math.max(...D.box.map((p) => p[1])) - Math.min(...D.box.map((p) => p[1]));
    expect(h(b)).toBeGreaterThan(h(a) * 2);
    /* still above the line (y 20), clear of it */
    expect(Math.min(...b.box.map((p) => p[1]))).toBeGreaterThan(20);
    /* level text turned too, and 0 is as it was */
    expect(dimLayout({ ...s, sty: { ta: 'horizontal', tr: 45 } }, PT, measure).text.ang).toBeCloseTo(45 * DEG);
    expect(dimLayout({ ...s, sty: { tr: 0 } }, PT, measure).text).toEqual(a.text);
  });
  it('every kind takes the rotation', () => {
    const C: Pt = [100, 100];
    const kinds: DimXMark[] = [
      dim({ k: 'ali', pts: [[0, 0], [60, 30], [20, 40]] }),
      dim({ k: 'ang', pts: [C, [150, 100], [100, 150], [130, 130]] }),
      dim({ k: 'rad', pts: [C, [140, 100], [120, 100]] }),
      dim({ k: 'dia', pts: [C, [140, 100], [200, 100]] }),
      dim({ k: 'arc', pts: [[0, 0], [50, 0], [0, 50], [35.36, 35.36], [60, 60]] }),
      dim({ k: 'ord', pts: [[0, 0], [100, 50], [130, 150]], dir: [1, 0], ax: 'x' }),
    ];
    for (const k of kinds) {
      const a = dimLayout(k, PT, measure).text.ang,
        b = dimLayout({ ...k, sty: { tr: 30 } }, PT, measure).text.ang;
      expect(b - a).toBeCloseTo(30 * DEG);
    }
  });
  it('the baseline sits so the box is centred on its place', () => {
    const D = dimLayout(s, PT, measure);
    const o = dimTextOrigin(D.text);
    expect(o[0]).toBeCloseTo(D.text.at[0] - D.text.w / 2);
    expect(o[1]).toBeCloseTo(D.text.at[1] - D.text.size * 0.36);
  });
});

describe('arrowheads', () => {
  const s = dim({
    pts: [
      [0, 0],
      [100, 0],
      [50, 20],
    ],
    dir: [1, 0],
  });
  it('closed, open, oblique, dot or none, at their size', () => {
    expect(dimLayout({ ...s, sty: { ah: 'open' } }, PT, measure).polys.filter((q) => !q.fill)).toHaveLength(
      2,
    );
    expect(dimLayout({ ...s, sty: { ah: 'oblique' } }, PT, measure).heavy).toHaveLength(2);
    expect(dimLayout({ ...s, sty: { ah: 'dot' } }, PT, measure).dots).toHaveLength(2);
    const n = dimLayout({ ...s, sty: { ah: 'none' } }, PT, measure);
    expect(n.polys.length + n.dots.length + n.heavy.length).toBe(0);
    const big = dimLayout({ ...s, sty: { as: 12 } }, PT, measure).polys[0]!;
    expect(Math.hypot(big.pts[0]![0] - big.pts[1]![0], big.pts[0]![1] - big.pts[1]![1])).toBeGreaterThan(12);
  });
});

describe('association', () => {
  const rect = { t: 'rect', a: [100, 100], b: [200, 150], c: '#000', w: 1, gid: 'R1' } as unknown as AnyMark;
  it('a box mark holds a point where it is in the box, through a resize and a turn', () => {
    const r = makeRef(rect, [200, 150], 'R1')!;
    expect(r).toEqual({ g: 'R1', u: 1, v: 1 });
    const big = { ...rect, b: [300, 250] } as unknown as AnyMark;
    expect(refPoint(big, r)).toEqual([300, 250]);
    const turned = { ...rect, r: 90 } as unknown as AnyMark;
    expect(close(refPoint(turned, r)!, [125, 175])).toBe(true);
  });
  it('a line by its ends, a path by its points, nothing elsewhere', () => {
    const line = { t: 'line', a: [0, 0], b: [10, 0], c: '#000', w: 1 } as unknown as AnyMark;
    expect(makeRef(line, [10, 0], 'L')).toEqual({ g: 'L', e: 'b' });
    expect(makeRef(line, [5, 0], 'L')).toEqual({ g: 'L', e: 'm' });
    expect(makeRef(line, [3, 0], 'L')).toBeNull();
    const poly = {
      t: 'poly',
      pts: [
        [0, 0],
        [5, 5],
        [9, 0],
      ],
      c: '#000',
      w: 1,
    } as unknown as AnyMark;
    expect(makeRef(poly, [5, 5], 'P')).toEqual({ g: 'P', i: 1 });
  });
  it('an arc by its centre', () => {
    const arc = { t: 'arc', a: [0, 0], b: [100, 0], bulge: 0.5, c: '#000', w: 1 } as unknown as AnyMark;
    const r = makeRef(arc, refPoint(arc, { g: 'A', c: 'c' })!, 'A')!;
    expect(r.c === 'c' || r.e === 'm').toBe(true);
    expect(refPoint(arc, { g: 'A', c: 'c' })![0]).toBeCloseTo(50);
  });
  it('a resized rectangle updates its dimension, the line kept where it was put', () => {
    const r = { ...rect } as Record<string, unknown>;
    const d = dim({
      pts: [
        [100, 150],
        [200, 150],
        [150, 180],
      ],
      dir: [1, 0],
      ref: [
        makeRef(r as unknown as AnyMark, [100, 150], 'R1'),
        makeRef(r as unknown as AnyMark, [200, 150], 'R1'),
      ],
    });
    const before = d.pts;
    const shapes = [r, d] as unknown as AnyMark[];
    expect(resolveDims(shapes)).toBe(false);
    r.b = [260, 150];
    expect(resolveDims(shapes)).toBe(true);
    expect(dimMeasure(d).v).toBeCloseTo(160);
    expect(d.pts[2]).toEqual([150, 180]);
    /* replaced, not changed in place, so undo keeps the old points */
    expect(before[1]).toEqual([200, 150]);
  });
  it('moved as a whole, the dimension comes along, line and text too', () => {
    const r = { ...rect } as Record<string, unknown>;
    const d = dim({
      pts: [
        [100, 150],
        [200, 150],
        [150, 180],
        [150, 190],
      ],
      tm: true,
      dir: [1, 0],
      ref: [
        makeRef(r as unknown as AnyMark, [100, 150], 'R1'),
        makeRef(r as unknown as AnyMark, [200, 150], 'R1'),
      ],
    });
    r.a = [110, 120];
    r.b = [210, 170];
    resolveDims([r, d] as unknown as AnyMark[]);
    expect(d.pts[2]).toEqual([160, 200]);
    expect(d.pts[3]).toEqual([160, 210]);
    expect(dimMeasure(d).v).toBeCloseTo(100);
  });
  it('a circle keeps its radius dimension on its edge', () => {
    const c = { t: 'ellipse', a: [0, 0], b: [100, 100], c: '#000', w: 1, gid: 'C' } as Record<
      string,
      unknown
    >;
    const d = dim({
      k: 'rad',
      pts: [
        [50, 50],
        [100, 50],
        [120, 50],
      ],
      ref: [
        makeRef(c as unknown as AnyMark, [50, 50], 'C'),
        makeRef(c as unknown as AnyMark, [100, 50], 'C'),
      ],
    });
    c.b = [200, 200];
    resolveDims([c, d] as unknown as AnyMark[]);
    expect(dimText(d, PT)).toBe('R100 pt');
  });
  it('a reference to a mark no longer there is ignored', () => {
    const d = dim({
      pts: [
        [0, 0],
        [10, 0],
        [5, 5],
      ],
      ref: [{ g: 'gone', u: 0, v: 0 }, null],
    });
    expect(resolveDims([d] as unknown as AnyMark[])).toBe(false);
  });
});

describe('drawn into SVG and PDF from one display list', () => {
  const s = dim({
    pts: [
      [100, 100],
      [200, 100],
      [150, 130],
    ],
    dir: [1, 0],
    c: '#E2483D',
    sty: { bg: true },
  });
  it('SVG: the lines, heads, plate and the text upright in a y-up space', () => {
    const D = dimLayout(s, PT, measure);
    const svg = dimSvgMarkup(D, s, { family: 'Inter', weight: '600', style: 'normal' });
    expect(svg).toContain('stroke="#E2483D"');
    expect(svg).toContain('scale(1 -1)');
    expect(svg).toContain('>100 pt</text>');
    expect((svg.match(/<path d="[^"]*Z" fill="#E2483D"/g) || []).length).toBe(2);
    expect(svg).toContain('fill="#FFFFFF"');
  });
  it('PDF: the same lines, heads, plate and text', () => {
    const calls: string[] = [];
    const page = {
      drawLine: () => calls.push('line'),
      drawSvgPath: (_d: string, o: Record<string, unknown>) => calls.push(o.color ? 'fill' : 'path'),
      drawCircle: () => calls.push('dot'),
      drawText: (t: string) => calls.push('text:' + t),
    };
    const font = { widthOfTextAtSize: (t: string, z: number) => t.length * z * 0.5, encodeText: () => null };
    dimxPainters(() => PT).dimx!(page as never, s as never, { fonts: { 'g:inter|1': font } } as never);
    const D = dimLayout(s, PT, measure);
    expect(calls.filter((c) => c === 'line')).toHaveLength(D.lines.length + D.ext.length);
    expect(calls.filter((c) => c === 'fill')).toHaveLength(3); /* two heads and the plate */
    expect(calls).toContain('text:100 pt');
  });
  it('a saved PDF has every kind in its page', async () => {
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([400, 400]);
    const items: PageItem[] = [
      {
        src: { id: 1, bytes: await doc.save() },
        num: 1,
        rot: 0,
        shapes: [
          dim({
            pts: [
              [50, 50],
              [150, 50],
              [100, 80],
            ],
            dir: [1, 0],
          }),
          dim({
            k: 'ali',
            pts: [
              [50, 100],
              [150, 150],
              [90, 160],
            ],
          }),
          dim({
            k: 'ang',
            pts: [
              [200, 200],
              [300, 200],
              [200, 300],
              [260, 260],
            ],
          }),
          dim({
            k: 'rad',
            pts: [
              [300, 100],
              [340, 100],
              [320, 110],
            ],
          }),
          dim({
            k: 'dia',
            pts: [
              [300, 100],
              [340, 100],
              [380, 140],
            ],
          }),
          dim({
            k: 'arc',
            pts: [
              [100, 300],
              [150, 300],
              [100, 350],
              [135, 335],
              [160, 340],
            ],
          }),
          dim({
            k: 'ord',
            pts: [
              [0, 0],
              [150, 50],
              [150, 20],
            ],
            dir: [1, 0],
            ax: 'x',
          }),
        ] as unknown as AnyMark[],
      },
    ];
    const bytes = await buildPdf(
      items,
      null,
      {},
      saveHooks({ scale: PT }, { measure: await createTextMeasurer() }),
    );
    const out = await PDFLib.PDFDocument.load(bytes);
    const c = out.getPage(0).node.Contents()!;
    const parts = c instanceof PDFLib.PDFArray ? c.asArray().map((r) => out.context.lookup(r)) : [c];
    const ops = parts
      .map((p) => new TextDecoder().decode(PDFLib.decodePDFRawStream(p as PDFLib.PDFRawStream).decode()))
      .join('\n');
    /* seven texts written */
    expect((ops.match(/Tj|TJ/g) || []).length).toBeGreaterThanOrEqual(7);
  });
});
