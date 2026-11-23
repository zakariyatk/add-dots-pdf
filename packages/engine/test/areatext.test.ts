import { describe, expect, it } from 'vitest';
import { layoutText, lineSpans, textRect, type TextMark } from '../src';

/* Area text, wrapped in its frame (layoutText), measured here in a font
   where every character is half the size wide: 5pt at size 10. */
const measure = (_s: TextMark, line: string) => Array.from(line).length * 5;
const mark = (text: string, extra: Partial<TextMark> = {}): TextMark =>
  ({ t: 'text', a: [100, 500], text, size: 10, f: 'helv', c: '#000000', ...extra }) as TextMark;

describe('area text', () => {
  it('leaves point text as it is', () => {
    const s = mark('aaa bbb ccc ddd');
    expect(layoutText(s, measure)).toBe(s);
  });

  it('wraps at spaces, the space becoming the break, the text as long as it was', () => {
    const s = mark('aaa bbb ccc', { aw: 40, ah: 100 });
    const l = layoutText(s, measure);
    expect(l.text).toBe('aaa bbb\nccc');
    expect(l.text.length).toBe(s.text.length);
    expect(l.ovf).toBe(false);
  });

  it('keeps the line breaks typed', () => {
    expect(layoutText(mark('aa\nbb cc', { aw: 100, ah: 100 }), measure).text).toBe('aa\nbb cc');
  });

  it('breaks a word wider than the frame between its characters, its styles kept in place', () => {
    const s = mark('abcdefghij', { aw: 20, ah: 100, runs: [{ n: 4 }, { n: 6, b: true }] });
    const l = layoutText(s, measure);
    expect(l.text).toBe('abcd\nefgh\nij');
    expect(l.runs).toEqual([{ n: 5 }, { n: 7, b: true }]);
    /* the bold run still starts at the e */
    expect(lineSpans(l, 1).map((p) => [p.text, !!p.s.b])).toEqual([['efgh', true]]);
  });

  it('measures bold where it is bold', () => {
    const wide = (s: TextMark, line: string) => Array.from(line).length * (s.b ? 10 : 5);
    const s = mark('aa bb', { aw: 30, ah: 100, runs: [{ n: 3 }, { n: 2, b: true }] });
    /* aa + space is 15, bold bb is 20: 35 is past 30 */
    expect(layoutText(s, wide).text).toBe('aa\nbb');
  });

  it('leaves out the lines past the frame, and says so', () => {
    /* size 10: the first line takes 12pt, each next one 12 more; 25pt holds two */
    const l = layoutText(mark('one\ntwo\nthree', { aw: 100, ah: 25 }), measure);
    expect(l.text).toBe('one\ntwo');
    expect(l.ovf).toBe(true);
  });

  it('is its frame, whatever the text in it', () => {
    expect(textRect(mark('x', { aw: 150, ah: 80 }), measure)).toEqual({ x: 100, y: 430, w: 150, h: 80 });
  });

  it('reflows when the frame changes', () => {
    const t = 'the quick brown fox jumps';
    expect(layoutText(mark(t, { aw: 60, ah: 200 }), measure).text.split('\n').length).toBe(3);
    expect(layoutText(mark(t, { aw: 200, ah: 200 }), measure).text.split('\n').length).toBe(1);
  });
});
