/* ADD DOTS PDF — Edit Object
   -------------------------
   The page's own content made editable, as in Foxit's Edit Object: Edit tab,
   Edit Object, then All, Text or Shape.

   Shapes (this file): pointing at a line, box, curve or filled area the PDF
   itself draws outlines it; clicking it lifts it off the page. The page is
   redrawn from a copy of itself with that shape cut out of its content
   (engine content.ts: the shape's own operators, nothing else), and the
   shape comes back as a mark, selected, to move, resize, recolour, restyle
   or delete like any other. It saves as a path again (painters/vpath.ts).
   Undo puts the page back as it was.

   Clicking another shape while one is selected lifts that one; clicking
   empty page lets go and Edit Object carries on until another tool is
   picked or Esc is pressed. Text comes next (stage 2): for now its choice
   says so.

   Not offered: shapes inside a form XObject, clipping paths, and shapes
   painted with a pattern or shading, as cutting those would change more
   than the one shape; and pages of a password-protected PDF. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[editobj] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, E = window.ADDPDFEngine, SVGNS = X.SVGNS;
    if (!E || !E.pageShapes) return;

    /* ---------------- the button and its choices ---------------- */

    let mode = 'all';                        /* all | text | shape */
    const grp = document.createElement('div');
    grp.className = 'grp'; grp.id = 'grpEditObj'; grp.setAttribute('role', 'group');
    grp.setAttribute('aria-label', 'Edit object');
    const btn = document.createElement('button');
    btn.className = 'btn eobtn'; btn.id = 'tEditObj'; btn.type = 'button';
    btn.title = 'Edit Object: the PDF\'s own text and shapes (Shift+O)';
    btn.setAttribute('aria-label', 'Edit Object');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.dataset.label = 'Edit Object';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h9l4 4v5"/><path d="M13 4v4h4"/>' +
      '<path d="M4 4v16h7"/><path d="M14.5 20.5l1-3.5 5-5 2.5 2.5-5 5z"/></svg><b class="eocaret">▾</b>';
    grp.appendChild(btn);
    const sep = document.createElement('span'); sep.className = 'sep'; sep.setAttribute('aria-hidden', 'true');
    const tools = $('grpTools');
    tools.insertAdjacentElement('afterend', grp);
    tools.insertAdjacentElement('afterend', sep);

    const menu = document.createElement('div');
    menu.className = 'eomenu'; menu.id = 'eoMenu'; menu.hidden = true; menu.setAttribute('role', 'menu');
    menu.innerHTML =
      '<button type="button" role="menuitemradio" data-m="all"><i>✓</i>All</button>' +
      '<button type="button" role="menuitemradio" data-m="text"><i>✓</i>Text <small>coming next</small></button>' +
      '<button type="button" role="menuitemradio" data-m="shape"><i>✓</i>Shape</button>';
    document.body.appendChild(menu);
    function paintMenu() {
      Array.prototype.forEach.call(menu.children, function (b) {
        b.classList.toggle('on', b.dataset.m === mode);
        b.setAttribute('aria-checked', b.dataset.m === mode ? 'true' : 'false');
      });
    }
    function openMenu() {
      paintMenu();
      menu.hidden = false;
      const r = btn.getBoundingClientRect();
      menu.style.left = Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, r.left)) + 'px';
      menu.style.top = (r.bottom + 4) + 'px';
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!menu.hidden) { menu.hidden = true; return; }
      openMenu();
    });
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      menu.hidden = true;
      if (b.dataset.m === 'text') {
        X.toast('Editing the PDF\'s own text is coming next. For now the <b>Text</b> tool retypes a line.');
        return;
      }
      mode = b.dataset.m;
      sticky = false;
      X.setTool('editobj');
    });
    document.addEventListener('pointerdown', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) menu.hidden = true;
    }, true);

    X.toolBtn.editobj = 'tEditObj';
    X.hints.editobj = 'Point at a line, box or shape the PDF draws, and click it to edit it: move it, ' +
      'pull its corners, change its colours or line, or delete it. <b>Esc</b> finishes.';

    /* ---------------- the page's shapes ---------------- */

    const docs = new WeakMap();              /* src -> pdf-lib document */
    const lists = new WeakMap();             /* src -> Map(num -> shapes) */
    function docOf(src) {
      if (!docs.has(src)) {
        const p = src.password ? Promise.reject(new Error('protected'))
          : X.PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
        p.catch(function () {});
        docs.set(src, p);
      }
      return docs.get(src);
    }
    function shapesOf(it) {
      let m = lists.get(it.src);
      if (!m) lists.set(it.src, (m = new Map()));
      if (!m.has(it.num)) {
        const num = it.num, src = it.src;
        m.set(num, docOf(src).then(function (d) {
          return E.pageShapes(d, num - 1).map(function (s) { s.segs = null; return s; });
        }).catch(function (err) {
          console.warn('[editobj] page content', err);
          return null;
        }));
      }
      return m.get(it.num);
    }

    /* a shape as straight pieces (curves in short chords), and its outlines as rings */
    function flatten(s) {
      if (s.segs) return s;
      const segs = [], rings = [];
      let j = 0, cur = null, start = null, ring = null;
      for (let k = 0; k < s.cmds.length; k++) {
        const c = s.cmds[k];
        if (c === 'M') {
          cur = start = s.pts[j++];
          ring = [cur]; rings.push(ring);
        } else if (c === 'L') {
          const p = s.pts[j++];
          if (cur) segs.push([cur, p]);
          cur = p; if (ring) ring.push(p);
        } else if (c === 'C') {
          const a = s.pts[j++], b = s.pts[j++], e = s.pts[j++];
          if (cur) {
            let prev = cur;
            for (let t = 1; t <= 12; t++) {
              const u = t / 12, v = 1 - u;
              const q = [v * v * v * cur[0] + 3 * v * v * u * a[0] + 3 * v * u * u * b[0] + u * u * u * e[0],
                v * v * v * cur[1] + 3 * v * v * u * a[1] + 3 * v * u * u * b[1] + u * u * u * e[1]];
              segs.push([prev, q]); if (ring) ring.push(q);
              prev = q;
            }
          }
          cur = e;
        } else if (c === 'Z') {
          if (cur && start) segs.push([cur, start]);
          cur = start;
        }
      }
      s.segs = segs; s.rings = rings;
      return s;
    }
    function segDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = dx * dx + dy * dy;
      let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    }
    function inside(p, rings) {
      let n = 0;
      rings.forEach(function (r) {
        for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
          const a = r[i], b = r[k];
          if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) n++;
        }
      });
      return n % 2 === 1;
    }
    /* the shape under p (PDF points): a line within reach first, the
       nearest; else the smallest filled area p is in */
    function hitAt(list, p) {
      const tol = 6 / S.scale;
      let best = null, bestD = Infinity, area = null, bestA = Infinity;
      for (const s of list) {
        const b = s.box;
        if (p[0] < b[0] - tol || p[0] > b[2] + tol || p[1] < b[1] - tol || p[1] > b[3] + tol) continue;
        flatten(s);
        if (s.stroke) {
          const reach = tol + s.w / 2;
          for (const g of s.segs) {
            const d = segDist(p, g[0], g[1]);
            if (d <= reach && d < bestD) { bestD = d; best = s; }
          }
        }
        if (s.fill && inside(p, s.rings)) {
          const a = (b[2] - b[0]) * (b[3] - b[1]);
          if (a < bestA) { bestA = a; area = s; }
        }
      }
      return best || area;
    }

    /* ---------------- on the page ---------------- */

    X.shapeRenderers.vpath = function (it, s, vp, idx) {
      const el = document.createElementNS(SVGNS, 'path');
      const d = E.vpathD({ k: s.k, pts: s.pts.map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); }) });
      el.setAttribute('d', d);
      if (s.hl) {
        /* the shape about to be picked */
        el.setAttribute('class', 'eohl');
        return el;
      }
      const sw = Math.max(0.6, s.w * S.scale);
      el.setAttribute('class', 'sh');
      el.style.stroke = s.nos ? 'none' : s.c;
      el.style.strokeWidth = sw;
      el.style.strokeOpacity = X.shOp(s);
      el.style.strokeLinecap = X.CAP_CSS[X.shCap(s)];
      el.style.strokeLinejoin = X.JOIN_CSS[X.shJoin(s)];
      const da = s.d ? X.dashOf(s, sw) : s.dash ? s.dash.map(function (v) { return v * S.scale; }) : null;
      el.style.strokeDasharray = da && da.length ? da.join(' ') : 'none';
      el.style.fill = s.fill || 'none';
      if (s.fill) { el.style.fillOpacity = s.fo == null ? X.shOp(s) : s.fo; el.style.fillRule = 'evenodd'; }
      if (s.fill || s.nos) el.style.pointerEvents = 'all';
      if (idx >= 0) el.addEventListener('pointerdown', function (e) { X.beginDrag(it, idx, e, 'move'); });
      return el;
    };
    X.handleKind.vpath = 'bbox';

    let hover = null;                        /* {it, s} under the pointer */
    function showHover(it, s) {
      if (hover && hover.it === it && hover.s === s) return;
      const was = hover && hover.it;
      hover = s ? { it: it, s: s } : null;
      if (was && was !== it) X.drawShapes(was);
      if (s) X.drawShapes(it, { t: 'vpath', hl: true, k: s.cmds, pts: s.pts, c: '#1473E6', w: 1 });
      else if (was) X.drawShapes(was);
    }

    let busy = false;
    async function lift(it, s) {
      if (busy) return;
      busy = true;
      try {
        const d = await docOf(it.src);
        const bytes = await E.cutShapes(d, it.num - 1, [s.id]);
        X.snapshot();
        const src = await X.addSource(it.src.name, bytes, true);
        const mark = E.vpathFromShape(s);
        it.shapes.push(mark);
        hover = null;
        sticky = true;
        X.setTool('select');
        S.sel = { it: it, i: it.shapes.length - 1 };
        S.multi = null;
        await X.swapSource(it, src);
        X.drawShapes(it);
        X.syncMarkPop();
        sticky = true;
      } catch (err) {
        console.error('[editobj] lift', err);
        X.toast(/protected|encrypt/i.test(String(err && err.message)) ?
          'This PDF is password-protected: its own content cannot be edited' :
          'That shape could not be edited');
      } finally { busy = false; }
    }

    function pageAt(it, at) { return it.vp ? it.vp.convertToPdfPoint(at[0], at[1]) : null; }
    let down = null;
    X.tools.editobj = {
      down: function (it, at, e) { down = { it: it, x: e.clientX, y: e.clientY }; },
      move: function (it, at) {
        if (busy) return;
        const p = pageAt(it, at);
        shapesOf(it).then(function (list) {
          if (S.tool !== 'editobj' || !list) { showHover(null, null); return; }
          showHover(it, p ? hitAt(list, p) : null);
        });
      },
      up: function (it, at, e) {
        const d = down; down = null;
        if (!d || d.it !== it || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
        const p = pageAt(it, at);
        shapesOf(it).then(function (list) {
          if (list === null) {
            X.toast(it.src.password ? 'This PDF is password-protected: its own content cannot be edited'
              : 'This page\'s content could not be read');
            return;
          }
          const s = list && p ? hitAt(list, p) : null;
          if (s) lift(it, s);
          else X.toast('No shape there. Point at a line or shape: it lights up when it can be edited.');
        });
      },
      cancel: function () { down = null; }
    };

    /* ---------------- staying in Edit Object ---------------- */
    /* After a lift the shape is selected (Select, its grips and properties);
       a click on another of the page's shapes lifts that one, and a click on
       empty page lets go and comes back here. */
    let sticky = false;
    X.on('tool', function (t) {
      if (t !== 'select' && t !== 'editobj') sticky = false;
      if (t === 'editobj') sticky = false;
      if (t !== 'editobj') showHover(null, null);
      btn.classList.toggle('on', t === 'editobj' || (t === 'select' && sticky));
    });
    $('stage').addEventListener('pointerdown', function (e) {
      if (!sticky || S.tool !== 'select' || e.button !== 0 || busy) return;
      /* on a mark or its grips: Select has it */
      const anno = e.target.closest && e.target.closest('.anno');
      if (anno && e.target !== anno) return;
      const box = e.target.closest && e.target.closest('.pagebox');
      const it = box && box._it;
      if (!it || !it.vp || !it.anno) return;
      const r = it.anno.getBoundingClientRect();
      const p = it.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      const pending = shapesOf(it);
      e.preventDefault(); e.stopPropagation();
      pending.then(function (list) {
        const s = list ? hitAt(list, p) : null;
        if (s) { lift(it, s); return; }
        /* empty page: let go, and pick again */
        S.sel = null; S.multi = null;
        X.redrawAll();
        X.syncMarkPop();
        X.setTool('editobj');
      });
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (S.tool === 'editobj') { X.setTool('select'); return; }
      if (sticky && S.tool === 'select') sticky = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key !== 'O' || !S.items.length) return;
      e.preventDefault();
      X.setTool(S.tool === 'editobj' ? 'select' : 'editobj');
    });
    X.on('reset', function () { sticky = false; hover = null; });
  });
})();
