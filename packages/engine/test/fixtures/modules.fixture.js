/* Golden fixture for the module marks: annotate, draw (circle, cloud, arc and
   every dimension), docops (redact, watermark, header/footer, Bates), the
   leader, insert (image, video, link, table) and forms (signature).

   Plain JavaScript taking pdf-lib as a parameter, like marks.fixture.js. */

/** A small valid PNG as a data: URL, built by hand so the fixture needs no
    canvas: 4x3 RGB, stored (uncompressed) deflate. */
export function tinyPng() {
  const w = 4,
    h = 3;
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0); /* filter: none */
    for (let x = 0; x < w; x++) raw.push((x * 60) % 256, (y * 80) % 256, 200);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type, data) => {
    const td = [...type].map((ch) => ch.charCodeAt(0)).concat(data);
    return u32(data.length).concat(td, u32(crc(td)));
  };
  let a = 1,
    b = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  const len = raw.length;
  const zlib = [
    0x78,
    0x01,
    0x01,
    len & 255,
    len >> 8,
    ~len & 255,
    (~len >> 8) & 255,
    ...raw,
    ...u32(((b << 16) | a) >>> 0),
  ];
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
    .concat(chunk('IHDR', [...u32(w), ...u32(h), 8, 2, 0, 0, 0]))
    .concat(chunk('IDAT', zlib))
    .concat(chunk('IEND', []));
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...png));
}

/** The editor's drawing scale for the dimension readings: 1:50, in metres. */
export const SCALE = { unit: 'm', denom: 50, custom: null };
export const FILE_NAME = 'fixture';

