/* Inputs for the page-range, split and zip helpers. The golden holds what v1's
   own functions returned for each, recorded in the browser. */

/** A small deterministic generator, so the random cases are the same everywhere. */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Range text as people type it, and as they mistype it, plus page counts. */
export function rangeCases() {
  const typed = [
    '',
    '1',
    '3',
    '0',
    '-1',
    '99',
    '1-3',
    '3-1',
    '1-3, 7',
    '2, 5-7, 4',
    '1,1,1',
    '5-5',
    '1 - 3',
    '1–3',
    '1—3',
    '1‐3',
    '1−3',
    '7-',
    '-7',
    'a',
    '1-a',
    '1-3-5',
    '1..3',
    '2;4 6',
    ' 2 ,  4 ',
    '1-3,,5',
    '10-12, 1',
    '4, 3, 2, 1',
    '1-100',
    '0-2',
    '12-9',
    '1 2 3',
    '1-2,2-3',
    'all',
    '3-',
    'x1',
    '1x',
    '2,',
    ',2',
    '  ',
    '\t1-2\n',
    '001-003',
    '1.5',
    '1e1',
    '٣',
    '１-３',
  ];
  const rand = rng(20260926);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const random = [];
  for (let i = 0; i < 160; i++) {
    const parts = [];
    const k = 1 + Math.floor(rand() * 4);
    for (let j = 0; j < k; j++) {
      const a = Math.floor(rand() * 30) - 3;
      parts.push(rand() < 0.5 ? String(a) : a + pick(['-', ' - ', '–', '-']) + (Math.floor(rand() * 30) - 3));
    }
    random.push(parts.join(pick([',', ', ', ';', ' ', ',,'])));
  }
  const counts = [1, 5, 12, 40];
  return typed.concat(random).flatMap((text) => counts.map((n) => ({ text, n })));
}

/** Page-number lists for formatRanges and rangeTag. */
export function numberLists() {
  const rand = rng(7);
  const lists = [[], [1], [1, 2, 3], [3, 1, 2], [1, 3, 5], [1, 2, 4, 5, 6, 9], [7, 7, 8]];
  for (let i = 0; i < 60; i++) {
    const n = 1 + Math.floor(rand() * 25);
    const out = [];
    for (let j = 0; j < n; j++) out.push(1 + Math.floor(rand() * 60));
    lists.push(out);
  }
  return lists;
}

/** Split every k pages, for n pages. */
export function everyCases() {
  const out = [];
  for (const n of [1, 2, 5, 7, 12]) for (const k of [0, 1, 2, 3, 5, 12, 20]) out.push({ n, k });
  return out;
}

/** Files for the zip writer, and the fixed moment their timestamps use. */
export function zipCase() {
  const enc = new TextEncoder();
  const bytes = (n, seed) => {
    const r = rng(seed);
    return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
  };
  return {
    when: [2026, 8, 26, 21, 47, 33], // y, month (0-based), d, h, m, s
    files: [
      { name: 'Door schedule — 1.pdf', data: bytes(1500, 1) },
      { name: 'empty.pdf', data: new Uint8Array(0) },
      { name: 'Café page 2-4.pdf', data: bytes(70000, 2) },
      { name: 'a.txt', data: enc.encode('hello\n') },
    ],
  };
}
