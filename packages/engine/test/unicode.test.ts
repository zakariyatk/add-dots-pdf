import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildPdf,
  createTextMeasurer,
  docopsFontNeeds,
  docopsPainters,
  docopsPrepare,
  fieldsFinish,
  fitLine,
  insertPainters,
  needsUnicode,
  pinHooks,
  prepareInsert,
  textRuns,
  textWidth,
  wrapText,
  type Face,
  type FieldValues,
  type FormField,
  type PageItem,
  type PinLocation,
  type SaveHooks,
  type UnicodeFontSource,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { tinyPng } from './fixtures/modules.fixture.js';
import { FONT_PATH, pageTexts, unicodeSource } from './support/unicode';

/* Text the standard fonts cannot draw (✓ →, Greek, Cyrillic, Arabic digits)
   is drawn in the embedded fallback font and reads back unchanged; text they
   can draw (• € © ™, accented letters) stays in the standard font. */

const APPROVED = 'Approved ✓ by the site engineer → OK';
const WINANSI = 'Café • 5 € © ™ — Ünïcödé ñ';

async function blankSource(pages = 1) {
  const d = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595.28, 841.89]);
  return { id: 'u' + Math.random(), name: 'u.pdf', bytes: await d.save() };
}

async function faces(): Promise<{ helv: PDFLib.PDFFont; face: Face }> {
  const d = await PDFLib.PDFDocument.create();
  const { fontkit, bytes } = await unicodeSource.load();
  d.registerFontkit(fontkit as Parameters<PDFLib.PDFDocument['registerFontkit']>[0]);
  const helv = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  const fallback = await d.embedFont(bytes, { subset: true });
  return { helv, face: { font: helv, fallback } };
}

/** Every font the saved file carries: its name and, when embedded, the size of
    the font program. */
async function fontsIn(bytes: Uint8Array): Promise<{ name: string; program: number; toUnicode: boolean }[]> {
  const doc = await PDFLib.PDFDocument.load(bytes);
  const out: { name: string; program: number; toUnicode: boolean }[] = [];
  const N = PDFLib.PDFName.of;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFLib.PDFDict) || obj.get(N('Type')) !== N('Font')) continue;
    if (obj.get(N('Subtype')) === N('CIDFontType2')) continue; // counted with its Type0 parent
    const name = String(obj.get(N('BaseFont'))).replace(/^\//, '');
    let program = 0;
    const desc = obj.lookup(N('DescendantFonts'));
    if (desc instanceof PDFLib.PDFArray) {
      const cid = desc.lookup(0, PDFLib.PDFDict);
      const fd = cid.lookup(N('FontDescriptor'), PDFLib.PDFDict);
      const ff = fd.lookup(N('FontFile2'));
      if (ff instanceof PDFLib.PDFRawStream) program = ff.contents.length;
    }
    out.push({ name, program, toUnicode: !!obj.get(N('ToUnicode')) });
  }
  return out;
}

describe('text runs', () => {
  it('keeps WinAnsi text (• € © ™, accents) in the standard font, in one piece', async () => {
    const { face } = await faces();
    expect(needsUnicode(WINANSI)).toBe(false);
    const runs = textRuns(WINANSI, face);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe(WINANSI);
    expect(runs[0]!.font).toBe(face.font);
  });

  it('sends only what the standard font lacks to the fallback', async () => {
    const { face } = await faces();
    expect(needsUnicode(APPROVED)).toBe(true);
    const runs = textRuns(APPROVED, face);
    expect(runs.map((r) => [r.text, r.font === face.fallback])).toEqual([
      ['Approved ', false],
      ['✓', true],
      [' by the site engineer ', false],
      ['→', true],
      [' OK', false],
    ]);
    expect(runs.map((r) => r.text).join('')).toBe(APPROVED);
    const sum = runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, 12), 0);
    expect(textWidth(APPROVED, 12, face)).toBeCloseTo(sum, 9);
  });

  it('with no fallback font to hand, uses ? rather than failing', async () => {
    const { helv } = await faces();
    expect(textRuns(APPROVED, helv).map((r) => r.text)).toEqual(['Approved ? by the site engineer ? OK']);
  });

  it('shortens with an ellipsis between whole characters, never inside one', async () => {
    const { face } = await faces();
    const fitted = fitLine(face, '✓→'.repeat(40) + '🙂'.repeat(10), 10, 80);
    expect(fitted.endsWith('…')).toBe(true);
    expect(textWidth(fitted, 10, face)).toBeLessThanOrEqual(80);
    expect(Array.from(fitted).every((ch) => ch.codePointAt(0)! < 0xd800 || ch.codePointAt(0)! > 0xdfff)).toBe(
      true,
    );
  });
});

