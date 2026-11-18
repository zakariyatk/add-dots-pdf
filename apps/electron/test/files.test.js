/* The desktop side's file rules (src/files.js), in plain Node. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pdfArgs, isCombine, safeName, writeAtomic, readRange, Opened } = require('../src/files');

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adddots-' + name + '-'));
}

test('only PDFs after the program are taken', () => {
  const cwd = os.tmpdir();
  const abs = path.join(cwd, 'elsewhere', 'b.pdf');
  assert.deepEqual(pdfArgs(['adddots-pdf', '--flag', 'plan.PDF', 'notes.txt', abs], cwd), [
    path.join(cwd, 'plan.PDF'),
    abs,
  ]);
  assert.deepEqual(pdfArgs(['odd.pdf'], cwd), [], 'the program itself is never a file');
  /* unpackaged, argv[1] is the app's folder */
  assert.deepEqual(pdfArgs(['electron.exe', '.', 'a.pdf'], cwd), [path.join(cwd, 'a.pdf')]);
});

test("Explorer's combine is told from an open", () => {
  assert.ok(isCombine(['adddots-pdf', '--combine', 'a.pdf']));
  assert.ok(!isCombine(['adddots-pdf', 'a.pdf']));
  assert.ok(!isCombine(['--combine']));
});

test('names come back safe', () => {
  assert.equal(safeName('..\\x/y:z?.pdf'), '_x_y_z_.pdf');
  assert.equal(safeName('  '), 'document.pdf');
  assert.equal(safeName('Plan Aé.pdf'), 'Plan Aé.pdf');
});

test('saving replaces the file whole and leaves nothing behind', () => {
  const dir = tmp('save');
  const file = path.join(dir, 'a.pdf');
  fs.writeFileSync(file, 'old');
  writeAtomic(file, Buffer.from('new contents'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'new contents');
  assert.deepEqual(fs.readdirSync(dir), ['a.pdf']);
  assert.throws(() => writeAtomic(path.join(dir, 'missing', 'b.pdf'), Buffer.from('x')));
  fs.rmSync(dir, { recursive: true });
});

test('a range of a file and its end, even once saved over', () => {
  const dir = tmp('range');
  const file = path.join(dir, 'r.pdf');
  fs.writeFileSync(file, '0123456789');
  const fd = fs.openSync(file, 'r');
  assert.equal(readRange(fd, 2, 3).toString(), '234');
  assert.equal(readRange(fd, 8, 100).toString(), '89');
  assert.equal(readRange(fd, 20, 5).toString(), '');
  writeAtomic(file, Buffer.from('abcdefghij'));
  assert.equal(readRange(fd, 0, 4).toString(), '0123', 'still the file as opened');
  fs.closeSync(fd);
  fs.rmSync(dir, { recursive: true });
});

test('only handed-over paths are read, each queue taken once', () => {
  const dir = tmp('opened');
  const a = path.join(dir, 'a.pdf');
  fs.writeFileSync(a, '%PDF-1.7');
  const o = new Opened();
  o.handOver(['app', a], dir);
  o.handOver(['app', '--combine', a], dir);
  assert.deepEqual(o.take('pending'), [a]);
  assert.deepEqual(o.take('pending'), []);
  assert.deepEqual(o.take('combine'), [a]);
  assert.equal(o.check(a), a);
  assert.throws(() => o.check(path.join(dir, 'other.pdf')), /not a file/);
  assert.throws(() => o.openPlan(path.join(dir, 'other.pdf')), /not a file/);
  const plan = o.openPlan(a, true);
  assert.equal(plan.size, 8);
  assert.ok(plan.ranges && plan.id);
  assert.equal(o.range(plan.id, 0, 4).toString(), '%PDF');
  o.closeRange(plan.id);
  assert.throws(() => o.range(plan.id, 0, 4), /not open/);
  assert.deepEqual(o.openPlan(a, false), { size: 8, ranges: false, id: null });
  /* ADDDOTS_RANGE_MB=0: every file is big */
  process.env.ADDDOTS_RANGE_MB = '0';
  try {
    const big = o.openPlan(a, false);
    assert.ok(big.ranges && big.id, 'a size of 0 is taken, not the 150 MB default');
    o.closeRange(big.id);
  } finally {
    delete process.env.ADDDOTS_RANGE_MB;
  }
  fs.rmSync(dir, { recursive: true });
});
