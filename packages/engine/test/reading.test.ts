import { describe, expect, it } from 'vitest';
import { joinRuns, readingOrder, runSeparator, type TextBox } from '../src';

/* a run of `chars` characters at 10pt, on the line whose baseline is y */
const run = (x: number, y: number, chars = 40, h = 10): TextBox => ({
  x,
  top: y - h * 0.8,
  w: chars * h * 0.5,
  h,
  base: y,
  horiz: true,
});

/* two columns of `rows` lines, 20 characters wide each, 250pt apart */
function columns(rows: number, rowMajor: boolean) {
  const boxes: TextBox[] = [];
  const names: string[] = [];
  const add = (c: number, i: number) => {
    boxes.push(run(50 + c * 250, 100 + i * 14));
    names.push((c ? 'R' : 'L') + i);
  };
  if (rowMajor) for (let i = 0; i < rows; i++) for (let c = 0; c < 2; c++) add(c, i);
  else for (let c = 0; c < 2; c++) for (let i = 0; i < rows; i++) add(c, i);
  return { boxes, names };
}

describe('readingOrder', () => {
  it('keeps the order of a page without columns', () => {
    const boxes = Array.from({ length: 30 }, (_, i) => run(50, 100 + i * 14, 80));
    /* drawn out of order: the file's order is kept, not re-sorted by position */
    [boxes[3], boxes[7]] = [boxes[7]!, boxes[3]!];
    expect(readingOrder(boxes)).toEqual(boxes.map((_, i) => i));
  });

  it('reads a page drawn row by row one column at a time', () => {
    const { boxes, names } = columns(10, true);
    const order = readingOrder(boxes).map((i) => names[i]);
    expect(order).toEqual([
      ...Array.from({ length: 10 }, (_, i) => 'L' + i),
      ...Array.from({ length: 10 }, (_, i) => 'R' + i),
    ]);
  });

  it('leaves a page drawn column by column as it is', () => {
    const { boxes } = columns(10, false);
    expect(readingOrder(boxes)).toEqual(boxes.map((_, i) => i));
  });

  it('reads a title over two columns first', () => {
    const { boxes, names } = columns(8, true);
    boxes.push({ ...run(50, 60, 90, 18) });
    names.push('title');
    const order = readingOrder(boxes).map((i) => names[i]);
    expect(order[0]).toBe('title');
    expect(order.slice(1, 9)).toEqual(Array.from({ length: 8 }, (_, i) => 'L' + i));
  });

  it('does not read a table of short cells column by column', () => {
    const boxes: TextBox[] = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 4; c++) boxes.push(run(50 + c * 60, 100 + r * 14, 6));
    expect(readingOrder(boxes)).toEqual(boxes.map((_, i) => i));
  });

  it('keeps the words of one line together, left to right', () => {
    const { boxes, names } = columns(6, true);
    /* the left column's first line drawn as two runs, the second one first */
    boxes.push(run(50 + 21 * 5, 100, 10));
    names.push('L0b');
    const order = readingOrder(boxes).map((i) => names[i]);
    expect(order.slice(0, 3)).toEqual(['L0', 'L0b', 'L1']);
  });
});

describe('joinRuns', () => {
  it('puts a space between words apart on a line and a break between lines', () => {
    const a = run(50, 100, 4);
    const b = run(50 + 4 * 5 + 3, 100, 4);
    const c = run(50, 114, 4);
    expect(
      joinRuns([
        { text: 'left', box: a },
        { text: 'tail', box: b },
        { text: 'next', box: c },
      ]),
    ).toBe('left tail\nnext');
  });

  it('adds nothing between touching runs or next to a space', () => {
    const a = run(50, 100, 4);
    expect(runSeparator(a, run(70, 100, 4), 'engi', 'neer')).toBe('');
    expect(runSeparator(a, run(80, 100, 4), 'left ', 'tail')).toBe('');
  });

  it('breaks the line when the next run starts back at the left', () => {
    expect(runSeparator(run(300, 100, 20), run(50, 100, 20), 'R0', 'L0')).toBe('\n');
  });

  it('keeps a raised footnote mark on its line', () => {
    const mark: TextBox = { ...run(70, 97, 1, 6) };
    expect(runSeparator(run(50, 100, 4), mark, 'word', '1')).toBe('');
  });
});

describe('readingOrder on a crowded sheet', () => {
  it('orders 20,000 scattered labels quickly', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const boxes = Array.from({ length: 20000 }, () => run(rnd() * 3000, rnd() * 2000, 4, 6));
    const t0 = performance.now();
    const order = readingOrder(boxes);
    const ms = performance.now() - t0;
    expect(new Set(order).size).toBe(boxes.length);
    expect(ms).toBeLessThan(1000);
  });
});