describe('save and reopen: every character comes back unchanged', () => {
  let texts: string[];
  let bytes: Uint8Array;
  const env = { totalPages: () => 1, fileName: () => 'Χάρτης ✓', today: () => '27 Σεπ 2026' };

  beforeAll(async () => {
    const src = await blankSource();
    const text = (y: number, t: string, more: object = {}) => ({
      t: 'text',
      a: [40, y],
      c: '#000000',
      text: t,
      size: 11,
      f: 'helv',
      ...more,
    });
    const L: PinLocation = {
      id: 'L1',
      n: '1',
      ref: '✓ R1',
      desc: 'Stair core → level 2 ✓',
      note: 'Checked ✓',
      photos: [{ src: tinyPng(), cap: 'Frame → head' }],
    };
    const shapes = [
      text(800, APPROVED),
      text(780, WINANSI, { f: 'times', b: true }),
      text(760, 'Ωμέγα · Кириллица'),
      text(740, 'Centred ✓ → line', { align: 'center', u: true }),
      {
        t: 'table',
        a: [40, 600],
        b: [340, 660],
        c: '#000000',
        w: 1,
        rows: 1,
        cols: 2,
        cells: [['Door ✓', 'Arrow → here']],
      },
      {
        t: 'link',
        a: [40, 560],
        b: [240, 580],
        c: '#2F6FED',
        w: 1,
        url: 'https://x.test',
        label: 'Open ✓ link',
        style: 'underline',
      },
      { t: 'bates', a: [0, 0], b: [0, 0], c: '#000000', w: 1, label: 'ADD → 0001', size: 9, pos: 'br' },
      {
        t: 'hf',
        a: [0, 0],
        b: [0, 0],
        c: '#000000',
        w: 1,
        size: 9,
        margin: 24,
        cfg: { hl: '{file}', hr: '{date}' },
      },
      { t: 'wm', a: [0, 0], b: [0, 0], c: '#999999', w: 1, text: 'DRAFT ✓', size: 40, o: 0.3 },
      { t: 'pin', id: 'L1', a: [500, 500], c: '#000000' },
    ];
    const fields: FormField[] = [
      { name: 'one', type: 'Tx', rect: [40, 400, 560, 420] },
      { name: 'many', type: 'Tx', rect: [40, 300, 300, 380], multiline: true },
    ];
    const values: FieldValues = { one: APPROVED, many: 'Line → one\nTick ✓ two' };
    const items = [{ src, num: 1, rot: 0, crop: null, shapes, fields }] as unknown as PageItem[];
    const hooks: SaveHooks = {
      measure: await createTextMeasurer(),
      unicode: unicodeSource,
      shapePainters: { ...insertPainters, ...docopsPainters(env) },
      fontNeeds: docopsFontNeeds,
      prepare: [prepareInsert, docopsPrepare(env)],
      finish: [fieldsFinish(() => values)],
      pins: pinHooks({ L1: L }, { docName: () => 'Plan ✓' }),
    };
    bytes = await buildPdf(items, null, { photos: true }, hooks);
    texts = await pageTexts(bytes);
  });

  it.each([
    ['a text mark', APPROVED],
    ['a WinAnsi text mark (• € © ™ and accents)', WINANSI],
    ['Greek and Cyrillic', 'Ωμέγα · Кириллица'],
    ['a centred, underlined line', 'Centred ✓ → line'],
    ['a table cell', 'Door ✓'],
    ['another table cell', 'Arrow → here'],
    ['a link label', 'Open ✓ link'],
    ['a Bates number', 'ADD → 0001'],
    ['the header: file name', 'Χάρτης ✓'],
    ['the header: date, in Greek', '27 Σεπ 2026'],
    ['the watermark', 'DRAFT ✓'],
    ['a one-line form answer', APPROVED],
    ['a multi-line form answer, line 1', 'Line → one'],
    ['a multi-line form answer, line 2', 'Tick ✓ two'],
  ])('%s', (_, want) => {
    expect(texts[0]).toContain(want);
  });

  it('the photo pages: document name, reference, description, note, caption', () => {
    const appendix = texts.slice(1).join('\n');
    for (const want of ['Plan ✓', '✓ R1', 'Stair core → level 2 ✓', 'Checked ✓', 'Frame → head'])
      expect(appendix).toContain(want);
  });

  it('no character is lost or replaced', () => {
    const all = texts.join('\n');
    expect(all).not.toContain('?');
    expect(all).not.toContain('\u0000');
  });

  it('embeds the fallback once, as a small subset with a ToUnicode map', async () => {
    const dv = (await fontsIn(bytes)).filter((f) => /^DejaVuSans\b/.test(f.name));
    expect(dv).toHaveLength(1);
    expect(dv[0]!.toUnicode).toBe(true);
    expect(dv[0]!.program).toBeGreaterThan(0);
    expect(dv[0]!.program).toBeLessThan(60_000); // the whole font file is ~740 KB
  });
});

