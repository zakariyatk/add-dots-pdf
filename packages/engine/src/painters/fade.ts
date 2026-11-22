/* A mark faded by its layer's opacity (s.lo, set by the Layers panel).

   The painters set their own opacity as they draw (pdf-lib writes a graphics
   state with ca/CA for each), which would replace a plain opacity set
   around them. A soft mask is not touched by those, and multiplies with
   them: so the mark is drawn under a constant soft mask, grey at the
   layer's opacity, and comes out faded on top of its own opacity, as the
   screen fades the mark's whole group. */

import { PDFName, popGraphicsState, pushGraphicsState, setGraphicsState, type PDFPage } from 'pdf-lib';

/* far past any page, in whatever space the mark is drawn in */
const FAR = 100000;

/** Run draw with everything it paints faded to `lo` (0..1); as is at 1 or none. */
export function layerFade(p: PDFPage, lo: number | null | undefined, draw: () => void): void {
  if (lo == null || !(lo < 1)) {
    draw();
    return;
  }
  const v = Math.max(0, Math.min(1, lo));
  const ctx = p.doc.context;
  const form = ctx.register(
    ctx.stream(`${+v.toFixed(4)} g ${-FAR} ${-FAR} ${2 * FAR} ${2 * FAR} re f`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [-FAR, -FAR, FAR, FAR],
      Group: { Type: 'Group', S: 'Transparency', CS: 'DeviceGray' },
    }),
  );
  const gs = ctx.register(
    ctx.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: form } } as never),
  );
  const name: PDFName = p.node.newExtGState('LyO', gs);
  p.pushOperators(pushGraphicsState(), setGraphicsState(name));
  draw();
  p.pushOperators(popGraphicsState());
}
