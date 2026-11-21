import { describe, expect, it } from 'vitest';
import { charSpacing, leading, lineOrigin, lineWidth, textRect, tracking, type TextMark } from '../src';

/* Leading, tracking and the Paragraph panel's alignments on a text mark:
   all optional, so a mark without them lays out exactly as before. */

/* every character 10 points wide at size 20, so the numbers are plain */
const measure = (_s: TextMark, line: string) => Array.from(line).length * 10;
const mark = (o: Partial<TextMark> = {}): TextMark => ({
  t: 'text',
  a: [100, 700],
  text: 'abcd\nab',
  size: 20,
  c: '#000000',
  f: 'helv',
  ...o,
});

describe('leading', () => {
  it("is 120% of the size when not set, and the mark's own when set", () => {
    expect(leading(mark())).toBeCloseTo(24);
    expect(leading(mark({ lh: 30 }))).toBe(30);
  });
  it('sets the distance between lines and the height of the box', () => {
    expect(lineOrigin(mark({ lh: 30 }), 1, 20, measure)).toEqual([100, 670]);
    expect(textRect(mark(), measure).h).toBeCloseTo(48);
    expect(textRect(mark({ lh: 30 }), measure).h).toBeCloseTo(24 + 30);
  });
});

describe('tracking', () => {
  it('adds thousandths of an em after each character but the last', () => {
    expect(tracking(mark({ tr: 100 }))).toBeCloseTo(2);
    expect(lineWidth(mark({ tr: 100 }), 0, measure)).toBeCloseTo(40 + 3 * 2);
    expect(charSpacing(mark({ tr: 100 }), 0, measure)).toBeCloseTo(2);
  });
  it('changes nothing when not set', () => {
    expect(lineWidth(mark(), 0, measure)).toBe(40);
    expect(charSpacing(mark(), 0, measure)).toBe(0);
  });
});

describe('alignment', () => {
  it('reads the justify kinds on one-line paragraphs as left, centre and right', () => {
    expect(lineOrigin(mark({ align: 'justify' }), 1, 20, measure)[0]).toBe(100);
    expect(lineOrigin(mark({ align: 'justify-center' }), 1, 20, measure)[0]).toBe(110);
    expect(lineOrigin(mark({ align: 'justify-right' }), 1, 20, measure)[0]).toBe(120);
  });
  it('spreads every line across the widest with justify all', () => {
    const s = mark({ align: 'justify-all' });
    expect(lineOrigin(s, 1, 20, measure)[0]).toBe(100);
    /* "ab" is 20 wide in a 40-wide box: its one gap takes the other 20 */
    expect(charSpacing(s, 1, measure)).toBeCloseTo(20);
    expect(charSpacing(s, 0, measure)).toBeCloseTo(0);
  });
});
