/* ADD DOTS PDF — Annotate & comment
   ----------------------------------
   Text markup (highlight / underline / strike-out), freehand ink, sticky
   notes, callouts and rubber stamps, plus a Comments panel that lists every
   remark in the document.

   Everything here is an ordinary entry in `it.shapes`, in PDF points, so undo,
   Save, the JPG export and the thumbnails pick it up with no extra wiring.
   Core hands us what we need through window.ADDPDF. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[annotate] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, SVGNS = X.SVGNS, PDFLib = X.PDFLib;

    /* ---------------- the marks this module adds ---------------- */

    /* A text-markup mark stores the quads pdf.js gave us for the selected
       glyphs, in PDF points: [[x1,y1,x2,y2], ...]. Drawing them is then the
       same job on screen, in the PDF and in a JPG. */
    const MARKUP = {
      highlight: { label: 'Highlight', op: 0.38, colors: ['#F2C14E', '#7BE38F', '#7FD4F5', '#F7A8D8', '#C9A6F5'] },
      underline: { label: 'Underline', op: 1, colors: ['#E2483D', '#3B82F6', '#22A06B', '#F2C14E', '#1C1F24'] },
      strike:    { label: 'Strike out', op: 1, colors: ['#E2483D', '#3B82F6', '#22A06B', '#F2C14E', '#1C1F24'] }
    };

    /* the stamp list lives in the engine, which paints them into the PDF */
    const STAMPS = window.ADDPDFEngine.STAMPS;
    const STAMP_BY_K = {};
    STAMPS.forEach(function (s) { STAMP_BY_K[s.k] = s; });

    let markupColor = { highlight: '#F2C14E', underline: '#E2483D', strike: '#E2483D' };
    let stampKind = 'approved';
    let inkWidth = 2.5;
    let uid = 0;
    function nextId() { return 'c' + (++uid) + '-' + Date.now().toString(36); }

    /* ---------------- toolbar ---------------- */

    const TOOLS = [
      { t: 'highlight', id: 'tHighlight', label: 'Highlight', key: 'H', shift: true,
        path: '<path d="M4 20h5l10-10-5-5L4 15z"/><line x1="14" y1="6" x2="18" y2="10"/><line x1="3" y1="21" x2="11" y2="21"/>' },
      { t: 'underline', id: 'tUnderline', label: 'Underline', key: 'U',
        path: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><line x1="5" y1="20" x2="19" y2="20"/>' },
      { t: 'strike', id: 'tStrike', label: 'Strike out', key: 'D',
        path: '<path d="M7 7a4 3 0 0 1 8 0"/><path d="M16 15a4 3 0 0 1-8.5 0"/><line x1="3" y1="12" x2="21" y2="12"/>' },
      { t: 'ink', id: 'tInk', label: 'Pen', key: 'P', shift: true,
        path: '<path d="M3 20l3.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z"/><line x1="14" y1="6" x2="17" y2="9"/>' },
      { t: 'note', id: 'tNote', label: 'Sticky note', key: 'N',
        path: '<path d="M4 4h16v10l-5 6H4z"/><path d="M20 14h-6v6"/>' },
      { t: 'stamp', id: 'tStamp', label: 'Stamp', key: 'B',
        path: '<path d="M8 3h8l-1.5 6H9.5z"/><path d="M5 20h14v-3a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><line x1="4" y1="21" x2="20" y2="21"/>' }
    ];

    const grpTools = $('grpTools');
    TOOLS.forEach(function (T) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = T.id;
      b.title = T.label + ' (' + (T.shift ? 'Shift+' : '') + T.key + ')';
      b.setAttribute('aria-label', T.label);
      b.dataset.label = T.label;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + T.path + '</svg>';
      b.addEventListener('click', function () { X.toggleTool(T.t); });
      grpTools.appendChild(b);
      X.toolBtn[T.t] = T.id;
      X.hints[T.t] = {
        highlight: 'Select text on a page to highlight it. Click a highlight to comment on it.',
        underline: 'Select text on a page to underline it.',
        strike: 'Select text on a page to strike it out.',
        ink: 'Draw freehand on the page. Each stroke is one mark, so <b>Ctrl+Z</b> undoes it whole. Hold <b>Shift</b> for a straight stroke.',
        note: 'Click anywhere to drop a sticky note, then type your comment.',
        stamp: 'Click a page to place the stamp, or drag to size it.'
      }[T.t];
    });

    /* extra controls that ride in the mode bar next to the swatches */
    const modeBar = $('modeBar');
    const inkCtl = document.createElement('div');
    inkCtl.className = 'txctl anno-ctl'; inkCtl.id = 'inkCtl'; inkCtl.hidden = true;
    inkCtl.innerHTML = '<span class="anno-lbl">Nib</span>' +
      '<select id="inkW" aria-label="Pen width">' +
      '<option value="1">Fine · 1pt</option><option value="2.5" selected>Medium · 2.5pt</option>' +
      '<option value="5">Bold · 5pt</option><option value="12">Marker · 12pt</option></select>';
    const stampCtl = document.createElement('div');
    stampCtl.className = 'txctl anno-ctl'; stampCtl.id = 'stampCtl'; stampCtl.hidden = true;
    stampCtl.innerHTML = '<span class="anno-lbl">Stamp</span><select id="stampK" aria-label="Stamp">' +
      STAMPS.map(function (s) { return '<option value="' + s.k + '">' + s.text + '</option>'; }).join('') +
      '</select>';
    modeBar.insertBefore(inkCtl, $('pinShowList'));
    modeBar.insertBefore(stampCtl, $('pinShowList'));
    $('inkW').addEventListener('change', function () { inkWidth = parseFloat(this.value); });
    $('stampK').addEventListener('change', function () { stampKind = this.value; });

    /* a colour row of our own: the core swatches drive S.color, but a
       highlighter wants pastels and a strike-out wants ink colours */
    const mkCtl = document.createElement('div');
    mkCtl.className = 'anno-ctl anno-sw'; mkCtl.id = 'mkCtl'; mkCtl.hidden = true;
    modeBar.insertBefore(mkCtl, $('pinShowList'));

    function paintMarkupSwatches(kind) {
      const cfg = MARKUP[kind]; if (!cfg) return;
      mkCtl.innerHTML = '';
      cfg.colors.forEach(function (c) {
        const b = document.createElement('button');
        b.className = 'sw' + (c === markupColor[kind] ? ' on' : '');
        b.style.background = c; b.title = c;
        b.addEventListener('click', function () {
          markupColor[kind] = c;
          Array.prototype.forEach.call(mkCtl.children, function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          document.documentElement.style.setProperty('--mk-sel', c);
        });
        mkCtl.appendChild(b);
      });
      document.documentElement.style.setProperty('--mk-sel', markupColor[kind]);
    }

    X.on('tool', function (t) {
      const isMarkup = !!MARKUP[t];
      mkCtl.hidden = !isMarkup;
      inkCtl.hidden = t !== 'ink';
      stampCtl.hidden = t !== 'stamp';
      if (isMarkup) paintMarkupSwatches(t);
      /* our tools bring their own colour row, so hide the core one */
      if (isMarkup || t === 'ink' || t === 'stamp' || t === 'note') {
        $('swatches').style.display = (t === 'ink') ? 'flex' : 'none';
        $('widths').style.display = 'none';
      }
    });

    /* ---------------- text markup: selection -> quads ---------------- */

    /* Turn whatever the reader has selected inside one page's text layer into
       quads in PDF points. Each client rect becomes one quad, which is what a
       real PDF markup annotation stores too. */
    function quadsFromSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      const layer = (range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement);
      const tl = layer && layer.closest ? layer.closest('.textLayer') : null;
      if (!tl) return null;

      const it = S.items.filter(function (x) { return x.tl === tl; })[0];
      if (!it || !it.vp) return null;

      const base = it.inner.getBoundingClientRect();
      const rects = Array.prototype.slice.call(range.getClientRects())
        .filter(function (r) { return r.width > 0.5 && r.height > 0.5; });
      if (!rects.length) return null;

      /* rows that overlap heavily are the same line reported twice */
      const rows = [];
      rects.forEach(function (r) {
        const hit = rows.filter(function (q) {
          const ov = Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top);
          return ov > Math.min(q.height, r.height) * 0.6;
        })[0];
        if (hit) {
          hit.left = Math.min(hit.left, r.left); hit.right = Math.max(hit.right, r.right);
          hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom);
          hit.height = hit.bottom - hit.top;
        } else {
          rows.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height });
        }
      });

      const quads = rows.map(function (r) {
        const a = it.vp.convertToPdfPoint(r.left - base.left, r.top - base.top);
        const b = it.vp.convertToPdfPoint(r.right - base.left, r.bottom - base.top);
        return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      });
      const text = (X.selectedText && X.selectedText()) || String(sel);
      return { it: it, quads: quads, text: text.replace(/\s+/g, ' ').trim() };
    }

    function applyMarkup(kind) {
      const got = quadsFromSelection();
      if (!got) { X.toast('Select some text on the page first'); return; }
      X.snapshot();
      got.it.shapes.push({
        t: 'markup', k: kind, id: nextId(),
        quads: got.quads, c: markupColor[kind], o: MARKUP[kind].op,
        quote: got.text.slice(0, 240),
        note: null, created: Date.now()
      });
      window.getSelection().removeAllRanges();
      X.drawShapes(got.it);
      X.drawThumb(got.it);
      X.updateMeta();
      renderComments();
      X.toast(MARKUP[kind].label + ' added');
    }

    /* Markup tools work off the text layer, not the capture layer, so they
       have no pointer handlers of their own — we watch for a finished
       selection instead. */
    document.addEventListener('mouseup', onSelectionEnd);
    document.addEventListener('touchend', onSelectionEnd);
    function onSelectionEnd() {
      if (!MARKUP[S.tool]) return;
      setTimeout(function () {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) applyMarkup(S.tool);
      }, 10);
    }

    /* ---------------- drawing the marks on screen ---------------- */

    function markupEl(it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'mk mk-' + s.k);
      (s.quads || []).forEach(function (q) {
        const a = vp.convertToViewportPoint(q[0], q[1]);
        const b = vp.convertToViewportPoint(q[2], q[3]);
        const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]);
        const y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
        let el;
        if (s.k === 'highlight') {
          el = document.createElementNS(SVGNS, 'rect');
          el.setAttribute('x', x1); el.setAttribute('y', y1);
          el.setAttribute('width', x2 - x1); el.setAttribute('height', y2 - y1);
          el.style.fill = s.c; el.style.fillOpacity = s.o;
        } else {
          el = document.createElementNS(SVGNS, 'line');
          const y = s.k === 'underline' ? y2 - (y2 - y1) * 0.08 : (y1 + y2) / 2;
          el.setAttribute('x1', x1); el.setAttribute('x2', x2);
          el.setAttribute('y1', y); el.setAttribute('y2', y);
          el.style.stroke = s.c;
          el.style.strokeWidth = Math.max(1, (y2 - y1) * 0.07 * S.scale * 1.6);
        }
        el.style.pointerEvents = 'all';
        el.style.cursor = 'pointer';
        el.addEventListener('click', function (e) { e.stopPropagation(); openThread(it, idx); });
        g.appendChild(el);
      });
      if (s.note && s.note.text) g.appendChild(noteFlag(it, s, vp, idx));
      return g;
    }

    /* the little corner triangle that says "there is a comment on this" */
    function noteFlag(it, s, vp, idx) {
      const q = s.quads[0];
      const p = vp.convertToViewportPoint(q[2], q[3]);
      const m = document.createElementNS(SVGNS, 'polygon');
      const r = 7;
      m.setAttribute('points', [p[0], p[1], p[0] + r, p[1], p[0], p[1] + r].join(' '));
      m.style.fill = s.note.resolved ? '#22A06B' : '#E2483D';
      m.style.pointerEvents = 'all'; m.style.cursor = 'pointer';
      m.addEventListener('click', function (e) { e.stopPropagation(); openThread(it, idx); });
      return m;
    }

    function inkEl(it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const pl = document.createElementNS(SVGNS, 'polyline');
      pl.setAttribute('points', (s.pts || []).map(function (p) {
        const v = vp.convertToViewportPoint(p[0], p[1]);
        return v[0] + ',' + v[1];
      }).join(' '));
      pl.setAttribute('class', 'sh');
      pl.style.stroke = s.c;
      pl.style.strokeWidth = Math.max(0.6, s.w * S.scale);
      pl.style.strokeOpacity = s.o == null ? 1 : s.o;
      pl.style.fill = 'none';
      pl.style.strokeLinecap = 'round';
      pl.style.strokeLinejoin = 'round';
      if (idx >= 0) pl.addEventListener('pointerdown', function (e) {
        if (S.tool === 'select') { e.stopPropagation(); selectShape(it, idx); }
      });
      g.appendChild(pl);
      return g;
    }

    function noteEl(it, s, vp, idx) {
      const p = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'note-mk');
      g.style.cursor = 'pointer';
      g.style.pointerEvents = 'all';
      const w = 22;
      const body = document.createElementNS(SVGNS, 'path');
      body.setAttribute('d', 'M' + p[0] + ' ' + p[1] + ' h' + w + ' v' + (w * 0.62) +
        ' l' + (-w * 0.38) + ' ' + (w * 0.38) + ' h' + (-w * 0.62) + ' z');
      body.style.fill = s.note && s.note.resolved ? '#C7E9D5' : (s.c || '#F2C14E');
      body.style.stroke = 'rgba(0,0,0,.45)';
      body.style.strokeWidth = 1;
      g.appendChild(body);
      for (let i = 0; i < 2; i++) {
        const ln = document.createElementNS(SVGNS, 'line');
        ln.setAttribute('x1', p[0] + 4); ln.setAttribute('x2', p[0] + w - 5);
        ln.setAttribute('y1', p[1] + 6 + i * 5); ln.setAttribute('y2', p[1] + 6 + i * 5);
        ln.style.stroke = 'rgba(0,0,0,.5)'; ln.style.strokeWidth = 1.4;
        g.appendChild(ln);
      }
      g.addEventListener('click', function (e) { e.stopPropagation(); openThread(it, idx); });
      return g;
    }

    function stampEl(it, s, vp, idx) {
      const def = STAMP_BY_K[s.k] || STAMPS[0];
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'stamp-mk');
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('rx', Math.min(6, h * 0.16));
      r.style.fill = 'none'; r.style.stroke = def.c;
      r.style.strokeWidth = Math.max(1.5, h * 0.06);
      r.style.strokeOpacity = 0.9;
      g.appendChild(r);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', x + w / 2); t.setAttribute('y', y + h / 2);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.textContent = def.text;
      t.style.fill = def.c;
      t.style.fontWeight = '700';
      t.style.fontFamily = 'Helvetica, Arial, sans-serif';
      t.style.fontSize = Math.max(6, h * 0.42) + 'px';
      t.style.letterSpacing = (h * 0.03) + 'px';
      g.appendChild(t);
      g.style.pointerEvents = 'all';
      if (idx >= 0) g.addEventListener('pointerdown', function (e) {
        if (S.tool === 'select') { e.stopPropagation(); selectShape(it, idx); }
      });
      return g;
    }

    function selectShape(it, idx) {
      S.sel = { it: it, i: idx };
      S.items.forEach(function (x) { X.drawShapes(x); });
    }

    X.shapeRenderers.markup = markupEl;
    X.shapeRenderers.ink = inkEl;
    X.shapeRenderers.note = noteEl;
    X.shapeRenderers.stamp = stampEl;

    /* ---------------- writing the marks into the PDF ----------------
       E.annotatePainters, in E.saveHooks */

    /* ---------------- pointer tools ---------------- */

    let stroke = null;

    X.tools.ink = {
      colors: true,
      down: function (it, at) {
        if (!it.vp) return;
        stroke = { it: it, pts: [it.vp.convertToPdfPoint(at[0], at[1])] };
        ghostInk(it);
      },
      move: function (it, at, e) {
        if (!stroke || stroke.it !== it) return;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        /* Shift turns the pen into a ruler: one straight stroke from where it
           went down, level, plumb or at 45° */
        if (e && e.shiftKey) {
          stroke.pts = [stroke.pts[0], X.snapLine(stroke.pts[0], p)];
          stroke.ruled = true;
          ghostInk(it); return;
        }
        if (stroke.ruled) { stroke.pts = [stroke.pts[0]]; stroke.ruled = false; }
        const last = stroke.pts[stroke.pts.length - 1];
        /* thin the trail out: points closer than this add cost, not detail */
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.8) return;
        stroke.pts.push(p);
        ghostInk(it);
      },
      cancel: function (it) {
        if (!stroke) return;
        stroke = null;
        X.drawShapes(it);
      },
      up: function (it) {
        if (!stroke || stroke.it !== it) return;
        const pts = stroke.pts; stroke = null;
        if (!pts.length) { X.drawShapes(it); return; }
        X.snapshot();
        it.shapes.push({ t: 'ink', pts: pts, c: S.color, w: inkWidth, o: 1, id: nextId() });
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      }
    };
    function ghostInk(it) {
      X.drawShapes(it, { t: 'ink', pts: stroke.pts, c: S.color, w: inkWidth, o: 1 });
    }

    X.tools.note = {
      down: function (it, at) {
        if (!it.vp) return;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        X.snapshot();
        it.shapes.push({
          t: 'note', a: p, c: '#F2C14E', id: nextId(),
          note: { text: '', replies: [], resolved: false, created: Date.now() }
        });
        X.drawShapes(it); X.updateMeta();
        const idx = it.shapes.length - 1;
        renderComments();
        openThread(it, idx, true);
      }
    };

    let stampDrag = null;
    X.tools.stamp = {
      down: function (it, at) {
        if (!it.vp) return;
        stampDrag = { it: it, a: it.vp.convertToPdfPoint(at[0], at[1]) };
      },
      move: function (it, at) {
        if (!stampDrag || stampDrag.it !== it) return;
        const b = it.vp.convertToPdfPoint(at[0], at[1]);
        X.drawShapes(it, { t: 'stamp', k: stampKind, a: stampDrag.a, b: b });
      },
      cancel: function (it) {
        if (!stampDrag) return;
        stampDrag = null;
        X.drawShapes(it);
      },
      up: function (it, at) {
        if (!stampDrag || stampDrag.it !== it) return;
        const a = stampDrag.a, b = it.vp.convertToPdfPoint(at[0], at[1]);
        stampDrag = null;
        let x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
        /* a plain click gets a sensible default size rather than nothing */
        if (Math.abs(x2 - x1) < 8 || Math.abs(y2 - y1) < 6) {
          x1 = a[0]; y1 = a[1] - 30; x2 = a[0] + 150; y2 = a[1];
        }
        X.snapshot();
        it.shapes.push({ t: 'stamp', k: stampKind, id: nextId(),
                         a: [Math.min(x1, x2), Math.min(y1, y2)],
                         b: [Math.max(x1, x2), Math.max(y1, y2)] });
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      }
    };

    /* markup tools take their input from the text layer, so they only need to
       exist here for the mode bar and the tool button to light up */
    Object.keys(MARKUP).forEach(function (k) { X.tools[k] = { textSelect: true }; });

    /* ---------------- comment threads ---------------- */

    const pop = document.createElement('div');
    pop.className = 'cthread'; pop.id = 'cthread'; pop.hidden = true;
    document.body.appendChild(pop);
    let openOn = null;   /* {it, idx} */

    function shapeOf(ref) { return ref && ref.it.shapes[ref.idx]; }

    function openThread(it, idx, focus) {
      const s = it.shapes[idx];
      if (!s) return;
      if (!s.note) s.note = { text: '', replies: [], resolved: false, created: Date.now() };
      openOn = { it: it, idx: idx };
      paintThread(focus);
    }

    function closeThread() {
      if (openOn) {
        const s = shapeOf(openOn);
        /* an empty sticky note the reader never typed into is just clutter */
        if (s && s.t === 'note' && !s.note.text.trim() && !s.note.replies.length) {
          openOn.it.shapes.splice(openOn.idx, 1);
          X.drawShapes(openOn.it);
        }
      }
      openOn = null; pop.hidden = true; renderComments();
    }

    function paintThread(focus) {
      const s = shapeOf(openOn); if (!s) { pop.hidden = true; return; }
      const n = s.note;
      const quote = s.t === 'markup' && s.quote
        ? '<blockquote class="cq">' + X.esc(s.quote) + '</blockquote>' : '';
      pop.innerHTML =
        '<header><b>' + (s.t === 'note' ? 'Note' : (MARKUP[s.k] ? MARKUP[s.k].label : 'Comment')) + '</b>' +
        '<span class="grow"></span>' +
        '<button class="lnk" id="ctResolve">' + (n.resolved ? 'Reopen' : 'Resolve') + '</button>' +
        '<button class="lnk del" id="ctDelete">Delete</button>' +
        '<button class="x" id="ctClose" aria-label="Close">&times;</button></header>' +
        quote +
        '<textarea id="ctText" placeholder="Write a comment…" rows="3">' + X.esc(n.text || '') + '</textarea>' +
        '<div class="creplies">' + n.replies.map(function (r, i) {
          return '<div class="crep"><p>' + X.esc(r.text) + '</p>' +
                 '<button class="lnk del" data-rep="' + i + '">Remove</button></div>';
        }).join('') + '</div>' +
        '<div class="cacts"><input id="ctReply" placeholder="Reply…">' +
        '<button class="btn" id="ctReplyGo">Reply</button></div>';

      const s0 = shapeOf(openOn);
      const anchor = anchorPoint(openOn.it, s0);
      pop.hidden = false;
      const box = pop.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - box.width - 12, anchor.x + 14));
      const top = Math.max(12, Math.min(window.innerHeight - box.height - 12, anchor.y));
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
      pop.classList.toggle('resolved', !!n.resolved);

      const ta = pop.querySelector('#ctText');
      ta.addEventListener('input', function () {
        n.text = ta.value;
      });
      ta.addEventListener('blur', function () { X.drawShapes(openOn.it); renderComments(); });
      if (focus) ta.focus();

      pop.querySelector('#ctClose').addEventListener('click', closeThread);
      pop.querySelector('#ctResolve').addEventListener('click', function () {
        n.resolved = !n.resolved;
        X.drawShapes(openOn.it); paintThread(); renderComments();
      });
      pop.querySelector('#ctDelete').addEventListener('click', function () {
        X.snapshot();
        openOn.it.shapes.splice(openOn.idx, 1);
        const it = openOn.it; openOn = null; pop.hidden = true;
        X.drawShapes(it); X.drawThumb(it); X.updateMeta(); renderComments();
        X.toast('Comment removed · <b>Ctrl+Z</b> to undo');
      });
      const go = function () {
        const v = pop.querySelector('#ctReply').value.trim();
        if (!v) return;
        n.replies.push({ text: v, created: Date.now() });
        paintThread(); renderComments();
      };
      pop.querySelector('#ctReplyGo').addEventListener('click', go);
      pop.querySelector('#ctReply').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); go(); }
      });
      Array.prototype.forEach.call(pop.querySelectorAll('[data-rep]'), function (b) {
        b.addEventListener('click', function () {
          n.replies.splice(+b.dataset.rep, 1); paintThread(); renderComments();
        });
      });
    }

    function anchorPoint(it, s) {
      if (!it.vp || !it.inner) return { x: window.innerWidth / 2, y: 120 };
      const base = it.inner.getBoundingClientRect();
      const pt = s.t === 'markup' && s.quads && s.quads.length
        ? [s.quads[0][2], s.quads[0][3]]
        : (s.a || [0, 0]);
      const v = it.vp.convertToViewportPoint(pt[0], pt[1]);
      return { x: base.left + v[0], y: base.top + v[1] };
    }

    document.addEventListener('mousedown', function (e) {
      if (pop.hidden || pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.anno')) return;
      closeThread();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.hidden) { closeThread(); return; }
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      /* Highlight and Pen sit on Shift because core already owns plain k
         (previous page) and p (fit page); firing both was the old behaviour. */
      const hit = TOOLS.filter(function (T) {
        return T.key.toLowerCase() === k && !!T.shift === !!e.shiftKey;
      })[0];
      if (hit && S.items.length) { e.preventDefault(); X.toggleTool(hit.t); }
    });

    /* ---------------- comments panel ---------------- */

    const railTabs = document.querySelector('.rail-tabs');
    const tabBtn = document.createElement('button');
    tabBtn.className = 'btn'; tabBtn.id = 'tabComments'; tabBtn.textContent = 'Notes';
    tabBtn.title = 'Comments on this document';
    railTabs.insertBefore(tabBtn, $('railClose'));

    const panel = document.createElement('div');
    panel.className = 'rail-body'; panel.id = 'railComments'; panel.hidden = true;
    panel.innerHTML =
      '<div class="cbar">' +
      '<select id="cFilter" aria-label="Filter comments">' +
      '<option value="all">All comments</option>' +
      '<option value="open">Open only</option>' +
      '<option value="resolved">Resolved only</option>' +
      '</select>' +
      '<button class="btn" id="cExport" title="Save every comment as a text file">Export</button>' +
      '</div><div class="ccount" id="cCount"></div><div id="cList"></div>';
    $('railPins').parentNode.insertBefore(panel, $('railPins').nextSibling);

    /* the core owns which rail body is visible; mirror its switch for ours */
    const RAIL_TABS = [
      ['tabPages', 'railPages'], ['tabFind', 'railFind'],
      ['tabPins', 'railPins'], ['tabComments', 'railComments']
    ];
    function showRail(which) {
      RAIL_TABS.forEach(function (pair) {
        $(pair[0]).classList.toggle('on', pair[0] === which);
        $(pair[1]).hidden = pair[0] !== which;
      });
      if (which === 'tabComments') renderComments();
    }
    RAIL_TABS.forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () { showRail(pair[0]); });
    });

    $('cFilter').addEventListener('change', renderComments);
    $('cExport').addEventListener('click', exportComments);

    function allComments() {
      const out = [];
      S.items.forEach(function (it, pi) {
        it.shapes.forEach(function (s, si) {
          if (s.t !== 'markup' && s.t !== 'note') return;
          const hasText = s.note && (s.note.text.trim() || s.note.replies.length);
          if (s.t === 'markup' && !hasText && !s.quote) return;
          out.push({ it: it, idx: si, page: pi + 1, s: s });
        });
      });
      return out;
    }

    function renderComments() {
      const filter = $('cFilter').value;
      const list = allComments().filter(function (c) {
        const res = !!(c.s.note && c.s.note.resolved);
        return filter === 'all' || (filter === 'open' ? !res : res);
      });
      const host = $('cList');
      const open = allComments().filter(function (c) { return !(c.s.note && c.s.note.resolved); }).length;
      $('cCount').innerHTML = list.length
        ? '<b>' + list.length + '</b> shown · <b>' + open + '</b> open'
        : '';
      if (!list.length) {
        host.innerHTML = '<div class="cempty">No comments yet.<br><br>' +
          'Select text and choose <b>Highlight</b>, <b>Underline</b> or <b>Strike out</b>, ' +
          'or drop a <b>Sticky note</b> (N) anywhere on a page.</div>';
        return;
      }
      host.innerHTML = list.map(function (c, i) {
        const n = c.s.note || { text: '', replies: [], resolved: false };
        const kind = c.s.t === 'note' ? 'Note' : (MARKUP[c.s.k] ? MARKUP[c.s.k].label : 'Comment');
        const swatch = c.s.t === 'note' ? (c.s.c || '#F2C14E') : c.s.c;
        return '<article class="citem' + (n.resolved ? ' done' : '') + '" data-i="' + i + '">' +
          '<header><i class="dot" style="background:' + X.esc(swatch) + '"></i>' +
          '<b>' + kind + '</b><span class="pg">p.' + c.page + '</span></header>' +
          (c.s.quote ? '<blockquote>' + X.esc(c.s.quote) + '</blockquote>' : '') +
          (n.text.trim() ? '<p>' + X.esc(n.text) + '</p>' : '<p class="muted">No comment yet</p>') +
          (n.replies.length ? '<span class="reps">' + n.replies.length + ' repl' +
            (n.replies.length === 1 ? 'y' : 'ies') + '</span>' : '') +
          '</article>';
      }).join('');
      Array.prototype.forEach.call(host.children, function (el) {
        el.addEventListener('click', function () {
          const c = list[+el.dataset.i];
          X.goTo(S.items.indexOf(c.it) + 1);
          setTimeout(function () { openThread(c.it, c.idx); }, 260);
        });
      });
    }

    function exportComments() {
      const list = allComments();
      if (!list.length) { X.toast('There are no comments to export'); return; }
      const lines = ['Comments — ' + S.baseName, new Date().toLocaleString(), ''];
      list.forEach(function (c) {
        const n = c.s.note || { text: '', replies: [] };
        lines.push('── Page ' + c.page + ' · ' +
          (c.s.t === 'note' ? 'Note' : (MARKUP[c.s.k] ? MARKUP[c.s.k].label : 'Comment')) +
          (n.resolved ? ' (resolved)' : ''));
        if (c.s.quote) lines.push('   “' + c.s.quote + '”');
        if (n.text.trim()) lines.push('   ' + n.text.replace(/\n/g, '\n   '));
        n.replies.forEach(function (r) { lines.push('   ↳ ' + r.text); });
        lines.push('');
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = S.baseName + ' — comments.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      X.toast('Comments exported');
    }

    X.on('pages', renderComments);
    X.on('reset', function () { openOn = null; pop.hidden = true; });
    X.renderComments = renderComments;
    X.allComments = allComments;
    X.MARKUP = MARKUP;
    renderComments();
  });
})();
