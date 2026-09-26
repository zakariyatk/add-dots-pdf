/* Golden fixture for buildPdf: every core mark style, two source documents,
   page rotation, crop and a duplicated page.

   Plain JavaScript taking pdf-lib as a parameter, so the same file runs in the
   browser against the v1 app (to record the golden output) and in Node against
   packages/engine (to check it still matches). */

/** Two source PDFs with fixed content, and the editor items built from them. */
export async function makeFixture(PDFLib) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  async function source(label, pages) {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) {
      const p = d.addPage([595.28, 841.89]);
      p.drawText(label + ' page ' + (i + 1), { x: 60, y: 780, size: 18, font: f });
      p.drawLine({ start: { x: 100, y: 600 }, end: { x: 400, y: 600 }, thickness: 1, color: rgb(0, 0, 0) });
    }
    return d.save();
  }

  const a = { id: 1, name: 'a.pdf', bytes: await source('Source A', 2) };
  const b = { id: 2, name: 'b.pdf', bytes: await source('Source B', 1) };

  const pageOneMarks = [
    { t: 'rect', a: [50, 50], b: [200, 150], c: '#E2483D', w: 1 },
    {
      t: 'rect',
      a: [250, 60],
      b: [400, 180],
      c: '#1E3A8A',
      w: 3,
      r: 25,
      d: 1,
      fill: '#F2C14E',
      o: 0.6,
      cap: 0,
      j: 2,
    },
    { t: 'line', a: [60, 250], b: [300, 320], c: '#22A06B', w: 1.5, d: 2 },
    { t: 'arrow', a: [320, 250], b: [520, 400], c: '#000000', w: 3 },
    { t: 'text', a: [60, 700], c: '#000000', text: 'Plain Helvetica', size: 11, f: 'helv' },
    {
      t: 'text',
      a: [300, 520],
      c: '#8B5CF6',
      o: 0.8,
      text: 'Bold italic, Café – £5\nsecond line\n\nfourth after a blank',
      size: 14,
      f: 'times',
      b: true,
      i: true,
      u: true,
      k: true,
      align: 'center',
      r: 30,
      bg: '#EAF2FF',
      bgOp: 0.5,
    },
    {
      t: 'text',
      a: [80, 450],
      c: '#C00000',
      text: 'Right aligned\nreplacement',
      size: 10,
      f: 'cour',
      align: 'right',
      patch: { x: 78, y: 425, w: 160, h: 38, c: '#FFFFFF' },
    },
    { t: 'text', a: [60, 100], c: '#000000', text: '   ', size: 12, f: 'helv' },
  ];

  const items = [
    { src: a, num: 1, rot: 0, crop: null, shapes: pageOneMarks },
    {
      src: b,
      num: 1,
      rot: 90,
      crop: { x: 20, y: 30, w: 300, h: 400 },
      shapes: [
        { t: 'line', a: [30, 40], b: [280, 400], c: '#F28C28', w: 4, cap: 2 },
        { t: 'arrow', a: [250, 60], b: [60, 300], c: '#1BA1A1', w: 0.5, d: 1 },
      ],
    },
    {
      src: a,
      num: 2,
      rot: 0,
      crop: null,
      shapes: [{ t: 'rect', a: [10, 10], b: [100, 60], c: '#000000', w: 0.25 }],
    },
    { src: a, num: 1, rot: 270, crop: null, shapes: [] },
  ];
  return items;
}

/** Content-stream numbers rounded to 8 decimal places. Browsers and Node can
    differ in the last binary digit of Math.sin/cos (seen: Chrome 152 vs Node
    24), which is a hundred-millionth of a point, never a real difference. */
export function roundNums(stream) {
  return stream.replace(/-?\d+\.\d{9,}/g, (n) => String(+(+n).toFixed(8)));
}

/** What a saved PDF looks like, page by page, independent of timestamps and of
    the random suffixes pdf-lib gives resource names. */
export async function digest(PDFLib, bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes);
  const latin1 = (u8) => Array.from(u8, (c) => String.fromCharCode(c)).join('');
  const box = (r) => [r.x, r.y, r.width, r.height].map((n) => +n.toFixed(4));
  return doc.getPages().map((p) => {
    let contents = p.node.Contents();
    const refs =
      contents instanceof PDFLib.PDFArray ? contents.asArray() : [p.node.get(PDFLib.PDFName.of('Contents'))];
    const streams = refs.map((ref) => {
      const s = doc.context.lookup(ref);
      const raw = PDFLib.decodePDFRawStream(s).decode();
      return latin1(raw).replace(/\/([A-Za-z][A-Za-z-]*?)-\d+(?=[\s/[\]<>()]|$)/g, '/$1-#');
    });
    const out = {
      mediaBox: box(p.getMediaBox()),
      cropBox: box(p.getCropBox()),
      rotation: p.getRotation().angle,
      streams,
    };
    /* link annotations (links, videos), only on pages that have them */
    const annots = p.node.Annots();
    if (annots) {
      out.annots = annots.asArray().map((ref) => {
        const a = doc.context.lookup(ref);
        const act = a.lookup(PDFLib.PDFName.of('A'));
        const uri = act && act.lookup(PDFLib.PDFName.of('URI'));
        return {
          subtype: String(a.get(PDFLib.PDFName.of('Subtype'))),
          rect: a
            .lookup(PDFLib.PDFName.of('Rect'))
            .asArray()
            .map((n) => +n.asNumber().toFixed(4)),
          uri: uri ? uri.decodeText() : null,
        };
      });
    }
    return out;
  });
}
