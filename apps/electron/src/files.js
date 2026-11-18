/* What the desktop side does with files, apart from Electron so it can be
   tested in plain Node (test/files.test.js). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/* PDFs among a start's arguments, resolved against the folder that start
   was made from. argv[0] is the program; when Electron runs unpackaged
   (`electron .`) argv[1] is the app's folder, which is never a .pdf. */
function pdfArgs(argv, cwd) {
  return argv
    .slice(1)
    .filter((a) => typeof a === 'string' && !a.startsWith('-'))
    .filter((a) => /\.pdf$/i.test(a))
    .map((a) => (path.isAbsolute(a) ? path.normalize(a) : path.resolve(cwd, a)));
}

/* Explorer's "Combine files in Add Dots PDF" (build/installer.nsh) */
function isCombine(argv) {
  return argv.slice(1).includes('--combine');
}

/* A name the Save dialog can offer: no folders, nothing Windows refuses. */
function safeName(name) {
  const n = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return n || 'document.pdf';
}

/* Writes a file whole or not at all: a temporary file beside it, flushed to
   disk, then renamed into its place. */
function writeAtomic(file, bytes) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.saving');
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    replace(tmp, file);
  } catch (e) {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to tidy */
    }
    throw e;
  }
}

/* `tmp` renamed over `file`. On Windows a rename cannot replace a file that
   is still open (a big document read a part at a time, Opened.openPlan), as
   Node renames the old way; the open file can be moved aside, though, and
   deleted, which Windows finishes once it is closed. The open document
   keeps reading the file as it was. */
function replace(tmp, file) {
  try {
    fs.renameSync(tmp, file);
    return;
  } catch (e) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
  }
  const aside = tmp + '.old';
  fs.renameSync(file, aside);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.renameSync(aside, file);
    throw e;
  }
  try {
    fs.unlinkSync(aside);
  } catch {
    /* left beside it, hidden: the next save tidies nothing, but no harm */
  }
}

/* `len` bytes of an open file from `offset` (fewer at its end). */
function readRange(fd, offset, len) {
  const size = fs.fstatSync(fd).size;
  const n = Math.max(0, Math.min(len, size - offset));
  const out = Buffer.alloc(n);
  let got = 0;
  while (got < n) {
    const r = fs.readSync(fd, out, got, n - got, offset + got);
    if (!r) break;
    got += r;
  }
  return got === n ? out : out.subarray(0, got);
}

/* The files the system handed over: the only ones the page may read. */
class Opened {
  constructor() {
    this.pending = [];
    this.combine = [];
    this.allowed = new Set();
    this.ranged = new Map();
    this.nextRange = 0;
  }
  key(p) {
    return process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
  }
  remember(paths) {
    for (const p of paths) this.allowed.add(this.key(p));
    return paths;
  }
  check(p) {
    if (typeof p !== 'string' || !this.allowed.has(this.key(p))) {
      throw new Error('not a file this app was asked to open');
    }
    return p;
  }
  /* handed over by a start: queued until a page takes them */
  handOver(argv, cwd) {
    const files = this.remember(pdfArgs(argv, cwd));
    const combine = isCombine(argv);
    (combine ? this.combine : this.pending).push(...files);
    return { files, combine };
  }
  take(which) {
    const out = this[which];
    this[which] = [];
    return out;
  }
  /* big files (over 150 MB, ADDDOTS_RANGE_MB) or `keep`: kept open and read
     a part at a time, as the file was when opened */
  openPlan(p, keep) {
    this.check(p);
    const size = fs.statSync(p).size;
    /* 0 is a size too (the tests: every file read a part at a time) */
    const env = process.env.ADDDOTS_RANGE_MB;
    const mb = env !== undefined && env !== '' && Number.isFinite(Number(env)) ? Number(env) : 150;
    const ranges = !!keep || size > mb * 1024 * 1024;
    let id = null;
    if (ranges) {
      id = ++this.nextRange;
      this.ranged.set(id, fs.openSync(p, 'r'));
    }
    return { size, ranges, id };
  }
  range(id, offset, len) {
    const fd = this.ranged.get(id);
    if (fd === undefined) throw new Error('that file is not open');
    return readRange(fd, offset, len);
  }
  closeRange(id) {
    const fd = this.ranged.get(id);
    if (fd !== undefined) {
      this.ranged.delete(id);
      fs.closeSync(fd);
    }
  }
}

module.exports = { pdfArgs, isCombine, safeName, writeAtomic, readRange, Opened };
