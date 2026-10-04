import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { cutText, pageTextLines, parseToUnicode } from '../src';
import { pageTexts } from './support/unicode';

/* Edit Object's Text: the lines a page writes, read from its content with
   their fonts; one cut out leaves the rest where they were. */

async function page(content: string, fonts: Record<string, PDFLib.StandardFonts>) {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([400, 400]);
  for (const [k, f] of Object.entries(fonts)) {
    const font = await d.embedFont(f);
    p.node.setFontDictionary(PDFLib.PDFName.of(k), font.ref);
  }
  p.node.set(PDFLib.PDFName.of('Contents'), d.context.register(d.context.stream(content)));
  return PDFLib.PDFDocument.load(await d.save());
}

describe('reading a ToUnicode map', () => {
  it('takes single codes and ranges, plain and listed', () => {
    const m = parseToUnicode(
      'beginbfchar <0003> <0020> <0010> <00660069> endbfchar ' +
        'beginbfrange <0024> <0026> <0041> <0030> <0031> [<0061> <0062>] endbfrange',
    );
    expect(m.get(3)).toBe(' ');
    expect(m.get(0x10)).toBe('fi');
    expect([m.get(0x24), m.get(0x25), m.get(0x26)]).toEqual(['A', 'B', 'C']);
    expect([m.get(0x30), m.get(0x31)]).toEqual(['a', 'b']);
  });
});

describe('the lines a page writes', () => {
  it('finds each line, its text, place, size, colour and font', async () => {
    const d = await page(
      'BT /F1 18 Tf 0.8 0 0 rg 50 300 Td (Hello) Tj ( world) Tj 0 -40 Td (Second line) Tj ET',
      { F1: PDFLib.StandardFonts.HelveticaBold },
    );
    const lines = await pageTextLines(d, 0);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Second line']);
    const [a] = lines;
    expect(a!.origin[0]).toBeCloseTo(50);
    expect(a!.origin[1]).toBeCloseTo(300);
    expect(a!.size).toBeCloseTo(18);
    expect(a!.color).toBe('#cc0000');
    expect(a!.bold).toBe(true);
    /* Helvetica-Bold "Hello world" at 18 pt, letter by letter (a show
       operator draws no kerning) */
    const hb = await (await PDFLib.PDFDocument.create()).embedFont(PDFLib.StandardFonts.HelveticaBold);
    const w = [...'Hello world'].reduce((t, ch) => t + hb.widthOfTextAtSize(ch, 18), 0);
    expect(a!.width).toBeCloseTo(w, 3);
  });

  it('reads an embedded TrueType font through its ToUnicode map and widths', async () => {
    const d0 = await PDFLib.PDFDocument.create();
    d0.registerFontkit(fontkit);
    const ttf = readFileSync(
      fileURLToPath(new URL('../../../apps/web/public/assets/fonts/google/roboto-r.ttf', import.meta.url)),
    );
    const f = await d0.embedFont(ttf, { subset: true });
    const p = d0.addPage([400, 400]);
    p.drawText('Ünïcødé text', { x: 40, y: 200, size: 20, font: f });
    const d = await PDFLib.PDFDocument.load(await d0.save());
    const [l] = await pageTextLines(d, 0);
    expect(l!.text).toBe('Ünïcødé text');
    expect(l!.font).toMatch(/Roboto/);
    expect(l!.width).toBeCloseTo(f.widthOfTextAtSize('Ünïcødé text', 20), 0);
  });

  it('turns a turned line, and leaves out invisible text', async () => {
    const d = await page(
      'BT /F1 12 Tf 0 1 -1 0 100 100 Tm (Up) Tj ET BT 3 Tr /F1 12 Tf 10 10 Td (hidden) Tj ET',
      {
        F1: PDFLib.StandardFonts.Helvetica,
      },
    );
    const lines = await pageTextLines(d, 0);
    expect(lines.length).toBe(1);
    expect(lines[0]!.angle).toBeCloseTo(90);
  });
});

describe('cutting a line out', () => {
  it('removes it and keeps the rest of the page where it was', async () => {
    /* "x" then a raised "2" drawn straight after it: a line of its own */
    const d = await page(
      'BT /F1 20 Tf 60 300 Td (x) Tj 8 Ts (2) Tj ET BT /F1 12 Tf 60 200 Td (Keep me) Tj ET',
      {
        F1: PDFLib.StandardFonts.Helvetica,
      },
    );
    const before = await pageTextLines(d, 0);
    expect(before.map((l) => l.text)).toEqual(['x', '2', 'Keep me']);
    const out = await PDFLib.PDFDocument.load(await cutText(d, 0, before[0]!.id));
    const after = await pageTextLines(out, 0);
    expect(after.map((l) => l.text)).toEqual(['2', 'Keep me']);
    expect(after[0]!.origin[0]).toBeCloseTo(before[1]!.origin[0], 3);
    expect(after[0]!.origin[1]).toBeCloseTo(before[1]!.origin[1], 3);
    expect((await pageTexts(await out.save()))[0]).not.toMatch(/x/);
  });

  it('keeps the width of what it cuts with \' and " too', async () => {
    const d = await page('BT /F1 12 Tf 14 TL 50 300 Td (one) Tj (two) \' 2 1 (three) " ET', {
      F1: PDFLib.StandardFonts.Helvetica,
    });
    const lines = await pageTextLines(d, 0);
    expect(lines.map((l) => l.text)).toEqual(['one', 'two', 'three']);
    const out = await PDFLib.PDFDocument.load(await cutText(d, 0, lines[1]!.id));
    const after = await pageTextLines(out, 0);
    expect(after.map((l) => l.text)).toEqual(['one', 'three']);
    expect(after[1]!.origin[1]).toBeCloseTo(lines[2]!.origin[1], 3);
  });
});