describe('the fallback font is loaded only when needed', () => {
  const save = async (text: string, unicode: UnicodeFontSource) => {
    const src = await blankSource();
    const items = [
      {
        src,
        num: 1,
        rot: 0,
        crop: null,
        shapes: [{ t: 'text', a: [40, 800], c: '#000000', text, size: 12, f: 'helv' }],
      },
    ] as unknown as PageItem[];
    return buildPdf(items, null, {}, { measure: await createTextMeasurer(), unicode });
  };

  it('not for text the standard fonts can draw', async () => {
    const load = vi.fn(unicodeSource.load);
    const bytes = await save(WINANSI, { load });
    expect(load).not.toHaveBeenCalled();
    expect((await fontsIn(bytes)).map((f) => f.name)).toEqual(['Helvetica']);
    expect((await pageTexts(bytes))[0]).toContain(WINANSI);
  });

  it('once per save when some text needs it', async () => {
    const load = vi.fn(unicodeSource.load);
    await save(APPROVED + '\n' + APPROVED, { load });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('if it cannot be loaded, the save still completes (with ? for what is missing)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bytes = await save(APPROVED, {
      load: () => {
        throw new Error('offline');
      },
    });
    expect((await pageTexts(bytes))[0]).toContain('Approved ? by the site engineer ? OK');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reads the font file the tests use', () => {
    expect(FONT_PATH).toMatch(/DejaVuSans\.ttf$/);
  });
});

describe('oversized words in multi-line fields', () => {
  const ROOM = 60;

  it('a word wider than the field is broken between characters, not left to overflow', async () => {
    const { face } = await faces();
    const word = 'Supercalifragilisticexpialidocious';
    const lines = wrapText(word, face, 10, ROOM);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(word);
    for (const l of lines) expect(textWidth(l, 10, face)).toBeLessThanOrEqual(ROOM);
  });

  it('the same for a word in the fallback font', async () => {
    const { face } = await faces();
    const word = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ✓→';
    const lines = wrapText(word, face, 10, ROOM);
    expect(lines.join('')).toBe(word);
    for (const l of lines) expect(textWidth(l, 10, face)).toBeLessThanOrEqual(ROOM);
  });

  it('words either side keep their places, and words that fit are not broken', async () => {
    const { face } = await faces();
    const lines = wrapText('go Supercalifragilisticexpialidocious end', face, 10, ROOM);
    expect(lines[0]).toBe('go');
    expect(lines.slice(1).join('').replace(/ end$/, '')).toBe('Supercalifragilisticexpialidocious');
    expect(lines.join(' ').endsWith('end')).toBe(true);
    expect(wrapText('Hello world, fine', face, 10, 200)).toEqual(['Hello world, fine']);
  });

  it('in a saved PDF, the broken word stays inside its box and reads back whole', async () => {
    const src = await blankSource();
    const word = 'Supercalifragilisticexpialidocious✓';
    const fields: FormField[] = [
      { name: 'm', type: 'Tx', rect: [40, 600, 104, 700], multiline: true, fontSize: 10 },
    ];
    const items = [{ src, num: 1, rot: 0, crop: null, shapes: [], fields }] as unknown as PageItem[];
    const bytes = await buildPdf(
      items,
      null,
      {},
      {
        measure: await createTextMeasurer(),
        unicode: unicodeSource,
        finish: [fieldsFinish(() => ({ m: word }))],
      },
    );
    const text = (await pageTexts(bytes))[0]!;
    expect(text.replace(/\s/g, '')).toBe(word);
    /* every Tm x is the box's left edge plus 2 */
    const doc = await PDFLib.PDFDocument.load(bytes);
    const page = doc.getPages()[0]!;
    const contents = page.node.Contents()!;
    const refs = contents instanceof PDFLib.PDFArray ? contents.asArray() : [contents];
    const stream = refs
      .map((r) => {
        const s = doc.context.lookup(r) as PDFLib.PDFRawStream;
        return Buffer.from(PDFLib.decodePDFRawStream(s).decode()).toString('latin1');
      })
      .join('\n');
    const lineStarts = [...stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => +m[1]!);
    expect(lineStarts.length).toBeGreaterThan(1);
    expect(Math.min(...lineStarts)).toBe(42);
  });
});
