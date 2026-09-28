/* Saving onto the original: an incremental update.

   A PDF can be changed by appending to it: the objects that changed, a new
   cross-reference section for them, and a trailer pointing back to the
   previous one (/Prev). Everything else is left exactly as it was, bytes and
   all. Saving a few marks onto an 84 MB file of scans then writes a few
   kilobytes after it instead of rewriting all of it, and keeps what a rebuild
   drops: bookmarks, links, the structure, attachments, a signature's bytes.

   pdf-lib cannot write an update itself; it only rewrites the whole file. So
   the marks are painted onto the loaded original (the same painting a
   rebuild does), the objects are compared with how they were loaded, and the
   ones that changed are serialised here, in the form the original's last
   cross-reference section has (a table, or a stream). */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFObject,
} from 'pdf-lib';

const enc = new TextEncoder();

/** Where the original's last cross-reference section is, and its form. */
export interface XrefTail {
  /** byte offset of the last section (the number after `startxref`) */
  offset: number;
  stream: boolean;
  /** the section's /Size: one past the highest object number in the file,
      counting the object streams and cross-reference streams pdf-lib does
      not keep, so new objects are numbered past them all */
  size: number;
}

/** Reads the original's `startxref`; null when it cannot be found or does not point at a section. */
export function readXrefTail(bytes: Uint8Array): XrefTail | null {
  const from = Math.max(0, bytes.length - 2048);
  const tail = new TextDecoder('latin1').decode(bytes.subarray(from));
  const at = tail.lastIndexOf('startxref');
  if (at < 0) return null;
  const m = /^startxref\s+(\d+)/.exec(tail.slice(at));
  if (!m) return null;
  const offset = +m[1]!;
  if (!(offset > 0 && offset < bytes.length)) return null;
  let i = offset;
  while (i < bytes.length && /\s/.test(String.fromCharCode(bytes[i]!))) i++;
  const head = new TextDecoder('latin1').decode(bytes.subarray(i, Math.min(bytes.length, i + 40)));
  const stream = /^\d+\s+\d+\s+obj\b/.test(head);
  if (!stream && !head.startsWith('xref')) return null;
  /* the trailer (after a table's entries, 20 bytes each) or the stream's own dictionary */
  const text = new TextDecoder('latin1').decode(bytes.subarray(i, bytes.length));
  const dict = stream ? text.slice(0, text.indexOf('stream')) : text.slice(text.indexOf('trailer'));
  const size = /\/Size\s+(\d+)/.exec(dict);
  if (!size || (!stream && text.indexOf('trailer') < 0)) return null;
  return { offset, stream, size: +size[1]! };
}

/** New objects are numbered past every object the original has. */
export function reserveNumbers(doc: PDFDocument, tail: XrefTail): void {
  doc.context.largestObjectNumber = Math.max(doc.context.largestObjectNumber, tail.size - 1);
}

/** How every object looked when loaded, to find the ones painting changed. */
export type Snapshot = Map<string, { obj: PDFObject; sig: string }>;

function signature(obj: PDFObject): string {
  /* a stream's data is never changed in place; a new one replaces it */
  return obj instanceof PDFStream ? obj.dict.toString() : obj.toString();
}

export function snapshot(doc: PDFDocument): Snapshot {
  const snap: Snapshot = new Map();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    snap.set(ref.tag, { obj, sig: signature(obj) });
  }
  return snap;
}

/** The objects added or changed since the snapshot, in object-number order. */
export function changedObjects(doc: PDFDocument, snap: Snapshot): [PDFRef, PDFObject][] {
  const out: [PDFRef, PDFObject][] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const was = snap.get(ref.tag);
    if (!was || was.obj !== obj || was.sig !== signature(obj)) out.push([ref, obj]);
  }
  return out.sort((a, b) => a[0].objectNumber - b[0].objectNumber);
}

function bytesOf(obj: PDFObject): Uint8Array {
  const b = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(b, 0);
  return b;
}

/* consecutive object numbers, as a cross-reference section groups them */
function runs(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === n) last[1]++;
    else out.push([n, 1]);
  }
  return out;
}

