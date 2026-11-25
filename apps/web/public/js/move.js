/* Add Dots PDF — moving objects exactly, as Illustrator does

   The Move tool (M, js/toolbar.js) and Select (V) are one tool underneath:
   a drag moves the whole selection (core.js beginDrag / dragMove), Shift
   keeps it to 45°, Alt leaves a copy, the grabbed point snaps to anchors,
   guides and the grid, and the arrow keys nudge by the Keyboard Increment.
   This module adds what Illustrator has for moving by numbers:

   Position — X and Y at the foot of the selection's properties (core's
              #markPop, docked in the Properties panel): where the
              selection's box is, from the ruler's zero point (the page's
              top-left corner unless it was moved), in the ruler's unit,
              measured at the reference point picked on the little 3 × 3
              grid beside them. Type a new place, or sums and other units
              ("+10", "25 mm", "1in/2"): the whole selection moves there,
              a group as one piece. W and H show its size. Also the
              Keyboard Increment the arrow keys move by.

   Move…    — Object > Transform > Move: Horizontal and Vertical, or
              Distance and Angle, kept in step; Preview shows it on the page
              as it is typed; OK moves, Copy moves a copy and leaves the
              original. It opens with the last move made, by drag or here.
              Enter, Ctrl+Shift+M, or a double-click on the Move or Select
              tool opens it.

   Directions are as the page is seen, whatever its turn: X to the right,
   Y down, an angle counter-clockwise from the right. Nothing locked or
   hidden is ever moved. Every change is one undo. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[move] core bridge missing'); return; }

  const PER = { mm: 25.4 / 72, cm: 2.54 / 72, in: 1 / 72, pt: 1, px: 1 };
  const REF_KEY = 'adpdf.refPoint';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* this session only */ } }
  function r6(n) { return Math.round(n * 1e6) / 1e6; }

  /* ---------------- units and sums ---------------- */

  function unit() { return X.rulers ? X.rulers.unit() : 'pt'; }
  function per() { return PER[unit()] || 1; }
  /** points shown in the ruler's unit, to a sensible few places */
  function show(pt) {
    const v = pt * per();
    const dp = unit() === 'pt' ? 2 : unit() === 'in' ? 4 : 3;
    const f = Math.pow(10, dp);
    const r = Math.round(v * f) / f;
    return String(Object.is(r, -0) ? 0 : r);
  }
  /** A length typed in a field, in points: a number, or a sum of them, each
      in the ruler's unit unless it says another (mm, cm, in, pt, px).
      "+10" or "-3mm" alone is relative to `rel` (points). null: not a
      length. Never eval: a small parser of numbers, units, + - * / and
      brackets. */
  function parseLen(text, rel) {
    let s = String(text == null ? '' : text).trim().replace(/,/g, '.').toLowerCase();
    if (!s) return null;
    let relative = false;
    if (rel != null && /^[+-]/.test(s) && /^[+-]\s*[\d.(]/.test(s)) relative = true;
    let i = 0;
    const base = per();
    function ws() { while (s[i] === ' ') i++; }
    function num() {
      ws();
      if (s[i] === '(') {
        i++; const v = expr(); ws();
        if (s[i] !== ')') throw new Error('bracket');
        i++; ws();
        /* "(10+5)mm": the sum is in that unit */
        const bu = /^(mm|cm|in|pt|px)/.exec(s.slice(i));
        if (bu) {
          i += bu[0].length;
          const n = v.pt != null ? v.pt * base : v.n;
          return { pt: n / PER[bu[1]] };
        }
        return v;
      }
      const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\./.exec(s.slice(i));
      if (!m) throw new Error('number');
      i += m[0].length;
      let v = parseFloat(m[0]);
      ws();
      const u = /^(mm|cm|in|pt|px)/.exec(s.slice(i));
      /* a length in points: its own unit, or the ruler's */
      if (u) { i += u[0].length; v = { pt: v / PER[u[1]] }; } else v = { n: v };
      return v;
    }
    function val(t) { return t.pt != null ? t.pt : t.n / base; }
    function unary() {
      ws();
      if (s[i] === '-') { i++; const t = unary(); return t.pt != null ? { pt: -t.pt } : { n: -t.n }; }
      if (s[i] === '+') { i++; return unary(); }
      return num();
    }
    function term() {
      let a = unary();
      for (;;) {
        ws();
        const op = s[i];
        if (op !== '*' && op !== '/') return a;
        i++;
        const b = unary();
        /* a length times a plain number stays a length */
        const k = b.pt != null ? val(b) : b.n;
        if (op === '/' && !k) throw new Error('zero');
        a = a.pt != null ? { pt: op === '*' ? a.pt * k : a.pt / k } : { n: op === '*' ? a.n * k : a.n / k };
      }
    }
    function expr() {
      let a = term();
      for (;;) {
        ws();
        const op = s[i];
        if (op !== '+' && op !== '-') return a;
        i++;
        const b = term();
        a = { pt: val(a) + (op === '+' ? val(b) : -val(b)) };
      }
    }
    try {
      const t = expr(); ws();
      if (i !== s.length) return null;
      const v = val(t);
      if (!isFinite(v)) return null;
      return relative ? rel + v : v;
    } catch (e) {
      return null;
    }
  }
  X.parseLen = parseLen;

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pop = $('markPop');

    /* ---------------- what is selected ---------------- */

    /** the selection that moves: everything picked that may (a group
        comes whole with S.multi already), and nothing locked or hidden */
    function selection() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it || !S.sel.it.vp) return null;
      const it = S.sel.it;
      const idx = X.selList().filter(function (i) {
        const s = it.shapes[i];
        return s && !X.NOT_SELECTABLE[s.t] && s.t !== 'pin' && !s.locked && !s.hide;
      });
      return idx.length ? { it: it, idx: idx } : null;
    }
    /** the selection's box as the page is seen, in points from the page's
        top-left corner: x to the right, y down */
    function seenBox(it, idx) {
      const vp = it.vp, k = vp.scale || 1;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      idx.forEach(function (i) {
        /* its own shape, turned as it is, without its stroke: text by its
           lines, a turned box by its corners (core visBox) */
        const b = X.visBox(it.shapes[i]);
        [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].forEach(function (p) {
          const v = vp.convertToViewportPoint(p[0], p[1]);
          x1 = Math.min(x1, v[0] / k); y1 = Math.min(y1, v[1] / k);
          x2 = Math.max(x2, v[0] / k); y2 = Math.max(y2, v[1] / k);
        });
      });
      return { x1: x1, y1: y1, x2: x2, y2: y2 };
    }
    /** a move as the page is seen (points, x right, y down) into page points */
    function toPage(vp, dx, dy) {
      const k = vp.scale || 1, o = vp.convertToPdfPoint(0, 0), p = vp.convertToPdfPoint(dx * k, dy * k);
      return [r6(p[0] - o[0]), r6(p[1] - o[1])];
    }
    /* and back: a move in page points as the page is seen (a direction,
       not a place: the difference of two points) */
    function fromPage(vp, mx, my) {
      const k = vp.scale || 1;
      const p = vp.convertToViewportPoint(mx, my), z = vp.convertToViewportPoint(0, 0);
      return [r6((p[0] - z[0]) / k), r6((p[1] - z[1]) / k)];
    }
    /** the selection moved by (dx, dy) seen points; copy: a copy of each
        stays where it was, in its place in the stack */
    function moveBy(sel, dx, dy, copy, noUndo) {
      const it = sel.it;
      const m = toPage(it.vp, dx, dy);
      if (!noUndo) X.snapshot();
      if (copy) X.copiesUnder(it, sel.idx.map(function (i) { return { i: i, s0: X.copyShape(it.shapes[i]) }; }));
      const now = copy ? X.selList() : sel.idx;
      now.forEach(function (i) {
        const s = it.shapes[i];
        if (s && !s.locked && !s.hide) X.moveShape(s, X.copyShape(s), m[0], m[1]);
      });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
    }
    X.moveSelectionBy = function (dx, dy, copy) {
      const sel = selection();
      if (sel) moveBy(sel, dx, dy, !!copy);
      return !!sel;
    };

    /* ---------------- Position: X, Y and the reference point ---------------- */

    const REFS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
    const LINK_KEY = 'adpdf.tfLink';
    let linked = get(LINK_KEY) === '1';
    let ref = REFS.indexOf(get(REF_KEY)) >= 0 ? get(REF_KEY) : 'mc';
    function refAt(b) {
      const h = ref[1], v = ref[0];
      return [h === 'l' ? b.x1 : h === 'r' ? b.x2 : (b.x1 + b.x2) / 2, v === 't' ? b.y1 : v === 'b' ? b.y2 : (b.y1 + b.y2) / 2];
    }
    function zero() { return X.rulers && X.rulers.zero ? X.rulers.zero() : { x: 0, y: 0 }; }

    const sec = document.createElement('div');
    sec.className = 'mpmove'; sec.id = 'mpMove';
    sec.innerHTML =
      '<div class="arsec mvsec">' +
        '<div class="arhd">Transform</div>' +
        '<div class="mvrow">' +
          '<div class="mvref" role="radiogroup" aria-label="Reference point" title="Reference point: the point of the selection X and Y give">' +
            REFS.map(function (r) {
              return '<button type="button" role="radio" data-ref="' + r + '" aria-label="' + ({ t: 'Top', m: 'Middle', b: 'Bottom' })[r[0]] + ' ' +
                ({ l: 'left', c: 'centre', r: 'right' })[r[1]] + '"></button>';
            }).join('') +
          '</div>' +
          '<div class="mvxy">' +
            '<label class="mfield"><span>X</span><span class="unit"><input id="mvX" inputmode="decimal" autocomplete="off" aria-label="X: across from the zero point"><em class="mvu"></em></span></label>' +
            '<label class="mfield"><span>Y</span><span class="unit"><input id="mvY" inputmode="decimal" autocomplete="off" aria-label="Y: down from the zero point"><em class="mvu"></em></span></label>' +
          '</div>' +
        '</div>' +
        '<div class="mvrow mvwh">' +
          '<button type="button" class="mvlink" id="mvLink" aria-pressed="false" title="Constrain width and height proportions">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7V5.5a3 3 0 0 1 6 0V7M9 17v1.5a3 3 0 0 0 6 0V17M12 9v6"/></svg></button>' +
          '<div class="mvxy">' +
            '<label class="mfield"><span>W</span><span class="unit"><input id="mvW" inputmode="decimal" autocomplete="off" aria-label="Width: of the selection, scaled from the reference point"><em class="mvu"></em></span></label>' +
            '<label class="mfield"><span>H</span><span class="unit"><input id="mvH" inputmode="decimal" autocomplete="off" aria-label="Height: of the selection, scaled from the reference point"><em class="mvu"></em></span></label>' +
          '</div>' +
        '</div>' +
        '<div class="mvsize" id="mvSize" hidden></div>' +
        '<div class="mvrow mvrot">' +
          '<div class="mvrotslot" id="mvRotSlot"></div>' +
          '<button type="button" class="mvflip" id="mvFlipH" title="Flip horizontal: mirrored across, about its middle" aria-label="Flip horizontal">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18"/><path d="M9 7L3 17h6z"/><path d="M15 7l6 10h-6z" fill="currentColor" fill-opacity=".35"/></svg></button>' +
          '<button type="button" class="mvflip" id="mvFlipV" title="Flip vertical: mirrored up and down, about its middle" aria-label="Flip vertical">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18"/><path d="M7 9L17 3v6z"/><path d="M7 15l10 6v-6z" fill="currentColor" fill-opacity=".35"/></svg></button>' +
        '</div>' +
        '<div class="mvrow mvfoot">' +
          '<button type="button" class="cbtn mvdlg" id="mvOpen" title="Move by a distance, or a copy (Enter, Ctrl+Shift+M)">Move…</button>' +
        '</div>' +
      '</div>';
    if (pop) {
      const before = $('mpArrange');
      if (before && before.parentNode === pop) pop.insertBefore(sec, before); else pop.appendChild(sec);
    }
    const q = function (id) { return sec.querySelector('#' + id); };

    function sync() {
      const sel = selection();
      sec.hidden = !sel;
      if (!sel) return;
      const b = seenBox(sel.it, sel.idx), z = zero(), at = refAt(b);
      const put = function (id, v) { const el = q(id); if (document.activeElement !== el) el.value = show(v); };
      put('mvX', at[0] - z.x); put('mvY', at[1] - z.y);
      put('mvW', b.x2 - b.x1); put('mvH', b.y2 - b.y1);
      q('mvSize').dataset.w = String(b.x2 - b.x1); q('mvSize').dataset.h = String(b.y2 - b.y1);
      q('mvLink').classList.toggle('on', linked);
      q('mvLink').setAttribute('aria-pressed', linked ? 'true' : 'false');
      /* a line has no height to give: sizing it is its length's business */
      const flat = b.x2 - b.x1 < 1e-6 || b.y2 - b.y1 < 1e-6;
      q('mvLink').disabled = flat;
      const canFlip = sel.idx.every(function (i) { return FLIP[sel.it.shapes[i].t]; });
      ['mvFlipH', 'mvFlipV'].forEach(function (id) {
        q(id).disabled = !canFlip;
        q(id).title = canFlip ? q(id).getAttribute('aria-label') + ': mirrored about its middle' : 'Only shapes and paths flip: text and pictures keep their way round';
      });
      sec.querySelectorAll('.mvu').forEach(function (u) { u.textContent = unit(); });
      sec.querySelectorAll('[data-ref]').forEach(function (bt) {
        const on = bt.dataset.ref === ref;
        bt.classList.toggle('on', on);
        bt.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    X.on('markpop', function () { sync(); });
    X.on('tool', function () { sync(); });
    X.on('units', function () { sync(); });

    sec.addEventListener('click', function (e) {
      const r = e.target.closest('[data-ref]');
      if (r) { ref = r.dataset.ref; set(REF_KEY, ref); sync(); return; }
      if (e.target.closest('#mvOpen')) openMove();
      else if (e.target.closest('#mvLink')) { linked = !linked; set(LINK_KEY, linked ? '1' : '0'); sync(); }
      else if (e.target.closest('#mvFlipH')) flip(true);
      else if (e.target.closest('#mvFlipV')) flip(false);
    });

    /* ---------------- W and H, and flipping ---------------- */

    /** a scale of the selection as the page is seen, about a point as the
        page is seen, done in page points (a page turned a quarter swaps
        the two ways) */
    function scaleSeen(sel, fixSeen, sx, sy) {
      const it = sel.it, vp = it.vp, k = vp.scale || 1;
      const f = vp.convertToPdfPoint(fixSeen[0] * k, fixSeen[1] * k);
      const quarter = Math.round(((vp.rotation || 0) % 180 + 180) % 180) === 90;
      const px = quarter ? sy : sx, py = quarter ? sx : sy;
      X.snapshot();
      const group = sel.idx.map(function (i) { return { i: i, s0: X.copyShape(it.shapes[i]) }; });
      X.scaleGroup(it, group, f, px, py);
      return { it: it, group: group, px: px, py: py };
    }
    function resize(el) {
      const sel = selection();
      if (!sel) return;
      const b = seenBox(sel.it, sel.idx), w = b.x2 - b.x1, h = b.y2 - b.y1;
      const isW = el.id === 'mvW', cur = isW ? w : h;
      const v = parseLen(el.value, cur);
      if (v == null || !(v > 0)) { X.toast(v != null ? 'A size above 0' : 'Give a number, a sum, or a length such as 25 mm', true); sync(); return; }
      if (cur < 1e-6) { X.toast(isW ? 'It has no width to scale' : 'It has no height to scale', true); sync(); return; }
      if (Math.abs(v - cur) < 1e-9) { sync(); return; }
      let sx = isW ? v / w : 1, sy = isW ? 1 : v / h;
      if (linked) { if (isW) sy = sx; else sx = sy; }
      /* lines have one way only: the other stays */
      if (w < 1e-6) sx = 1;
      if (h < 1e-6) sy = 1;
      scaleSeen(sel, refAt(b), sx, sy);
      done(sel.it);
    }
    /* what mirrors truly: shapes and paths; text and pictures would only
       come out back to front */
    const FLIP = { rect: 1, ellipse: 1, line: 1, arrow: 1, poly: 1, pen: 1, vpath: 1, cloud: 1, arc: 1, ink: 1, markup: 0 };
    function flip(across) {
      const sel = selection();
      if (!sel || !sel.idx.every(function (i) { return FLIP[sel.it.shapes[i].t]; })) return;
      const b = seenBox(sel.it, sel.idx), mid = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
      const r = scaleSeen(sel, mid, across ? -1 : 1, across ? 1 : -1);
      /* a box turned by an angle mirrors its angle; an arc bulges the other way */
      r.group.forEach(function (m) {
        const s = r.it.shapes[m.i];
        if (!s) return;
        if (s.r) { const a = ((-s.r % 360) + 360) % 360; if (a) s.r = Math.round(a * 1e6) / 1e6; else delete s.r; }
        if (s.t === 'arc') s.bulge = -(s.bulge == null ? 0.25 : s.bulge);
        /* a box keeps its corners in order */
        if (s.a && s.b && !s.pts && s.t !== 'line' && s.t !== 'arrow' && s.t !== 'arc') {
          const x1 = Math.min(s.a[0], s.b[0]), x2 = Math.max(s.a[0], s.b[0]), y1 = Math.min(s.a[1], s.b[1]), y2 = Math.max(s.a[1], s.b[1]);
          s.a = [x1, y1]; s.b = [x2, y2];
        }
      });
      done(r.it);
    }
    function done(it) { X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop(); }
    function commit(el) {
      const id = el.id;
      if (id === 'mvW' || id === 'mvH') { resize(el); return; }
      if (id !== 'mvX' && id !== 'mvY') return;
      const sel = selection();
      if (!sel) return;
      const b = seenBox(sel.it, sel.idx), z = zero(), at = refAt(b);
      const cur = id === 'mvX' ? at[0] - z.x : at[1] - z.y;
      const v = parseLen(el.value, cur);
      if (v == null) { X.toast('Give a number, a sum, or a length such as 25 mm', true); sync(); return; }
      const d = v - cur;
      if (Math.abs(d) < 1e-9) { sync(); return; }
      moveBy(sel, id === 'mvX' ? d : 0, id === 'mvY' ? d : 0, false);
    }
    sec.addEventListener('change', function (e) { if (e.target.matches('input') && !e.target.dataset.done) commit(e.target); });
    sec.addEventListener('keydown', function (e) {
      if (!e.target.matches('input')) return;
      e.stopPropagation();                       /* the arrows and letters are the field's here */
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(e.target);
        /* the blur would send a change for the same text: "+10" once only */
        e.target.dataset.done = '1';
        e.target.blur();
        delete e.target.dataset.done;
      }
      else if (e.key === 'Escape') { e.preventDefault(); sync(); e.target.blur(); }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.target.readOnly) {
        /* up and down step the number, as Illustrator's fields do (Shift: ten) */
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / per() * (e.key === 'ArrowUp' ? 1 : -1);
        const cur = parseLen(e.target.value, 0);
        if (cur == null) return;
        e.target.value = show(cur + step);
        commit(e.target);
      }
    });
    /* a press on the page hands the keys back to it (a press on a mark
       does not take the focus itself), so the arrows move the selection */
    const stage = $('stage');
    if (stage) {
      stage.addEventListener('pointerdown', function () {
        const a = document.activeElement;
        if (a && sec.contains(a)) a.blur();
      }, true);
    }
    sync();

    /* ---------------- Move… ---------------- */

    let last = null;          /* the last move here or by drag: seen points */
    function lastMove() {
      const lm = X.lastMove;
      if (lm && lm !== lastMove.seen) {
        lastMove.seen = lm;
        if (lm.it && lm.it.vp) { const v = fromPage(lm.it.vp, lm.p[0], lm.p[1]); last = { h: v[0], v: v[1] }; }
      }
      return last || { h: 0, v: 0 };
    }
    let open = false;
    async function openMove() {
      const sel = selection();
      if (!sel || open) { if (!sel) X.toast('Select something to move first', true); return; }
      open = true;
      const it = sel.it;
      const m0 = lastMove();
      const u = unit();
      const fld = function (id, label, v, suffix) {
        return '<label class="mvf"><span>' + label + '</span><span class="unit"><input id="' + id + '" inputmode="decimal" autocomplete="off" value="' + v + '"><em>' + suffix + '</em></span></label>';
      };
      const dist0 = Math.hypot(m0.h, m0.v), ang0 = dist0 ? Math.atan2(-m0.v, m0.h) * 180 / Math.PI : 0;
      const ra = function (a) { return String(Math.round(a * 1000) / 1000); };
      let preview = get('adpdf.movePreview') === '1';
      let shown = false;               /* the preview is on the page now */
      let base = null;                 /* the marks as they were, to put back */
      const putBack = function () {
        if (!shown || !base) return;
        base.forEach(function (b) { it.shapes[b.i] = b.s; });
        shown = false;
        X.drawShapes(it);
      };
      const res = await X.dialog({
        title: 'Move',
        ok: 'OK',
        width: 380,
        body:
          '<div class="mvdlgb">' +
            '<div class="mvgrp"><div class="mvh">Position</div>' +
              fld('mvdH', 'Horizontal', show(m0.h), u) +
              fld('mvdV', 'Vertical', show(m0.v), u) +
            '</div>' +
            '<div class="mvgrp">' +
              fld('mvdD', 'Distance', show(dist0), u) +
              fld('mvdA', 'Angle', ra(ang0), '°') +
            '</div>' +
            '<label class="mvck"><input type="checkbox" id="mvdP"' + (preview ? ' checked' : '') + '> Preview</label>' +
            '<p class="mvnote">Across and down as the page is seen; the angle counter-clockwise from the right. Sums and units work: <b>10+2.5</b>, <b>1 in</b>.</p>' +
          '</div>',
        open: function (box) {
          const f = function (id) { return box.querySelector('#' + id); };
          /* Copy: as OK, but a copy moves and the original stays */
          const copy = document.createElement('button');
          copy.type = 'button'; copy.className = 'wdbtn mvcopy'; copy.textContent = 'Copy';
          copy.title = 'Move a copy, the original staying where it is';
          box.classList.add('mvbox');
          const foot = box.querySelector('.wdfoot');
          foot.insertBefore(copy, box.querySelector('.wdno'));
          copy.addEventListener('click', function () { box.dataset.copy = '1'; box.requestSubmit ? box.requestSubmit() : box.querySelector('.wdok').click(); });
          function read() {
            return {
              h: parseLen(f('mvdH').value, null), v: parseLen(f('mvdV').value, null),
              d: parseLen(f('mvdD').value, null), a: parseFloat(String(f('mvdA').value).replace(',', '.'))
            };
          }
          /* the other pair follows the one typed in */
          function fromHV() {
            const r = read();
            if (r.h == null || r.v == null) return;
            const d = Math.hypot(r.h, r.v);
            f('mvdD').value = show(d);
            f('mvdA').value = ra(d ? Math.atan2(-r.v, r.h) * 180 / Math.PI : 0);
          }
          function fromDA() {
            const r = read();
            if (r.d == null || !isFinite(r.a)) return;
            const a = r.a * Math.PI / 180;
            f('mvdH').value = show(r6(r.d * Math.cos(a)));
            f('mvdV').value = show(r6(-r.d * Math.sin(a)));
          }
          function paint() {
            putBack();
            if (!preview) return;
            const r = read();
            if (r.h == null || r.v == null) return;
            base = sel.idx.map(function (i) { return { i: i, s: it.shapes[i] }; });
            const m = toPage(it.vp, r.h, r.v);
            sel.idx.forEach(function (i) {
              const s = X.copyShape(it.shapes[i]);
              X.moveShape(s, X.copyShape(it.shapes[i]), m[0], m[1]);
              it.shapes[i] = s;
            });
            shown = true;
            X.drawShapes(it);
          }
          box.addEventListener('input', function (e) {
            const id = e.target.id;
            if (id === 'mvdH' || id === 'mvdV') fromHV();
            else if (id === 'mvdD' || id === 'mvdA') fromDA();
            else if (id === 'mvdP') { preview = e.target.checked; set('adpdf.movePreview', preview ? '1' : '0'); }
            paint();
          });
          box.addEventListener('change', function (e) {
            if (e.target.id === 'mvdP') { preview = e.target.checked; set('adpdf.movePreview', preview ? '1' : '0'); paint(); }
          });
          paint();
        },
        value: function (box) {
          const h = parseLen(box.querySelector('#mvdH').value, null), v = parseLen(box.querySelector('#mvdV').value, null);
          if (h == null) { delete box.dataset.copy; return { error: 'Horizontal: a number, a sum, or a length such as 25 mm', field: '#mvdH' }; }
          if (v == null) { delete box.dataset.copy; return { error: 'Vertical: a number, a sum, or a length such as 25 mm', field: '#mvdV' }; }
          return { h: h, v: v, copy: box.dataset.copy === '1' };
        }
      });
      putBack();
      open = false;
      if (!res) { X.drawShapes(it); return; }
      last = { h: res.h, v: res.v };
      lastMove.seen = X.lastMove;
      if (Math.abs(res.h) < 1e-9 && Math.abs(res.v) < 1e-9 && !res.copy) return;
      /* the selection may have changed index while the dialog was up: read it again */
      const now = selection();
      if (!now) return;
      moveBy(now, res.h, res.v, res.copy);
    }
    X.openMove = openMove;

    /* Enter (as Illustrator's Selection tool has it) and Ctrl+Shift+M */
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || S.editing) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, button, [contenteditable], .wdwrap, [role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const enter = e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey;
      const ctrlShiftM = mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm';
      if (!enter && !ctrlShiftM) return;
      if (S.tool !== 'select' || !selection()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openMove();
    }, true);
    /* a double-click on the Move or Select tool, as on Illustrator's */
    document.addEventListener('dblclick', function (e) {
      const b = e.target.closest && e.target.closest('[data-tool-btn="select"], #tSelect');
      if (!b || !selection()) return;
      e.preventDefault();
      openMove();
    });
  });
})();
