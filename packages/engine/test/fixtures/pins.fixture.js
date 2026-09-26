/* Golden fixture for photo pins: the numbered discs on the drawing and the
   photo appendix (the index of locations, then each location's photos).

   33 locations, so the index runs to a second page (30 to a page); one with no
   photos, one with a single photo (shown large), one with five (two pages);
   captions, a note, a BOQ number, a reference long enough to be shortened, a
   character the standard font cannot encode, and a pin on a turned page whose
   number has to stay upright. */

import { tinyPng } from './modules.fixture.js';

export const FILE_NAME = 'Door schedule';

export async function makePinsFixture(PDFLib) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  d.addPage([841.89, 595.28]);
  const src = { id: 'pins', name: 'pins.pdf', bytes: await d.save() };
  const png = tinyPng();
  const photo = (cap) => ({ src: png, cap });

  const locs = {};
  const add = (L) => (locs[L.id] = L);
  add({
    id: 'L1',
    n: '1',
    ref: 'D1',
    desc: 'Main entrance door',
    boq: '4.2.1',
    note: 'Check the closer',
    photos: [photo('Frame head'), photo('')],
  });
  add({
    id: 'L2',
    n: '2',
    ref: 'A very long location reference that will not fit',
    desc: 'Stair core → level 2 ✓',
    photos: [],
  });
  add({ id: 'L3', n: '3', ref: 'W7', desc: 'Window', photos: [photo('Only one')] });
  add({
    id: 'L4',
    n: '12',
    ref: 'R12',
    desc: 'Roof access hatch',
    boq: '9.1',
    photos: [photo('1'), photo('2'), photo('3'), photo('4'), photo('5 — last')],
  });
  for (let i = 5; i <= 33; i++) add({ id: 'L' + i, n: String(i + 8), ref: 'X' + i, photos: [] });

  const pinsOn = (ids, x0, y0) =>
    ids.map((id, k) => ({ t: 'pin', id, a: [x0 + (k % 6) * 70, y0 - Math.floor(k / 6) * 60] }));
  const ids = Object.keys(locs);
  const items = [
    { src, num: 1, rot: 0, crop: null, shapes: pinsOn(ids.slice(0, 20), 60, 780) },
    /* the second page is turned, and holds pin 1 again (one location, two pins) */
    { src, num: 2, rot: 90, crop: null, shapes: pinsOn(ids.slice(20).concat(['L1']), 60, 540) },
  ];
  return { items, locs };
}
