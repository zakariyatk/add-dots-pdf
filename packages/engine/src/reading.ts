/* Reading order and copied text for a page's text layer.

   pdf.js hands a page's words over in the order the file draws them. For most
   files that is the order they are read in, but some draw a two-column page
   row by row, left line then right line, so a drag down one column picks up
   the other too. readingOrder finds text columns and puts each one whole
   before the next; a page without columns keeps the file's order.

   joinRuns is the text a copy should give: the words of the text layer are
   separate boxes, so their text alone runs together ("line 2line 3"). The
   space or line break between two runs is read from where they sit. */

/** One run of text on the page, at 100% (CSS px, top-left origin). */
export interface TextBox {
  x: number;
  /** top of the run's box */
  top: number;
  w: number;
  /** font size: the height of the run's box */
  h: number;
  /** baseline */
  base: number;
  /** written left to right along the page (not turned) */
  horiz: boolean;
}

/* a gap this many font sizes wide ends a run of words; a column gutter is wider */
const WORD_GAP = 1.0;
/* a text column is at least this many font sizes wide, so the columns of a
   table (short cells, narrow) are not read one after the other */
const MIN_COLUMN = 10;
const MAX_BOXES = 20000;
const MAX_DEPTH = 16;

interface Frag {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  h: number;
  first: number;
  items: number[];
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/* runs on one baseline and close together are one fragment of a line */
function fragments(boxes: TextBox[], idx: number[]): Frag[] {
  const byBase = idx.slice().sort((a, b) => boxes[a]!.base - boxes[b]!.base || boxes[a]!.x - boxes[b]!.x);
  const lines: number[][] = [];
  let cur: number[] = [];
  let lastBase = -Infinity;
  let lastH = 0;
  for (const i of byBase) {
    const b = boxes[i]!;
    if (cur.length && b.base - lastBase > 0.4 * Math.min(lastH, b.h)) {
      lines.push(cur);
      cur = [];
    }
    cur.push(i);
    lastBase = b.base;
    lastH = b.h;
  }
  if (cur.length) lines.push(cur);

  const out: Frag[] = [];
  for (const line of lines) {
    line.sort((a, b) => boxes[a]!.x - boxes[b]!.x);
    let f: Frag | null = null;
    for (const i of line) {
      const b = boxes[i]!;
      if (f && b.x - f.x2 <= WORD_GAP * Math.max(f.h, b.h)) {
        f.x2 = Math.max(f.x2, b.x + b.w);
        f.y1 = Math.min(f.y1, b.top);
        f.y2 = Math.max(f.y2, b.top + b.h);
        f.h = Math.max(f.h, b.h);
        f.first = Math.min(f.first, i);
        f.items.push(i);
      } else {
        f = { x1: b.x, x2: b.x + b.w, y1: b.top, y2: b.top + b.h, h: b.h, first: i, items: [i] };
        out.push(f);
      }
    }
  }
  return out;
}

const byFirst = (a: Frag, b: Frag) => a.first - b.first;

/* the first gutter, left to right, with a text column on either side */
function columnCut(frags: Frag[], em: number): [Frag[], Frag[]] | null {
  const s = frags.slice().sort((a, b) => a.x1 - b.x1);
  const n = s.length;
  /* the right edge of everything from k on */
  const tail = new Array<number>(n);
  tail[n - 1] = s[n - 1]!.x2;
  for (let k = n - 2; k >= 0; k--) tail[k] = Math.max(tail[k + 1]!, s[k]!.x2);
  const left = s[0]!.x1;
  let right = s[0]!.x2;
  for (let k = 1; k < n; k++) {
    const f = s[k]!;
    if (
      f.x1 - right >= WORD_GAP * em &&
      k >= 2 &&
      n - k >= 2 &&
      right - left >= MIN_COLUMN * em &&
      tail[k]! - f.x1 >= MIN_COLUMN * em
    )
      return [s.slice(0, k), s.slice(k)];
    right = Math.max(right, f.x2);
  }
  return null;
}

/* bands split by a wider gap than the lines' own (a title over two columns) */
function bands(frags: Frag[], em: number): Frag[][] {
  const s = frags.slice().sort((a, b) => a.y1 - b.y1);
  const gaps: { at: number; g: number }[] = [];
  let bottom = s[0]!.y2;
  for (let k = 1; k < s.length; k++) {
    const g = s[k]!.y1 - bottom;
    if (g > 0) gaps.push({ at: k, g });
    bottom = Math.max(bottom, s[k]!.y2);
  }
  if (!gaps.length) return [frags];
  const typical = median(gaps.map((x) => x.g));
  const cuts = gaps.filter((x) => x.g >= em || x.g > 1.5 * typical).map((x) => x.at);
  if (!cuts.length) return [frags];
  const out: Frag[][] = [];
  let from = 0;
  for (const at of cuts) {
    out.push(s.slice(from, at));
    from = at;
  }
  out.push(s.slice(from));
  return out;
}

/**
 * The order to lay the runs out in: an array of indexes into `boxes`. A page
 * with no text columns keeps the file's order (0, 1, 2, ...).
 */
export function readingOrder(boxes: TextBox[]): number[] {
  const n = boxes.length;
  const identity = boxes.map((_, i) => i);
  if (n < 4 || n > MAX_BOXES) return identity;
  const flat: number[] = [];
  const turned: number[] = [];
  boxes.forEach((b, i) => (b.horiz && b.w > 0 && b.h > 0 ? flat : turned).push(i));
  const frags = fragments(boxes, flat);
  if (frags.length < 4) return identity;
  const em = median(frags.map((f) => f.h)) || 1;
  let found = false;

  const place = (fs: Frag[], depth: number): Frag[] => {
    if (fs.length < 4 || depth > MAX_DEPTH) return fs.slice().sort(byFirst);
    const cut = columnCut(fs, em);
    if (cut) {
      found = true;
      return place(cut[0], depth + 1).concat(place(cut[1], depth + 1));
    }
    const bs = bands(fs, em);
    if (bs.length > 1) return ([] as Frag[]).concat(...bs.map((b) => place(b, depth + 1)));
    return fs.slice().sort(byFirst);
  };
  const ordered = place(frags, 0);
  if (!found) return identity;
  const out: number[] = [];
  for (const f of ordered) for (const i of f.items) out.push(i);
  for (const i of turned) out.push(i);
  return out;
}

/** What goes between two runs read one after the other: nothing, a space or a line break. */
export function runSeparator(a: TextBox, b: TextBox, aText: string, bText: string): string {
  const h = Math.max(a.h, b.h) || 1;
  const sameLine = a.horiz && b.horiz && Math.abs(a.base - b.base) < 0.5 * h;
  if (!sameLine) return '\n';
  const gap = b.x - (a.x + a.w);
  if (gap < -0.5 * h) return '\n'; /* back to the left: a new row */
  if (/\s$/.test(aText) || /^\s/.test(bText)) return '';
  return gap > 0.15 * h ? ' ' : '';
}

/** The text of runs read in order, with the spaces and line breaks between them. */
export function joinRuns(runs: { text: string; box: TextBox }[]): string {
  let out = '';
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k]!;
    if (k) {
      const p = runs[k - 1]!;
      out += runSeparator(p.box, r.box, p.text, r.text);
    }
    out += r.text;
  }
  return out;
}
