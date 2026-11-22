/* A gradient fill in the saved PDF.

   The shape's outline is made the clipping path and a shading (axial for a
   linear gradient, radial for a radial one) is painted through it, carried
   on past both ends so the whole shape is covered, as Illustrator's is. The
   blend is a stitching function over the same steps the screen draws
   (gradRamp), so midpoints come out alike. Stops that are less than fully
   opaque add a soft mask: the same shading in grey, its brightness the
   opacity. */

import {
  PDFDict,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  appendBezierCurve,
  clip,
  clipEvenOdd,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
  type PDFContext,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { Pt } from '../model';
import { gradEnds, gradHasAlpha, gradRamp, type Grad, type RampStop } from '../gradient';

/** A path in page points (y up): straight segments, cubic curves, closes. */
export type GradPath = { k: 'M' | 'L'; p: Pt } | { k: 'C'; p: [Pt, Pt, Pt] } | { k: 'Z' };

/** A closed ring of points as a path. */
export function ringPath(ring: readonly Pt[]): GradPath[] {
  const out: GradPath[] = ring.map((p, i) => ({ k: i ? 'L' : 'M', p: [p[0], p[1]] }) as GradPath);
  out.push({ k: 'Z' });
  return out;
}

/** SVG path data made of absolute M, L, C and Z, y as the page has it. */
export function svgPath(d: string): GradPath[] {
  const tok = d.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const out: GradPath[] = [];
  let i = 0;
  const num = () => +tok[i++]!;
  const pt = (): Pt => [num(), num()];
  let cmd = '';
  while (i < tok.length) {
    const t = tok[i]!;
    if (/^[MLCZ]$/i.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === 'Z') {
        out.push({ k: 'Z' });
        continue;
      }
    }
    if (cmd === 'M' || cmd === 'L') {
      out.push({ k: cmd as 'M' | 'L', p: pt() });
      if (cmd === 'M') cmd = 'L';
    } else if (cmd === 'C') out.push({ k: 'C', p: [pt(), pt(), pt()] });
    else i++;
  }
  return out;
}

/* the ramp as a function from 0..1 to colours (or greys): two-colour pieces
   stitched end to end, a piece of no width (two stops at one place, a hard
   edge) left out */
function rampFunction(ctx: PDFContext, R: RampStop[], grey: boolean): PDFRef {
  const val = (r: RampStop) => (grey ? [r.o] : r.rgb);
  const P = R.slice();
  if (P[0]!.p > 0) P.unshift({ ...P[0]!, p: 0 });
  if (P[P.length - 1]!.p < 1) P.push({ ...P[P.length - 1]!, p: 1 });
  const parts: PDFRef[] = [],
    bounds: number[] = [],
    encode: number[] = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i]!,
      b = P[i + 1]!;
    if (b.p - a.p < 1e-6) continue;
    if (parts.length) bounds.push(+a.p.toFixed(6));
    parts.push(ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: val(a), C1: val(b), N: 1 })));
    encode.push(0, 1);
  }
  if (!parts.length) {
    const a = P[P.length - 1]!;
    return ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: val(a), C1: val(a), N: 1 }));
  }
  if (parts.length === 1) return parts[0]!;
  return ctx.register(
    ctx.obj({ FunctionType: 3, Domain: [0, 1], Functions: parts, Bounds: bounds, Encode: encode }),
  );
}

function shading(ctx: PDFContext, g: Grad, ends: [Pt, Pt], R: RampStop[], grey: boolean): PDFRef {
  const [a, b] = ends;
  const r6 = (v: number) => +v.toFixed(4);
  const coords =
    g.k === 'radial'
      ? [r6(a[0]), r6(a[1]), 0, r6(a[0]), r6(a[1]), r6(Math.max(0.01, Math.hypot(b[0] - a[0], b[1] - a[1])))]
      : [r6(a[0]), r6(a[1]), r6(b[0]), r6(b[1])];
  /* a vector of no length has no direction: nudge it so the shading is valid */
  if (g.k !== 'radial' && coords[0] === coords[2] && coords[1] === coords[3]) coords[2] = coords[2]! + 0.01;
  return ctx.register(
    ctx.obj({
      ShadingType: g.k === 'radial' ? 3 : 2,
      ColorSpace: grey ? 'DeviceGray' : 'DeviceRGB',
      Coords: coords,
      Function: rampFunction(ctx, R, grey),
      Extend: [true, true],
    }),
  );
}

function shadingKey(p: PDFPage, ref: PDFRef): PDFName {
  const { Resources } = p.node.normalizedEntries();
  let sh = Resources.lookupMaybe(PDFName.of('Shading'), PDFDict);
  if (!sh) {
    sh = p.doc.context.obj({});
    Resources.set(PDFName.of('Shading'), sh);
  }
  const key = sh.uniqueKey('Gr');
  sh.set(key, ref);
  return key;
}

function pathOps(path: readonly GradPath[]): PDFOperator[] {
  return path.map((c) =>
    c.k === 'Z'
      ? closePath()
      : c.k === 'C'
        ? appendBezierCurve(c.p[0][0], c.p[0][1], c.p[1][0], c.p[1][1], c.p[2][0], c.p[2][1])
        : c.k === 'M'
          ? moveTo(c.p[0], c.p[1])
          : lineTo(c.p[0], c.p[1]),
  );
}

/** Fill `path` (page points) with mark s's gradient, at opacity `opacity`. */
export function fillGradient(
  p: PDFPage,
  s: { grad?: Grad | null; a?: unknown; b?: unknown; pts?: unknown; r?: number; fr?: number },
  path: readonly GradPath[],
  opacity = 1,
  evenOdd = false,
): void {
  const g = s.grad;
  if (!g || path.length < 3) return;
  const ctx = p.doc.context;
  const ends = gradEnds(s, g);
  const R = gradRamp(g);
  const key = shadingKey(p, shading(ctx, g, ends, R, false));

  const gs: Record<string, unknown> = {};
  if (opacity < 1) gs.ca = +opacity.toFixed(4);
  if (gradHasAlpha(g)) {
    /* the opacity as a soft mask: the same shading in grey over the shape's
       box, read for its brightness */
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    path.forEach((c) => {
      if (c.k === 'Z') return;
      (c.k === 'C' ? c.p : [c.p]).forEach((q) => {
        x1 = Math.min(x1, q[0]);
        y1 = Math.min(y1, q[1]);
        x2 = Math.max(x2, q[0]);
        y2 = Math.max(y2, q[1]);
      });
    });
    const form = ctx.register(
      ctx.stream('/M sh', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [x1 - 1, y1 - 1, x2 + 1, y2 + 1].map((v) => +v.toFixed(3)),
        Group: { Type: 'Group', S: 'Transparency', CS: 'DeviceGray' },
        Resources: { Shading: { M: shading(ctx, g, ends, R, true) } },
      }),
    );
    gs.SMask = { Type: 'Mask', S: 'Luminosity', G: form };
  }

  const ops: PDFOperator[] = [pushGraphicsState()];
  if (Object.keys(gs).length) {
    const name = p.node.newExtGState('GrA', ctx.register(ctx.obj({ Type: 'ExtGState', ...gs } as never)));
    ops.push(setGraphicsState(name));
  }
  ops.push(...pathOps(path), evenOdd ? clipEvenOdd() : clip(), endPath());
  ops.push(PDFOperator.of(PDFOperatorNames.ShadingFill, [key]), popGraphicsState());
  p.pushOperators(...ops);
}