/**
 * The update to append to `original` (the bytes the document was loaded
 * from): the changed objects, a cross-reference section and a trailer.
 */
export function writeUpdate(
  doc: PDFDocument,
  snap: Snapshot,
  original: Uint8Array,
  tail: XrefTail,
): Uint8Array {
  const changed = changedObjects(doc, snap);
  const ctx = doc.context;
  const parts: Uint8Array[] = [];
  let size = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    size += b.length;
  };
  const last = original[original.length - 1];
  /* an object must start on a line of its own */
  if (last !== 0x0a && last !== 0x0d) push(enc.encode('\n'));
  const base = original.length;

  const offsets = new Map<number, { offset: number; gen: number }>();
  for (const [ref, obj] of changed) {
    offsets.set(ref.objectNumber, { offset: base + size, gen: ref.generationNumber });
    push(enc.encode(ref.objectNumber + ' ' + ref.generationNumber + ' obj\n'));
    push(bytesOf(obj));
    push(enc.encode('\nendobj\n'));
  }

  const trailer = ctx.trailerInfo;
  const xrefAt = base + size;
  if (!tail.stream) {
    let s = 'xref\n';
    for (const [first, count] of runs([...offsets.keys()])) {
      s += first + ' ' + count + '\n';
      for (let n = first; n < first + count; n++) {
        const e = offsets.get(n)!;
        s += String(e.offset).padStart(10, '0') + ' ' + String(e.gen).padStart(5, '0') + ' n\r\n';
      }
    }
    const t = PDFDict.withContext(ctx);
    t.set(PDFName.of('Size'), PDFNumber.of(ctx.largestObjectNumber + 1));
    if (trailer.Root) t.set(PDFName.of('Root'), trailer.Root);
    if (trailer.Info) t.set(PDFName.of('Info'), trailer.Info);
    if (trailer.ID) t.set(PDFName.of('ID'), trailer.ID);
    t.set(PDFName.of('Prev'), PDFNumber.of(tail.offset));
    s += 'trailer\n' + t.toString() + '\nstartxref\n' + xrefAt + '\n%%EOF\n';
    push(enc.encode(s));
  } else {
    /* a cross-reference stream, as the original ends with one: it is an
       object too, the next number up, and lists itself */
    const own = ctx.largestObjectNumber + 1;
    offsets.set(own, { offset: xrefAt, gen: 0 });
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const w = xrefAt > 0xffffffff ? 8 : 4;
    const data = new Uint8Array(nums.length * (1 + w + 2));
    nums.forEach((n, k) => {
      const e = offsets.get(n)!;
      let o = k * (1 + w + 2);
      data[o++] = 1;
      for (let b = w - 1; b >= 0; b--) data[o++] = Math.floor(e.offset / 2 ** (8 * b)) & 0xff;
      data[o++] = (e.gen >> 8) & 0xff;
      data[o] = e.gen & 0xff;
    });
    const d = PDFDict.withContext(ctx);
    d.set(PDFName.of('Type'), PDFName.of('XRef'));
    d.set(PDFName.of('Size'), PDFNumber.of(own + 1));
    const index = PDFArray.withContext(ctx);
    for (const [first, count] of runs(nums)) {
      index.push(PDFNumber.of(first));
      index.push(PDFNumber.of(count));
    }
    d.set(PDFName.of('Index'), index);
    d.set(PDFName.of('W'), ctx.obj([1, w, 2]));
    if (trailer.Root) d.set(PDFName.of('Root'), trailer.Root);
    if (trailer.Info) d.set(PDFName.of('Info'), trailer.Info);
    if (trailer.ID) d.set(PDFName.of('ID'), trailer.ID);
    d.set(PDFName.of('Prev'), PDFNumber.of(tail.offset));
    d.set(PDFName.of('Length'), PDFNumber.of(data.length));
    push(enc.encode(own + ' 0 obj\n'));
    push(bytesOf(PDFRawStream.of(d, data)));
    push(enc.encode('\nendobj\nstartxref\n' + xrefAt + '\n%%EOF\n'));
  }

  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
