/* Page ranges, split groups and the zip writer used by extract, split and
   "pages as JPG". Moved from core.js and organize.js unchanged. */

/** "2, 5-7, 4" -> [2, 4, 5, 6, 7]: page numbers (1-based), sorted, each once,
    clamped to 1..max. Any dash counts; anything unreadable is skipped. */
export function parseRanges(str: string, max: number): number[] {
  const out: number[] = [],
    seen: Record<number, 1> = {};
  String(str)
    .replace(/\s*[-‐-―]\s*/g, '-')
    .split(/[,;\s]+/)
    .forEach((part) => {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return;
      let a = parseInt(m[1]!, 10),
        b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(max, b); i++) {
        if (!seen[i]) {
          seen[i] = 1;
          out.push(i);
        }
      }
    });
  return out.sort((x, y) => x - y);
}

/** [1, 2, 3, 5, 7, 8] -> "1-3, 5, 7-8" */
export function formatRanges(nums: readonly number[]): string {
  const a = nums.slice().sort((x, y) => x - y);
  const out: string[] = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j]! + 1) j++;
    out.push(i === j ? String(a[i]) : a[i] + '-' + a[j]);
    i = j + 1;
  }
  return out.join(', ');
}

/** A short label for a file name: "1-3_5", or "12pages" when that gets long. */
export function rangeTag(nums: readonly number[]): string {
  const t = formatRanges(nums).replace(/,\s*/g, '_');
  return t.length <= 24 ? t : nums.length + 'pages';
}

/** Split by ranges: each comma-separated part is one output file, in the order
    typed, as 0-based page indexes. Clamped to 1..n; unreadable parts dropped.
    (Split's own reading, which differs from parseRanges on purpose: "1-3, 7"
    makes two files, and a page may appear in more than one.) */
export function parseRangeGroups(text: string, n: number): number[][] {
  return String(text || '')
    .split(',')
    .map((part) => {
      const m = part.trim().match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
      if (!m) return null;
      const a = Math.max(1, Math.min(n, +m[1]!));
      const b = m[2] ? Math.max(1, Math.min(n, +m[2])) : a;
      const lo = Math.min(a, b),
        hi = Math.max(a, b);
      return Array.from({ length: hi - lo + 1 }, (_, j) => lo - 1 + j);
    })
    .filter((g): g is number[] => !!g && g.length > 0);
}

/** Split every k pages (k as typed; anything below 1 or unreadable means 1). */
export function splitEvery(n: number, k: string | number): number[][] {
  const step = Math.max(1, parseInt(String(k), 10) || 1),
    out: number[][] = [];
  for (let i = 0; i < n; i += step) out.push(Array.from({ length: Math.min(step, n - i) }, (_, j) => i + j));
  return out;
}

/** One file per page, as 0-based indexes. */
export function splitEach(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [i]);
}

/* ---------------- zip ---------------- */

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

/** A store-only zip. PDF streams are already compressed, so deflating them
    again would cost time and save almost nothing, and this keeps the writer
    tiny. File names are UTF-8. `now` dates the entries. */
export function zipStore(files: readonly ZipFile[], now: Date = new Date()): Uint8Array {
  const enc = new TextEncoder(),
    parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  const d = now;
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  let off = 0;
  files.forEach((f) => {
    const nm = enc.encode(f.name),
      data = f.data,
      crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nm, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true);
    c.setUint16(30, 0, true);
    c.setUint16(32, 0, true);
    c.setUint16(34, 0, true);
    c.setUint16(36, 0, true);
    c.setUint32(38, 0, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  });
  const cSize = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(4, 0, true);
  e.setUint16(6, 0, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cSize, true);
  e.setUint32(16, off, true);
  e.setUint16(20, 0, true);

  const all = parts.concat(central, [new Uint8Array(e.buffer)]);
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
