/* Add Dots PDF — Gradient panel and Gradient tool
   ----------------------------------------------
   Illustrator's gradients, for any closed shape (a box, circle, cloud, a
   closed Continuous Line or Pen path, an Edit Object or Pathfinder shape):

   The Gradient panel, in the selected mark's properties:
   • the swatch applies a gradient (white to black, as Illustrator starts
     one); the cross takes it off again, leaving the plain fill
   • Type: Linear or Radial
   • Edit Gradient picks up the Gradient tool
   • the angle, and Reverse
   • the gradient slider: stops under the ramp, midpoints (diamonds) over
     it. Click under the ramp to add a stop, drag a stop to move it, drag it
     down off the slider or press the bin to delete it, double-click it for
     its colour. Drag a diamond to move where the blend is half way.
   • the stop picked: its colour, opacity and location

   The Gradient tool (G), on the selected shape:
   • the annotator shows the gradient's vector: a circle where it starts, a
     square where it ends, and the stops along it
   • drag anywhere to lay the gradient along that drag (Shift keeps it to
     steps of 45°); a click on a shape with no gradient gives it one
   • drag the circle to move the gradient, the square to turn or stretch
     it, and a stop to move it along
   • Esc, V or another tool puts it down

   The gradient itself (s.grad), how it is laid out on the shape and how it
   is blended are the engine's (gradient.ts): the screen (core's paintFill)
   and the saved PDF (painters/gradient.ts) both read it from there. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[gradient] core bridge missing'); return; }
  const E = window.ADDPDFEngine;

  const SNAP = 45;
  const HIT = 8;                               /* px round a handle that grab it */
  const svg = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>'; };
  const ICON = {
    tool: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M7 17L17 7"/><circle cx="7" cy="17" r="1.6" fill="currentColor"/><rect x="15.6" y="5.6" width="2.8" height="2.8" fill="currentColor"/>',
    linear: '<defs><linearGradient id="grIcL" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><rect x="4" y="4" width="16" height="16" rx="1.5" fill="url(#grIcL)"/>',
    radial: '<defs><radialGradient id="grIcR"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></radialGradient></defs><rect x="4" y="4" width="16" height="16" rx="1.5" fill="url(#grIcR)"/>',
    angle: '<path d="M4 19h16M4 19L15 6"/><path d="M10 19a6 6 0 0 0-1.6-4.2"/>',
    reverse: '<path d="M4 9h14l-3-3M20 15H6l3 3"/>',
    bin: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5"/>',
    none: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  X.on('ready', function () {
    const S = X.S, $ = X.$, SVGNS = X.SVGNS;
    const pop = $('markPop'), stage = $('stage');
    if (!pop) return;

    /* ---------------- what is selected ---------------- */

    /** The closed shapes selected: their page, indices, and the one the
        panel reads (the mark the selection was made on, else the first). */
    function targets() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it || !S.sel.it.shapes) return null;
      const it = S.sel.it;
      const idx = X.selList().filter(function (i) {
        const s = it.shapes[i];
        return s && !s.locked && X.closedShape(s);
      });
      if (!idx.length) return null;
      const main = idx.indexOf(S.sel.i) >= 0 ? S.sel.i : idx[0];
      return { it: it, idx: idx, i: main, s: it.shapes[main] };
    }

    function copyGrad(g) { return JSON.parse(JSON.stringify(g)); }
    /** The gradient written onto a mark: a fresh object each time (marks are
        copied shallowly for undo), its fill kept as the first colour. */
    function put(s, g) {
      const st = E.gradStops(g);
      s.grad = g;
      s.fill = st[0].c;
    }
    /** The stops and blend the panel shows, with the mark's own vector. */
    function forMark(s, from) {
      const g = copyGrad(from);
      if (s.grad && s.grad.g1 && s.grad.g2 && s.grad.k === from.k) { g.g1 = s.grad.g1.slice(); g.g2 = s.grad.g2.slice(); }
      else if (!from.g1 || s.grad && s.grad.k !== from.k) {
        const d = E.defaultGrad(from.k);
        g.g1 = d.g1; g.g2 = d.g2;
      }
      return g;
    }

    /* one undo step for a whole drag: the snapshot goes in on the first change */
    let held = false;
    function hold() { if (!held) { X.snapshot(); held = true; } }
    function release(t) {
      if (!held) return;
      held = false;
      if (t) { X.drawThumb(t.it); X.updateMeta(); }
    }
    function redraw(t) {
      X.drawShapes(t.it);
      X.syncMarkPop();
      sync();
    }

    /** Change the panel's gradient: fn gets a copy to change and returns it
        (or nothing, to keep the change it made). Every closed shape selected
        takes the result, each with its own vector. */
    function change(fn, live) {
      const t = targets();
      if (!t) return;
      const base = t.s.grad ? copyGrad(t.s.grad) : fromFill(t.s);
      const g = fn(base) || base;
      if (live) hold(); else X.snapshot();
      t.idx.forEach(function (i) {
        const s = t.it.shapes[i];
        put(s, i === t.i ? g : forMark(s, g));
      });
      if (!live) { X.drawThumb(t.it); X.updateMeta(); }
      redraw(t);
    }
    /* a new gradient, as Illustrator starts one: white to black */
    function fromFill() { return E.defaultGrad('linear'); }

    function clearGrad() {
      const t = targets();
      if (!t) return;
      X.snapshot();
      t.idx.forEach(function (i) { delete t.it.shapes[i].grad; });
      active = 0;
      X.drawThumb(t.it); X.updateMeta();
      redraw(t);
    }

    /* ---------------- the panel ---------------- */

    const sec = document.createElement('div');
    sec.className = 'mpgrad'; sec.id = 'mpGrad'; sec.hidden = true;
    sec.innerHTML =
      '<div class="grhd"><span>Gradient</span>' +
        '<button type="button" class="grnone" id="grNone" title="Remove gradient" aria-label="Remove gradient">' + svg(ICON.none) + '</button></div>' +
      '<div class="grtop">' +
        '<button type="button" class="grsw" id="grSwatch" title="Gradient fill" aria-label="Gradient fill"><i></i></button>' +
        '<div class="grtype" role="group" aria-label="Gradient type"><span>Type:</span>' +
          '<button type="button" class="grtog" data-k="linear" title="Linear gradient" aria-label="Linear gradient">' + svg(ICON.linear) + '</button>' +
          '<button type="button" class="grtog" data-k="radial" title="Radial gradient" aria-label="Radial gradient">' + svg(ICON.radial) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="grbody" id="grBody">' +
        '<button type="button" class="gredit" id="grEdit" title="Edit the gradient on the shape: Gradient tool (G)">Edit Gradient</button>' +
        '<div class="grrow">' +
          '<label class="grf" title="Angle"><span class="gri">' + svg(ICON.angle) + '</span>' +
            '<input type="text" id="grAngle" inputmode="decimal" aria-label="Gradient angle in degrees"><em>°</em></label>' +
          '<button type="button" class="grtog" id="grRev" title="Reverse gradient" aria-label="Reverse gradient">' + svg(ICON.reverse) + '</button>' +
        '</div>' +
        '<div class="grslider">' +
          '<div class="grbar" id="grBar">' +
            '<div class="grmids" id="grMids"></div>' +
            '<div class="grramp" id="grRamp"><i></i></div>' +
            '<div class="grstops" id="grStops" title="Click to add a stop"></div>' +
          '</div>' +
          '<button type="button" class="grtog" id="grDel" title="Delete stop" aria-label="Delete stop">' + svg(ICON.bin) + '</button>' +
        '</div>' +
        '<div class="grrow grstop">' +
          '<button type="button" class="grchip" id="grColour" title="Stop colour" aria-label="Stop colour"><i></i></button>' +
          '<label class="grf" title="Opacity"><span>Opacity</span><input type="text" id="grOpacity" inputmode="numeric" aria-label="Stop opacity in percent"><em>%</em></label>' +
          '<label class="grf" title="Location"><span>Location</span><input type="text" id="grLoc" inputmode="decimal" aria-label="Stop location in percent"><em>%</em></label>' +
        '</div>' +
      '</div>';
    /* after the fill and line settings, ahead of Align and Pathfinder */
    const arr = $('mpArrange');
    if (arr && arr.parentNode === pop) pop.insertBefore(sec, arr); else pop.appendChild(sec);

    let active = 0;                             /* the stop picked */
    let activeKey = '';                         /* which selection it belongs to */
    const num = function (v) { const n = parseFloat(String(v).replace(',', '.').replace('%', '').replace('°', '')); return isNaN(n) ? null : n; };
    const r1 = function (v) { return Math.round(v * 10) / 10; };

    function sync() {
      const t = targets();
      sec.hidden = !t;
      if (!t) { closePal(); return; }
      const key = t.i + '@' + S.items.indexOf(t.it);
      if (key !== activeKey) { activeKey = key; active = 0; }
      const s = t.s, g = s.grad || null;
      sec.classList.toggle('none', !g);
      $('grBody').hidden = !g;
      $('grNone').hidden = !g;
      $('grSwatch').querySelector('i').style.background = X.gradCss(g || E.defaultGrad());
      $('grSwatch').classList.toggle('on', !!g);
      sec.querySelectorAll('.grtype .grtog').forEach(function (b) {
        const on = !!g && g.k === b.dataset.k;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      $('grEdit').classList.toggle('on', tool);
      if (!g) return;
      const st = E.gradStops(g);
      if (active >= st.length) active = st.length - 1;
      if (document.activeElement !== $('grAngle')) {
        let a = E.gradAngle(s, g);
        if (a <= -180) a += 360;
        $('grAngle').value = r1(a);
      }
      $('grRamp').querySelector('i').style.background = X.gradCss(g);
      /* the stops */
      const box = $('grStops');
      box.innerHTML = st.map(function (x, k) {
        return '<button type="button" class="grstp' + (k === active ? ' on' : '') + '" data-k="' + k + '" style="left:' + (x.p * 100) + '%"' +
          ' title="Stop ' + (k + 1) + ': ' + x.c + ' — drag to move, drag down to delete, double-click for its colour"' +
          ' aria-label="Stop ' + (k + 1) + ' at ' + Math.round(x.p * 100) + '%"><i style="background:' + x.c + '"></i></button>';
      }).join('');
      /* the midpoints */
      const mids = Array.isArray(g.mid) ? g.mid : [];
      let h = '';
      for (let k = 0; k + 1 < st.length; k++) {
        const m = mids[k] == null ? 0.5 : mids[k];
        const p = st[k].p + (st[k + 1].p - st[k].p) * m;
        if (st[k + 1].p - st[k].p < 0.02) continue;
        h += '<span class="grmid" data-k="' + k + '" style="left:' + (p * 100) + '%" title="Midpoint: ' + Math.round(m * 100) + '%"></span>';
      }
      $('grMids').innerHTML = h;
      const a = st[active];
      $('grColour').querySelector('i').style.background = a.c;
      if (document.activeElement !== $('grOpacity')) $('grOpacity').value = Math.round((a.o == null ? 1 : a.o) * 100);
      if (document.activeElement !== $('grLoc')) $('grLoc').value = r1(a.p * 100);
      $('grDel').disabled = st.length <= 2;
    }
    X.on('markpop', function () { sync(); });

    /* ---- the type, the swatch, remove ---- */
    $('grSwatch').addEventListener('click', function () {
      const t = targets();
      if (!t) return;
      if (!t.s.grad) change(function () { return E.defaultGrad('linear'); });
    });
    $('grNone').addEventListener('click', clearGrad);
    sec.querySelectorAll('.grtype .grtog').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = b.dataset.k;
        change(function (g) {
          if (g.k === k && targets().s.grad) return g;
          const d = E.defaultGrad(k);
          g.k = k; g.g1 = d.g1; g.g2 = d.g2;
          return g;
        });
      });
    });
    $('grEdit').addEventListener('click', function () { setOn(!tool); });

    /* ---- angle and reverse ---- */
    function setAngle() {
      const v = num($('grAngle').value);
      const t = targets();
      if (v == null || !t || !t.s.grad) { sync(); return; }
      X.snapshot();
      t.idx.forEach(function (i) {
        const s = t.it.shapes[i];
        if (s.grad) put(s, E.gradWithAngle(s, copyGrad(s.grad), v));
      });
      X.drawThumb(t.it); X.updateMeta();
      redraw(t);
    }
    $('grAngle').addEventListener('change', setAngle);
    $('grAngle').addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); setAngle(); this.blur(); }
      else if (e.key === 'Escape') { sync(); this.blur(); }
    });
    $('grRev').addEventListener('click', function () {
      change(function (g) {
        const st = E.gradStops(g);
        g.stops = st.slice().reverse().map(function (x) { return { c: x.c, p: Math.round((1 - x.p) * 1e4) / 1e4, o: x.o }; });
        if (Array.isArray(g.mid)) g.mid = g.mid.slice(0, st.length - 1).reverse().map(function (m) { return m == null ? 0.5 : 1 - m; });
        active = st.length - 1 - active;
        return g;
      });
    });

    /* ---- the stop picked: colour, opacity, location ---- */
    function setStop(fn) {
      change(function (g) {
        const st = E.gradStops(g);
        if (!st[active]) return g;
        const pick = st[active];
        fn(pick);
        g.stops = st;
        resort(g, pick);
        return g;
      });
    }
    /* stops kept in order; the one being worked on stays picked, and the
       midpoints go back to the middle if the order changed */
    function resort(g, pick) {
      const before = g.stops.slice();
      g.stops.sort(function (a, b) { return a.p - b.p; });
      if (g.stops.some(function (x, k) { return x !== before[k]; })) delete g.mid;
      if (pick) active = g.stops.indexOf(pick);
    }
    $('grOpacity').addEventListener('change', function () {
      const v = num(this.value);
      if (v == null) { sync(); return; }
      setStop(function (x) { x.o = Math.max(0, Math.min(100, v)) / 100; });
    });
    $('grLoc').addEventListener('change', function () {
      const v = num(this.value);
      if (v == null) { sync(); return; }
      setStop(function (x) { x.p = Math.round(Math.max(0, Math.min(100, v)) * 100) / 10000; });
    });
    ['grOpacity', 'grLoc'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.dispatchEvent(new Event('change')); this.blur(); }
        else if (e.key === 'Escape') { sync(); this.blur(); }
      });
    });

    function deleteStop(k) {
      change(function (g) {
        const st = E.gradStops(g);
        if (st.length <= 2 || !st[k]) return g;
        st.splice(k, 1);
        g.stops = st;
        if (Array.isArray(g.mid)) { g.mid.splice(Math.max(0, k - 1), 2, 0.5); g.mid = g.mid.slice(0, st.length - 1); }
        active = Math.max(0, Math.min(st.length - 1, k - 1));
        return g;
      });
    }
    $('grDel').addEventListener('click', function () { deleteStop(active); });

    /* ---- a stop's colour: the app's own palette ---- */
    const pal = document.createElement('div');
    pal.className = 'swpop palette grpal'; pal.id = 'grPal'; pal.hidden = true;
    document.body.appendChild(pal);
    function closePal() { pal.hidden = true; }
    function openPal(anchor) {
      const t = targets();
      if (!t || !t.s.grad) return;
      if (!pal.hidden) { closePal(); return; }
      const st = E.gradStops(t.s.grad);
      pal.innerHTML = '';
      X.buildPalette(pal, st[active] ? st[active].c : '#000000', function (c) {
        setStop(function (x) { x.c = String(c).toUpperCase(); });
        closePal();
      });
      pal.hidden = false;
      const r = anchor.getBoundingClientRect(), w = pal.offsetWidth, h = pal.offsetHeight;
      pal.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      pal.style.top = top + 'px';
    }
    $('grColour').addEventListener('click', function (e) { e.stopPropagation(); openPal(this); });
    document.addEventListener('click', function (e) {
      if (!pal.hidden && !pal.contains(e.target) && !e.target.closest('#grColour, .grstp')) closePal();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pal.hidden) { e.stopPropagation(); closePal(); } }, true);

    /* ---- the slider: add, move and delete stops; move midpoints ---- */
    let slide = null;
    function along(e) {
      const r = $('grBar').getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
    }
    $('grStops').addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      const t = targets();
      if (!t || !t.s.grad) return;
      e.preventDefault();
      const b = e.target.closest('.grstp');
      let k;
      if (b) k = +b.dataset.k;
      else {
        /* a new stop where it was clicked, in the colour the gradient has there */
        const p = Math.round(along(e) * 1e4) / 1e4;
        const here = E.gradColourAt(t.s.grad, p);
        change(function (g) {
          const st = E.gradStops(g);
          const x = { c: here.c, p: p, o: Math.round(here.o * 1000) / 1000 };
          st.push(x);
          g.stops = st;
          resort(g, x);
          return g;
        });
        k = active;
      }
      active = k;
      sync();
      slide = { kind: 'stop', id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, off: false };
      try { this.setPointerCapture(e.pointerId); } catch (err) { /* a mouse works without it */ }
    });
    $('grStops').addEventListener('dblclick', function (e) {
      const b = e.target.closest('.grstp');
      if (b) { active = +b.dataset.k; sync(); openPal($('grColour')); }
    });
    $('grStops').addEventListener('keydown', function (e) {
      const b = e.target.closest('.grstp');
      if (!b) return;
      e.stopPropagation();
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteStop(+b.dataset.k); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        active = +b.dataset.k;
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
        setStop(function (x) { x.p = Math.round(Math.max(0, Math.min(1, x.p + d)) * 1e4) / 1e4; });
        const nb = $('grStops').querySelector('.grstp.on'); if (nb) nb.focus();
      }
    });
    $('grMids').addEventListener('pointerdown', function (e) {
      const m = e.target.closest('.grmid');
      if (!m || e.button !== 0) return;
      e.preventDefault();
      slide = { kind: 'mid', k: +m.dataset.k, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try { this.setPointerCapture(e.pointerId); } catch (err) { /* a mouse works without it */ }
    });
    document.addEventListener('pointermove', function (e) {
      const d = slide;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
      d.moved = true;
      const t = targets();
      if (!t || !t.s.grad) return;
      const p = Math.round(along(e) * 1e4) / 1e4;
      if (d.kind === 'mid') {
        const k = d.k;
        change(function (g) {
          const st = E.gradStops(g);
          const a = st[k], b = st[k + 1];
          if (!a || !b || b.p - a.p < 1e-6) return g;
          const mids = Array.isArray(g.mid) ? g.mid.slice() : [];
          while (mids.length < st.length - 1) mids.push(0.5);
          mids[k] = Math.round(Math.max(0.05, Math.min(0.95, (p - a.p) / (b.p - a.p))) * 1000) / 1000;
          g.mid = mids;
          return g;
        }, true);
        return;
      }
      /* a stop dragged well below the slider goes (as long as two are left) */
      const st0 = E.gradStops(t.s.grad);
      const r = $('grBar').getBoundingClientRect();
      d.off = st0.length > 2 && e.clientY > r.bottom + 28;
      sec.classList.toggle('grdropping', !!d.off);
      if (d.off) return;
      setStopLive(p);
    });
    function setStopLive(p) {
      change(function (g) {
        const st = E.gradStops(g);
        const pick = st[active];
        if (!pick) return g;
        pick.p = p;
        g.stops = st;
        resort(g, pick);
        return g;
      }, true);
    }
    function endSlide(e) {
      const d = slide;
      if (!d || (e && e.pointerId !== d.id)) return;
      slide = null;
      sec.classList.remove('grdropping');
      const t = targets();
      if (d.off) { release(null); deleteStop(active); return; }
      release(t);
      const b = $('grStops').querySelector('.grstp.on');
      if (b && d.kind === 'stop') b.focus({ preventScroll: true });
    }
    document.addEventListener('pointerup', endSlide);
    document.addEventListener('pointercancel', endSlide);

    /* ---------------- the Gradient tool ---------------- */

    let tool = false;
    let drag = null;

    function pdfAt(it, e) {
      const r = it.anno.getBoundingClientRect();
      return it.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    }
    function viewAt(it, e) {
      const r = it.anno.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    /* the annotator's parts on screen, for the shape the panel reads */
    function parts(t) {
      const s = t.s, g = s.grad;
      if (!g) return null;
      const ends = E.gradEnds(s, g), vp = t.it.vp;
      const a = vp.convertToViewportPoint(ends[0][0], ends[0][1]);
      const b = vp.convertToViewportPoint(ends[1][0], ends[1][1]);
      const st = E.gradStops(g).map(function (x) { return [a[0] + (b[0] - a[0]) * x.p, a[1] + (b[1] - a[1]) * x.p, x]; });
      return { a: a, b: b, ends: ends, st: st };
    }
    function paint(it) {
      if (!tool || !it.anno) return;
      const t = targets();
      if (!t || t.it !== it) return;
      const P = parts(t);
      if (!P) return;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'grann');
      const a = P.a, b = P.b;
      let h = '';
      if (t.s.grad.k === 'radial') {
        h += '<circle class="grring" cx="' + a[0] + '" cy="' + a[1] + '" r="' + Math.hypot(b[0] - a[0], b[1] - a[1]) + '"/>';
      }
      h += '<line class="grhalo" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>' +
        '<line class="grline" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>';
      P.st.forEach(function (q, k) {
        h += '<circle class="grknot' + (k === active ? ' on' : '') + '" cx="' + q[0] + '" cy="' + q[1] + '" r="4.5" style="fill:' + q[2].c + '"/>';
      });
      h += '<circle class="grstart" cx="' + a[0] + '" cy="' + a[1] + '" r="5.5"/>' +
        '<rect class="grend" x="' + (b[0] - 4.5) + '" y="' + (b[1] - 4.5) + '" width="9" height="9"/>';
      g.innerHTML = h;
      it.anno.appendChild(g);
    }
    X.afterDraw.push(paint);

    /** What is under the pointer: the end square, the start circle, a stop, or nothing. */
    function hitAt(t, v) {
      const P = parts(t);
      if (!P) return null;
      const near = function (q) { return Math.hypot(v[0] - q[0], v[1] - q[1]) <= HIT; };
      if (near(P.b)) return { k: 'end' };
      if (near(P.a)) return { k: 'start' };
      for (let i = P.st.length - 1; i >= 0; i--) if (near(P.st[i])) return { k: 'stop', i: i };
      return null;
    }

    stage.addEventListener('pointerdown', function (e) {
      if (!tool || e.button !== 0 || e.ctrlKey || e.metaKey || S.editing) return;
      const tg = e.target;
      if (tg.closest && tg.closest('input, textarea, select, button, a, .markpop')) return;
      const t = targets();
      if (!t || !t.it.anno || !t.it.vp) return;          /* nothing to fill: a click selects, as Select does */
      const r = t.it.anno.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const v = viewAt(t.it, e);
      const hit = t.s.grad ? hitAt(t, v) : null;
      if (!hit) {
        /* a press on another mark picks that one, as Select would */
        let top = tg;
        while (top && top.parentNode && top.parentNode !== t.it.anno) top = top.parentNode;
        const i = top && top.parentNode === t.it.anno ? Array.prototype.indexOf.call(t.it.anno.children, top) : -1;
        if (i >= 0 && i < t.it.shapes.length && t.idx.indexOf(i) < 0) return;
      }
      if (hit && hit.k === 'stop') { active = hit.i; sync(); }
      drag = {
        t: t, hit: hit, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false,
        from: pdfAt(t.it, e), g0: t.s.grad ? copyGrad(t.s.grad) : null,
        ends0: t.s.grad ? E.gradEnds(t.s, t.s.grad) : null
      };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a mouse works without it */ }
    }, true);

    document.addEventListener('pointermove', function (e) {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
      d.moved = true;
      const t = d.t, s = t.s, p = pdfAt(t.it, e);
      let g;
      if (d.hit && d.hit.k === 'start') {
        /* the whole vector moves */
        const dx = p[0] - d.from[0], dy = p[1] - d.from[1];
        g = copyGrad(d.g0);
        g.g1 = E.gradFrac(s, [d.ends0[0][0] + dx, d.ends0[0][1] + dy]);
        g.g2 = E.gradFrac(s, [d.ends0[1][0] + dx, d.ends0[1][1] + dy]);
      } else if (d.hit && d.hit.k === 'end') {
        g = copyGrad(d.g0);
        g.g2 = E.gradFrac(s, snapEnd(d.ends0[0], p, e.shiftKey));
      } else if (d.hit && d.hit.k === 'stop') {
        /* the stop slides along the vector, to where the pointer is across from */
        const a = d.ends0[0], b = d.ends0[1];
        const L2 = (b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]) || 1;
        const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2));
        setStopLive(Math.round(f * 1e4) / 1e4);
        showHud(e, 'Location: ' + Math.round(f * 100) + '%');
        return;
      } else {
        /* a new vector, from where the drag began to where it is */
        g = d.g0 ? copyGrad(d.g0) : E.defaultGrad('linear');
        const end = snapEnd(d.from, p, e.shiftKey);
        g.g1 = E.gradFrac(s, d.from);
        g.g2 = E.gradFrac(s, end);
      }
      hold();
      t.idx.forEach(function (i) {
        const m = t.it.shapes[i];
        if (i === t.i) put(m, g);
        else if (!d.hit) {
          /* every shape selected takes the same drag, as Illustrator lays one gradient across them */
          const gm = forMark(m, g);
          gm.g1 = E.gradFrac(m, d.from);
          gm.g2 = E.gradFrac(m, snapEnd(d.from, p, e.shiftKey));
          put(m, gm);
        }
      });
      let ang = E.gradAngle(s, g);
      if (ang <= -180) ang += 360;
      showHud(e, 'Angle: ' + r1(ang) + '°');
      redraw(t);
    });
    function snapEnd(a, p, shift) {
      if (!shift) return p;
      const L = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const ang = Math.round(Math.atan2(p[1] - a[1], p[0] - a[0]) * 180 / Math.PI / SNAP) * SNAP * Math.PI / 180;
      return [a[0] + L * Math.cos(ang), a[1] + L * Math.sin(ang)];
    }
    function endDrag(e, cancel) {
      const d = drag;
      if (!d || (e && e.pointerId !== d.id)) return;
      drag = null;
      hideHud();
      const t = d.t;
      if (cancel && d.moved && held) { held = false; X.undo(); return; }
      if (!d.moved && !d.g0) {
        /* a click on a shape with no gradient gives it one */
        change(function () { return E.defaultGrad('linear'); });
        return;
      }
      release(d.moved ? t : null);
      X.drawShapes(t.it);
      X.syncMarkPop();
      sync();
    }
    document.addEventListener('pointerup', function (e) { endDrag(e, false); });
    document.addEventListener('pointercancel', function (e) { endDrag(e, true); });

    let hud = null;
    function showHud(e, text) {
      if (!hud) { hud = document.createElement('div'); hud.className = 'movehud'; document.body.appendChild(hud); }
      hud.textContent = text;
      hud.style.left = (e.clientX + 16) + 'px';
      hud.style.top = (e.clientY + 16) + 'px';
      hud.hidden = false;
    }
    function hideHud() { if (hud) hud.hidden = true; }

    /* the pointer: a move over the start circle, the plain gradient pointer elsewhere */
    document.addEventListener('pointermove', function (e) {
      if (!tool || drag) return;
      const t = targets();
      let q = '';
      if (t && t.it.anno && t.s.grad) {
        const h = hitAt(t, viewAt(t.it, e));
        q = h ? h.k : '';
      }
      if (document.body.dataset.grq !== q) document.body.dataset.grq = q;
    });

    /* ---------------- picking it up and putting it down ---------------- */

    const btn = document.createElement('button');
    btn.className = 'btn'; btn.id = 'tGradient'; btn.type = 'button';
    btn.title = 'Gradient (G)'; btn.setAttribute('aria-label', 'Gradient');
    btn.dataset.label = 'Gradient';
    btn.innerHTML = '<svg viewBox="0 0 24 24">' + ICON.tool + '</svg>';
    if ($('grpTools')) $('grpTools').appendChild(btn);

    function paintBtns() {
      document.querySelectorAll('#tGradient, #qtGradient').forEach(function (b) {
        b.classList.toggle('on', tool);
        b.setAttribute('aria-pressed', tool ? 'true' : 'false');
      });
      document.body.classList.toggle('gradient-mode', tool);
      if ($('grEdit')) $('grEdit').classList.toggle('on', tool);
    }
    function setOn(v) {
      if (v === tool) return;
      if (v) {
        if (X.rotateTool && X.rotateTool.on()) X.rotateTool.set(false);
        /* keep what is selected across the change to Select (setTool drops it) */
        const keep = S.sel ? { sel: S.sel, multi: S.multi } : null;
        if (S.tool !== 'select') X.setTool('select');
        if (keep && !S.sel) { S.sel = keep.sel; S.multi = keep.multi; }
        tool = true;
        X.emit('modetool', 'gradient');
        if (!targets()) X.toast('Select a closed shape (a box, circle, cloud or closed path), then drag across it to lay a gradient');
      } else {
        tool = false;
        drag = null; hideHud();
        delete document.body.dataset.grq;
      }
      paintBtns();
      X.redrawAll();
      X.syncMarkPop();
      sync();
    }
    X.gradientTool = { on: function () { return tool; }, set: setOn };
    btn.addEventListener('click', function () { setOn(!tool); });
    X.on('tool', function () { if (tool) setOn(false); });
    /* the Rotate tool and this one: picking up one puts the other down */
    X.on('modetool', function (which) { if (which !== 'gradient' && tool) setOn(false); });

    /* G picks it up with a closed shape selected (with none, core's G still
       does what it did); Esc or V puts it down. Ahead of core's own keys. */
    window.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select,[contenteditable],[contenteditable] *')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !S.items.length || S.editing) return;
      if ((e.key === 'g' || e.key === 'G') && !e.shiftKey && targets()) {
        e.preventDefault(); e.stopImmediatePropagation();
        setOn(!tool);
      } else if (tool && (e.key === 'Escape' || e.key === 'v')) {
        e.preventDefault(); e.stopImmediatePropagation();
        setOn(false);
      }
    }, true);

    if (window.MutationObserver) new MutationObserver(sync).observe(pop, { attributes: true, attributeFilter: ['hidden'] });
    paintBtns();
    sync();
  });
})();