export async function makeModulesFixture(PDFLib) {
  const { PDFDocument } = PDFLib;
  const d = await PDFDocument.create();
  d.addPage([595.28, 841.89]);
  d.addPage([595.28, 841.89]);
  d.addPage([841.89, 595.28]);
  const src = { id: 'm', name: 'modules.pdf', bytes: await d.save() };
  const png = tinyPng();

  const annotateAndDraw = [
    {
      t: 'markup',
      k: 'highlight',
      c: '#F2C14E',
      quads: [
        [60, 700, 260, 714],
        [60, 684, 180, 698],
      ],
    },
    { t: 'markup', k: 'underline', c: '#E2483D', o: 0.7, quads: [[60, 660, 220, 674]] },
    { t: 'markup', k: 'strike', c: '#E2483D', quads: [[60, 640, 200, 654]] },
    {
      t: 'ink',
      c: '#1E3A8A',
      w: 2.5,
      pts: [
        [300, 700],
        [310, 712],
        [325, 705],
        [340, 720],
      ],
    },
    { t: 'ink', c: '#000000', w: 4, pts: [[380, 700]] },
    { t: 'note', a: [420, 720], c: '#F2C14E' },
    { t: 'note', a: [450, 720], c: '#F2C14E', note: { resolved: true } },
    { t: 'stamp', k: 'approved', a: [60, 560], b: [220, 610] },
    { t: 'stamp', k: 'no-such-stamp', a: [240, 560], b: [400, 600] },
    { t: 'ellipse', a: [60, 420], b: [200, 520], c: '#22A06B', w: 1.5 },
    { t: 'ellipse', a: [220, 420], b: [320, 520], c: '#22A06B', w: 1, d: 1, fill: '#EAF2FF', o: 0.8 },
    { t: 'ellipse', a: [340, 420], b: [480, 500], c: '#8B5CF6', w: 1, r: 20 },
    { t: 'cloud', a: [60, 300], b: [260, 390], c: '#E2483D', w: 1 },
    { t: 'cloud', a: [300, 300], b: [460, 400], c: '#E2483D', w: 1.5, arc: 14, r: 10 },
    { t: 'arc', a: [60, 220], b: [240, 260], c: '#000000', w: 1 },
    { t: 'arc', a: [280, 220], b: [460, 220], c: '#000000', w: 2, bulge: -0.4, d: 2 },
    { t: 'leader', a: [480, 300], m: [520, 360], b: [570, 360], c: '#E2483D', w: 1.2 },
    { t: 'leader', a: [480, 200], m: [510, 250], b: [570, 250], c: '#1E3A8A', w: 2, head: 'dot' },
  ];

  const dims = [
    { t: 'dim', a: [60, 700], b: [300, 700], c: '#E2483D', w: 1 },
    { t: 'dim', a: [60, 640], b: [260, 560], c: '#1E3A8A', w: 0.5, ds: 'tick' },
    { t: 'dim', a: [300, 640], b: [300, 480], c: '#000000', w: 1, ds: 'dot' },
    { t: 'dim', a: [350, 640], b: [520, 640], c: '#000000', w: 1, label: '2400 (site)' },
    { t: 'dimr', a: [150, 380], b: [260, 440], rad: 60, c: '#E2483D', w: 1 },
    { t: 'dimd', a: [400, 380], b: [410, 390], rad: 70, c: '#E2483D', w: 1, ds: 'tick' },
    { t: 'dima', a: [100, 150], b: [180, 200], a1: 0, a2: Math.PI / 3, l1: 60, l2: 40, c: '#22A06B', w: 1 },
    {
      t: 'dima',
      a: [400, 150],
      b: [380, 120],
      a1: 0,
      a2: 1,
      l1: 200,
      l2: 200,
      c: '#22A06B',
      w: 1.5,
      ds: 'dot',
    },
  ];

  const docAndInsert = [
    { t: 'redact', a: [60, 500], b: [200, 540] },
    { t: 'wm', text: 'CONFIDENTIAL', size: 48, c: '#D23C2E', o: 0.25, r: 30 },
    { t: 'wm', text: 'DRAFT', size: 20, c: '#8A8A8A', o: 0.15, r: -20, tile: true },
    {
      t: 'hf',
      size: 9,
      margin: 30,
      c: '#1C1F24',
      cfg: { hl: '{file}', hc: '', hr: 'Page {page} of {pages}', fl: 'ADD DOTS', fc: 'Issued', fr: '' },
    },
    { t: 'bates', label: 'ADD-000123', size: 10, pos: 'br', c: '#000000' },
    { t: 'bates', label: 'TOP-LEFT', size: 8, pos: 'tl', c: '#1E3A8A' },
    { t: 'image', url: png, a: [300, 380], b: [460, 500], c: '#1C1F24', w: 0 },
    { t: 'image', url: png, a: [500, 380], b: [640, 480], c: '#E2483D', w: 2, r: 15 },
    {
      t: 'video',
      url: png,
      src: 'https://example.com/clip.mp4',
      a: [60, 200],
      b: [220, 320],
      c: '#1C1F24',
      w: 1,
    },
    {
      t: 'link',
      url: 'https://adddots.com',
      style: 'underline',
      label: 'ADD DOTS site',
      a: [260, 200],
      b: [420, 230],
    },
    {
      t: 'link',
      url: 'https://adddots.com/help',
      style: 'button',
      label: 'Help',
      a: [440, 200],
      b: [540, 236],
      c: '#22A06B',
    },
    { t: 'link', url: 'https://adddots.com/i', style: 'icon', a: [560, 200], b: [586, 226] },
    {
      t: 'table',
      rows: 3,
      cols: 3,
      a: [260, 60],
      b: [560, 150],
      c: '#8A8F98',
      w: 1,
      colW: [0.5, 0.25, 0.25],
      cells: [
        ['Item', 'Qty', 'Rate'],
        ['Door D1 including a very long description here', '2', '1200'],
        ['', '', ''],
      ],
    },
    { t: 'sig', url: png, a: [60, 60], b: [200, 120] },
  ];

  return [
    { src, num: 1, rot: 0, crop: null, shapes: annotateAndDraw },
    { src, num: 2, rot: 0, crop: null, shapes: dims },
    { src, num: 3, rot: 0, crop: null, shapes: docAndInsert },
  ];
}
