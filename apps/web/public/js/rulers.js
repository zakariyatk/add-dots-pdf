/* Add Dots PDF — rulers and guides, as Photoshop and Illustrator have them.

   Rulers: a strip along the top and the left of the page area, measuring the
   page in view (the one under the pointer, else the current one) from its
   top-left corner, in mm, cm, inches or points. The pointer's place shows
   on both. Ctrl+R (Cmd+R) or View > Rulers turns them on and off.

   The zero point: drag from the corner square where the rulers meet to put
   it anywhere on the page; double-click the corner to put it back.

   Guides: drag out of the top ruler for a horizontal guide, out of the left
   one for a vertical guide, and let go over a page. Drag a guide to move it,
   or back onto a ruler to remove it. They belong to their page, are kept as
   a share of its width or height so they follow the zoom, and are only an
   aid on screen: nothing of them goes into the saved PDF.

   The rulers sit in a border the page area gives itself while they are on,
   so they never cover the page. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[rulers] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const stage = $('stage');
    const SIZE = 18;   /* the rulers' thickness, as css/pro.css gives the border */

    /* one point in each unit; a page's size in points is its size on screen
       over the zoom, as pdf.js draws a point as one CSS pixel at 100% */
    const UNITS = {
      mm: { per: 25.4 / 72, name: 'Millimetres' },
      cm: { per: 2.54 / 72, name: 'Centimetres' },
      in: { per: 1 / 72, name: 'Inches' },
      pt: { per: 1, name: 'Points' }
    };

    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } }

    let on = get('adpdf.rulers') === '1';
    let unit = UNITS[get('adpdf.rulerUnit')] ? get('adpdf.rulerUnit') : 'mm';
    /* the zero point, in points from the page's top-left corner */
    let zero = { x: 0, y: 0 };
    let pointer = null;   /* the last pointer position over the page area */

    /* ---------------- the strips ---------------- */

    const top = document.createElement('canvas');
    top.className = 'ruler rtop';
    const left = document.createElement('canvas');
    left.className = 'ruler rleft';
    const corner = document.createElement('button');
    corner.type = 'button';
    corner.className = 'rcorner';
    corner.title = 'Units and guides. Drag to move the zero point; double-click to put it back.';
    corner.setAttribute('aria-label', 'Ruler units and guides');
    [top, left, corner].forEach(function (el) { el.hidden = true; document.body.appendChild(el); });
    top.setAttribute('aria-hidden', 'true');
    left.setAttribute('aria-hidden', 'true');

    /* the line that follows a guide being dragged, across the page area */
    const ghost = document.createElement('div');
    ghost.className = 'rghost';
    ghost.hidden = true;
    document.body.appendChild(ghost);

    /* ---------------- the page measured ---------------- */

    function pageRect(it) {
      const el = it.wrap && it.wrap.isConnected ? it.wrap : it.box;
      return el && el.isConnected ? el.getBoundingClientRect() : null;
    }
    /* only where the page area shows: a zoomed page runs on under the panels */
    function inView(x, y) {
      const r = stage.getBoundingClientRect();
      return x >= r.left + stage.clientLeft && x <= r.left + stage.clientLeft + stage.clientWidth &&
             y >= r.top + stage.clientTop && y <= r.top + stage.clientTop + stage.clientHeight;
    }
    function pageAt(x, y) {
      if (!inView(x, y)) return null;
      for (let i = 0; i < S.items.length; i++) {
        const it = S.items[i], r = it.wrap && it.wrap.isConnected ? it.wrap.getBoundingClientRect() : null;
        if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return it;
      }
      return null;
    }
    function measured() {
      let it = pointer ? pageAt(pointer.x, pointer.y) : null;
      if (!it) it = S.items[S.current - 1];
      const r = it && pageRect(it);
      return r && r.width ? { it: it, r: r } : null;
    }

    /* ---------------- drawing ---------------- */

    /* the spacing of the numbered marks: a round number of units at least
       this many CSS pixels apart */
    const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    function stepFor(pxPerUnit) {
      for (let i = 0; i < STEPS.length; i++) if (STEPS[i] * pxPerUnit >= 56) return STEPS[i];
      return STEPS[STEPS.length - 1];
    }
    function label(v) {
      const r = Math.round(v * 100) / 100;
      return String(Object.is(r, -0) ? 0 : r);
    }

    function paint(cv, len, horiz, origin, pxPerUnit, mark) {
      const dpr = window.devicePixelRatio || 1;
      const w = horiz ? len : SIZE, h = horiz ? SIZE : len;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const ctx = cv.getContext('2d');
      const cs = getComputedStyle(document.body);
      const bg = cs.getPropertyValue('--chrome').trim() || '#fff';
      const ink = cs.getPropertyValue('--text-dim').trim() || '#666';
      const line = cs.getPropertyValue('--line').trim() || '#ccc';
      const accent = cs.getPropertyValue('--marker').trim() || '#7B5CFF';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = line;
      if (horiz) ctx.fillRect(0, h - 1, w, 1); else ctx.fillRect(w - 1, 0, 1, h);
      if (!pxPerUnit) return;

      const step = stepFor(pxPerUnit);
      /* ten small marks to a numbered one where they fit, else five or two */
      let subs = 10;
      if (step * pxPerUnit / subs < 5) subs = 5;
      if (step * pxPerUnit / subs < 5) subs = 2;
      const minor = step / subs;
      const first = Math.floor(-origin / pxPerUnit / minor) * minor;
      const last = (len - origin) / pxPerUnit;
      ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1;
      ctx.font = '9px ' + (cs.getPropertyValue('--sans').trim() || 'sans-serif');
      ctx.textBaseline = 'top';
      ctx.beginPath();
      for (let k = 0, v = first; v <= last + minor && k < 4000; k++, v = first + k * minor) {
        const p = Math.round(origin + v * pxPerUnit) + 0.5;
        const n = Math.round(v / minor);
        const major = n % subs === 0;
        const half = !major && subs === 10 && n % 5 === 0;
        const tick = major ? SIZE - 1 : half ? 7 : 4;
        if (horiz) { ctx.moveTo(p, SIZE - 1); ctx.lineTo(p, SIZE - 1 - tick); }
        else { ctx.moveTo(SIZE - 1, p); ctx.lineTo(SIZE - 1 - tick, p); }
        if (major) {
          const t = label(v);
          if (horiz) ctx.fillText(t, p + 2.5, 2);
          else {
            ctx.save(); ctx.translate(2, p + 2.5); ctx.rotate(Math.PI / 2);
            ctx.fillText(t, 0, -9); ctx.restore();
          }
        }
      }
      ctx.stroke();
      /* where the pointer is */
      if (mark != null && mark >= 0 && mark <= len) {
        ctx.fillStyle = accent;
        if (horiz) ctx.fillRect(Math.round(mark), 0, 1, h - 1); else ctx.fillRect(0, Math.round(mark), w - 1, 1);
      }
    }

    let raf = 0;
    function redraw() {
      if (!on || raf) return;
      raf = requestAnimationFrame(function () { raf = 0; draw(); });
    }
    function draw() {
      const r = stage.getBoundingClientRect();
      const visible = on && stage.offsetParent !== null && r.width > SIZE && S.items.length > 0;
      [top, left, corner].forEach(function (el) { el.hidden = !visible; });
      if (!visible) return;
      /* the border the page area gives itself (pro.css), the scroll bars left out */
      const x0 = r.left + stage.clientLeft, y0 = r.top + stage.clientTop;
      corner.style.left = (x0 - SIZE) + 'px'; corner.style.top = (y0 - SIZE) + 'px';
      top.style.left = x0 + 'px'; top.style.top = (y0 - SIZE) + 'px';
      left.style.left = (x0 - SIZE) + 'px'; left.style.top = y0 + 'px';

      const m = measured();
      const scale = S.scale || 1, per = UNITS[unit].per;
      const pxPerUnit = m ? scale / per : 0;
      const ox = m ? m.r.left + zero.x * scale - x0 : 0;
      const oy = m ? m.r.top + zero.y * scale - y0 : 0;
      paint(top, stage.clientWidth, true, ox, pxPerUnit, pointer ? pointer.x - x0 : null);
      paint(left, stage.clientHeight, false, oy, pxPerUnit, pointer ? pointer.y - y0 : null);
      corner.textContent = unit;
    }

    /* ---------------- guides ---------------- */

    /* it.guides: [{ v: true for vertical, at: 0..1 across the page }] */
    function layer(it) {
      if (!it.wrap) return null;
      let g = it.guideLayer;
      if (!g) {
        g = it.guideLayer = document.createElement('div');
        g.className = 'guides';
        it.wrap.appendChild(g);
      }
      return g;
    }
    function paintGuides(it) {
      const g = layer(it);
      if (!g) return;
      g.textContent = '';
      (it.guides || []).forEach(function (gd) {
        const el = document.createElement('div');
        el.className = 'guide ' + (gd.v ? 'gv' : 'gh');
        if (gd.v) el.style.left = (gd.at * 100) + '%'; else el.style.top = (gd.at * 100) + '%';
        el.title = 'Guide: drag to move, or onto a ruler to remove';
        el.addEventListener('pointerdown', function (e) { moveGuide(e, it, gd); });
        g.appendChild(el);
      });
    }
    function paintAllGuides() { S.items.forEach(function (it) { if (it.guides && it.guides.length) paintGuides(it); }); }

    function onRuler(x, y) {
      const a = top.getBoundingClientRect(), b = left.getBoundingClientRect();
      return (y >= a.top && y <= a.bottom && x >= a.left - SIZE && x <= a.right) ||
             (x >= b.left && x <= b.right && y >= b.top - SIZE && y <= b.bottom);
    }
    function showGhost(v, x, y) {
      const r = stage.getBoundingClientRect();
      ghost.hidden = false;
      ghost.className = 'rghost ' + (v ? 'gv' : 'gh');
      if (v) { ghost.style.left = x + 'px'; ghost.style.top = r.top + 'px'; ghost.style.height = r.height + 'px'; ghost.style.width = ''; }
      else { ghost.style.top = y + 'px'; ghost.style.left = r.left + 'px'; ghost.style.width = r.width + 'px'; ghost.style.height = ''; }
    }

    /* one drag for a new guide and a moved one: let go over a page to place
       it there, anywhere else to drop it */
    function dragGuide(e, v, from) {
      e.preventDefault(); e.stopPropagation();
      const id = e.pointerId;
      try { e.target.setPointerCapture(id); } catch (err) { /* fine without */ }
      document.body.classList.add('rdrag', v ? 'rdrag-v' : 'rdrag-h');
      showGhost(v, e.clientX, e.clientY);
      function mv(ev) {
        if (ev.pointerId !== id) return;
        pointer = { x: ev.clientX, y: ev.clientY };
        showGhost(v, ev.clientX, ev.clientY);
        redraw();
      }
      function up(ev) {
        if (ev.pointerId !== id) return;
        window.removeEventListener('pointermove', mv, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        document.body.classList.remove('rdrag', 'rdrag-v', 'rdrag-h');
        ghost.hidden = true;
        if (from) {
          from.it.guides = from.it.guides.filter(function (g) { return g !== from.gd; });
          paintGuides(from.it);
        }
        if (ev.type === 'pointercancel' || onRuler(ev.clientX, ev.clientY)) return;
        const it = pageAt(ev.clientX, ev.clientY);
        if (!it) return;
        const r = it.wrap.getBoundingClientRect();
        const at = v ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        (it.guides || (it.guides = [])).push({ v: v, at: Math.max(0, Math.min(1, at)) });
        paintGuides(it);
      }
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    }
    function moveGuide(e, it, gd) {
      if (e.button !== 0) return;
      /* the guide is lifted off its page while it moves */
      e.currentTarget.hidden = true;
      dragGuide(e, gd.v, { it: it, gd: gd });
    }
    top.addEventListener('pointerdown', function (e) { if (e.button === 0) dragGuide(e, false, null); });
    left.addEventListener('pointerdown', function (e) { if (e.button === 0) dragGuide(e, true, null); });

    /* ---------------- the zero point ---------------- */

    corner.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      const id = e.pointerId, sx = e.clientX, sy = e.clientY;
      let moved = false;
      try { corner.setPointerCapture(id); } catch (err) { /* fine without */ }
      function mv(ev) {
        if (ev.pointerId !== id) return;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        document.body.classList.add('rdrag', 'rdrag-zero');
        pointer = { x: ev.clientX, y: ev.clientY };
        showGhost(true, ev.clientX, ev.clientY);
        redraw();
      }
      function up(ev) {
        if (ev.pointerId !== id) return;
        corner.removeEventListener('pointermove', mv);
        corner.removeEventListener('pointerup', up);
        corner.removeEventListener('pointercancel', up);
        document.body.classList.remove('rdrag', 'rdrag-zero');
        ghost.hidden = true;
        if (!moved) { openMenu(); return; }
        const it = pageAt(ev.clientX, ev.clientY);
        if (it && ev.type !== 'pointercancel') {
          const r = it.wrap.getBoundingClientRect(), s = S.scale || 1;
          zero = { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s };
          if (X.grid) X.grid.paint();
        }
        redraw();
      }
      corner.addEventListener('pointermove', mv);
      corner.addEventListener('pointerup', up);
      corner.addEventListener('pointercancel', up);
    });
    /* from the keyboard (Enter or Space), the corner opens its menu */
    corner.addEventListener('click', function (e) { if (e.detail === 0) openMenu(); });
    corner.addEventListener('dblclick', function () { zero = { x: 0, y: 0 }; closeMenu(); redraw(); if (X.grid) X.grid.paint(); });

    /* ---------------- the corner's menu: units, and clearing guides ---------------- */

    let menu = null;
    function closeMenu() {
      if (!menu) return;
      menu.remove(); menu = null;
      corner.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      if (menu) { closeMenu(); return; }
      menu = document.createElement('div');
      menu.className = 'rmenu';
      menu.setAttribute('role', 'menu');
      function item(text, act, checked) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', checked == null ? 'menuitem' : 'menuitemradio');
        if (checked != null) b.setAttribute('aria-checked', checked ? 'true' : 'false');
        b.textContent = text;
        b.addEventListener('click', function () { closeMenu(); act(); });
        menu.appendChild(b);
        return b;
      }
      Object.keys(UNITS).forEach(function (k) {
        item(UNITS[k].name, function () { X.rulers.setUnit(k); }, k === unit);
      });
      menu.appendChild(document.createElement('hr'));
      item('Reset zero point', function () { zero = { x: 0, y: 0 }; redraw(); if (X.grid) X.grid.paint(); });
      const m = measured();
      const here = m && m.it.guides && m.it.guides.length;
      item('Clear guides on this page', function () { m.it.guides = []; paintGuides(m.it); }).disabled = !here;
      const any = S.items.some(function (it) { return it.guides && it.guides.length; });
      item('Clear all guides', function () {
        S.items.forEach(function (it) { if (it.guides && it.guides.length) { it.guides = []; paintGuides(it); } });
      }).disabled = !any;
      menu.appendChild(document.createElement('hr'));
      item('Show grid (Ctrl+\')', function () { showGrid(); }, grid.show);
      item('Snap to grid (Ctrl+Shift+\')', function () { snapGrid(); }, grid.snap);
      item('Grid spacing…', askGrid);
      item('Hide rulers (Ctrl+R)', function () { toggle(false); });
      document.body.appendChild(menu);
      const r = corner.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.top = (r.bottom + 2) + 'px';
      corner.setAttribute('aria-expanded', 'true');
      const firstOn = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
      if (firstOn) firstOn.focus();
    }
    corner.setAttribute('aria-haspopup', 'menu');
    corner.setAttribute('aria-expanded', 'false');
    document.addEventListener('pointerdown', function (e) {
      if (menu && !menu.contains(e.target) && e.target !== corner) closeMenu();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (!menu) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); corner.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = Array.prototype.filter.call(menu.querySelectorAll('button'), function (b) { return !b.disabled; });
        const i = list.indexOf(document.activeElement);
        const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[n].focus();
      }
    }, true);
    top.addEventListener('contextmenu', function (e) { e.preventDefault(); openMenu(); });
    left.addEventListener('contextmenu', function (e) { e.preventDefault(); openMenu(); });

    /* ---------------- on and off ---------------- */

    const b = document.createElement('button');
    b.className = 'btn';
    b.id = 'btnRulers';
    b.title = 'Rulers and guides (Ctrl+R): drag a guide out of a ruler';
    b.setAttribute('aria-label', 'Rulers');
    b.setAttribute('aria-pressed', 'false');
    b.dataset.label = 'Rulers';
    b.innerHTML =
      '<svg viewBox="0 0 24 24">' +
      /* an L-square with its marks */
      '<path d="M3 3h5v13h13v5H3z"/>' +
      '<line x1="3" y1="7" x2="5.5" y2="7"/><line x1="3" y1="11" x2="5.5" y2="11"/>' +
      '<line x1="12" y1="21" x2="12" y2="18.5"/><line x1="16" y1="21" x2="16" y2="18.5"/>' +
      '</svg><span class="lbl">Rulers</span>';
    $('grpZoom').appendChild(b);
    b.addEventListener('click', function () { toggle(); });

    function toggle(want) {
      on = want == null ? !on : !!want;
      set('adpdf.rulers', on ? '1' : '0');
      apply();
      /* the page area just grew or lost its border: fit the page to it again */
      if (S.items.length) X.relayout();
    }
    function apply() {
      document.body.classList.toggle('rulers-on', on);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!on) closeMenu();
      if (on) paintAllGuides();
      draw();
    }

    /* Ctrl+R, as in Photoshop and Illustrator, rather than the browser's reload */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'r') return;
      if (!S.items.length) return;
      e.preventDefault();
      toggle();
    });

    /* ---------------- keeping up ---------------- */

    stage.addEventListener('scroll', redraw, { passive: true });
    window.addEventListener('resize', redraw);
    document.addEventListener('pointermove', function (e) {
      if (!on) return;
      const r = stage.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      pointer = inside ? { x: e.clientX, y: e.clientY } : null;
      redraw();
    }, { passive: true });
    /* a zoom resizes the pages, and the rail or a panel opening moves the page area */
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(redraw);
      ro.observe(stage);
      let watched = null;
      setInterval(function () {
        if (!on) return;
        const it = S.items[S.current - 1];
        const w = it && it.wrap;
        if (w && w !== watched) { if (watched) ro.unobserve(watched); ro.observe(w); watched = w; }
      }, 500);
    }
    X.on('pages', function () { paintAllGuides(); redraw(); });
    X.on('reset', function () { zero = { x: 0, y: 0 }; pointer = null; closeMenu(); redraw(); });

    /* ---------------- the grid ----------------
       As Illustrator's: a gridline every so many units with lighter
       subdivisions between, from the ruler's zero point, behind the marks.
       View > Grid (Ctrl+') shows it; Snap to Grid (Ctrl+Shift+') makes
       points and moved objects land on it (js/draw.js snapPt), whether it
       shows or not. Only an aid on screen: nothing of it is saved. */
    const GRID_DEFAULT = { mm: [10, 5], cm: [1, 5], in: [1, 8], pt: [72, 8] };
    const grid = {
      show: get('adpdf.grid') === '1',
      snap: get('adpdf.gridSnap') === '1',
      every: null,          /* in the ruler's unit; null: that unit's default */
      sub: null
    };
    try {
      const g = JSON.parse(get('adpdf.gridStep') || 'null');
      if (g && g.unit && isFinite(g.every) && g.every > 0) { grid.every = g; }
    } catch (e) { /* the default */ }
    /** the gridline spacing and the subdivision's, in points */
    function gridStep() {
      const g = grid.every && grid.every.unit && UNITS[grid.every.unit] ? grid.every : null;
      const every = g ? g.every / UNITS[g.unit].per : GRID_DEFAULT[unit][0] / UNITS[unit].per;
      const sub = Math.max(1, Math.round(g ? g.sub : GRID_DEFAULT[unit][1]));
      return { every: every, sub: sub, fine: every / sub };
    }
    function gridLayer(it) {
      if (!it.wrap) return null;
      let g = it.gridLayer;
      if (!g || g.parentNode !== it.wrap) {
        g = it.gridLayer = document.createElement('div');
        g.className = 'pagegrid';
        g.setAttribute('aria-hidden', 'true');
        it.wrap.insertBefore(g, it.wrap.firstChild);
      }
      return g;
    }
    function paintGrid(it) {
      const g = gridLayer(it);
      if (!g) return;
      g.hidden = !grid.show;
      if (!grid.show) return;
      const st = gridStep(), k = S.scale || 1;
      const big = st.every * k, fine = st.fine * k;
      const ox = zero.x * k, oy = zero.y * k;
      const line = 'rgba(0, 140, 220, .42)', thin = 'rgba(0, 140, 220, .16)';
      const L = [
        'linear-gradient(to right, ' + line + ' 1px, transparent 1px)',
        'linear-gradient(to bottom, ' + line + ' 1px, transparent 1px)'
      ];
      const sizes = [big + 'px ' + big + 'px', big + 'px ' + big + 'px'];
      const pos = [ox + 'px ' + oy + 'px', ox + 'px ' + oy + 'px'];
      /* the subdivisions, when they would not crowd into a tint */
      if (st.sub > 1 && fine >= 5) {
        L.push('linear-gradient(to right, ' + thin + ' 1px, transparent 1px)', 'linear-gradient(to bottom, ' + thin + ' 1px, transparent 1px)');
        sizes.push(fine + 'px ' + fine + 'px', fine + 'px ' + fine + 'px');
        pos.push(ox + 'px ' + oy + 'px', ox + 'px ' + oy + 'px');
      }
      g.style.backgroundImage = L.join(', ');
      g.style.backgroundSize = sizes.join(', ');
      g.style.backgroundPosition = pos.join(', ');
    }
    function paintAllGrids() { S.items.forEach(paintGrid); }
    /** p (page points) on the nearest grid crossing, or on the gridline
        near it on one axis, as the page is seen; null when snapping to the
        grid is off or nothing is within tol (points) */
    function gridSnap(it, p, tol) {
      if (!grid.snap || !it || !it.vp) return null;
      const st = gridStep(), k = it.vp.scale || 1;
      const v = it.vp.convertToViewportPoint(p[0], p[1]);
      const fx = v[0] / k - zero.x, fy = v[1] / k - zero.y;    /* points from the zero point */
      const gx = Math.round(fx / st.fine) * st.fine, gy = Math.round(fy / st.fine) * st.fine;
      const okx = Math.abs(gx - fx) <= tol, oky = Math.abs(gy - fy) <= tol;
      if (!okx && !oky) return null;
      const q = it.vp.convertToPdfPoint(((okx ? gx : fx) + zero.x) * k, ((oky ? gy : fy) + zero.y) * k);
      const r6 = function (n) { return Math.round(n * 1e6) / 1e6; };
      return { p: [r6(q[0]), r6(q[1])], both: okx && oky };
    }
    function showGrid(want) {
      grid.show = want == null ? !grid.show : !!want;
      set('adpdf.grid', grid.show ? '1' : '0');
      paintAllGrids(); paintGridBtns();
      X.toast(grid.show ? 'Grid shown (Ctrl+\')' : 'Grid hidden', true);
    }
    function snapGrid(want) {
      grid.snap = want == null ? !grid.snap : !!want;
      set('adpdf.gridSnap', grid.snap ? '1' : '0');
      paintGridBtns();
      X.toast(grid.snap ? 'Snap to Grid on (Ctrl+Shift+\')' : 'Snap to Grid off', true);
    }
    async function askGrid() {
      const st = gridStep(), per = UNITS[unit].per;
      const r6 = function (n) { return Math.round(n * 1e4) / 1e4; };
      const v = await X.dialog({
        title: 'Grid',
        ok: 'OK',
        width: 360,
        body: '<div class="mvgrid">' +
          '<label class="mvf"><span>Gridline every</span><span class="unit"><input id="grEvery" inputmode="decimal" value="' + r6(st.every * per) + '"><em>' + unit + '</em></span></label>' +
          '<label class="mvf"><span>Subdivisions</span><input id="grSub" inputmode="numeric" value="' + st.sub + '"></label>' +
          '<label class="mvck"><input type="checkbox" id="grShow"' + (grid.show ? ' checked' : '') + '> Show grid</label>' +
          '<label class="mvck"><input type="checkbox" id="grSnap"' + (grid.snap ? ' checked' : '') + '> Snap to grid</label>' +
          '</div>',
        value: function (box) {
          const every = parseFloat(String(box.querySelector('#grEvery').value).replace(',', '.'));
          const sub = parseInt(box.querySelector('#grSub').value, 10);
          if (!(every > 0)) return { error: 'Give the spacing as a number above 0', field: '#grEvery' };
          if (!(sub >= 1 && sub <= 100)) return { error: 'Subdivisions: a whole number from 1 to 100', field: '#grSub' };
          return { every: every, sub: sub, show: box.querySelector('#grShow').checked, snap: box.querySelector('#grSnap').checked };
        }
      });
      if (!v) return;
      grid.every = { unit: unit, every: v.every, sub: v.sub };
      set('adpdf.gridStep', JSON.stringify(grid.every));
      grid.show = v.show; grid.snap = v.snap;
      set('adpdf.grid', grid.show ? '1' : '0'); set('adpdf.gridSnap', grid.snap ? '1' : '0');
      paintAllGrids(); paintGridBtns();
    }
    function paintGridBtns() {
      [['btnGrid', grid.show], ['btnGridSnap', grid.snap]].forEach(function (q) {
        const el = $(q[0]);
        if (!el) return;
        el.classList.toggle('on', q[1]);
        el.setAttribute('aria-pressed', q[1] ? 'true' : 'false');
      });
    }
    /* View: next to the pasteboard, as Illustrator's View menu has them */
    (function () {
      const after = $('btnBoard');
      if (!after) return;
      const mk = function (id, label, title, svg, act) {
        const b = document.createElement('button');
        b.className = 'btn'; b.id = id; b.type = 'button';
        b.title = title; b.setAttribute('aria-label', label); b.dataset.label = label;
        b.setAttribute('aria-pressed', 'false');
        b.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg><span class="lbl">' + label + '</span>';
        b.addEventListener('click', act);
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); askGrid(); });
        return b;
      };
      const snapB = mk('btnGridSnap', 'Snap to Grid', 'Snap to Grid (Ctrl+Shift+\'): points and moved objects land on the grid. Right-click for the spacing',
        '<path d="M4 4v16M10 4v16M16 4v4M4 4h16M4 10h12M4 16h6"/><path d="M14 13l6 2-3 1-1 3z"/>', function () { snapGrid(); });
      const showB = mk('btnGrid', 'Grid', 'Grid (Ctrl+\'): gridlines behind the marks, from the ruler\'s zero point. Right-click for the spacing',
        '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>', function () { showGrid(); });
      after.parentNode.insertBefore(snapB, after.nextSibling);
      after.parentNode.insertBefore(showB, after.nextSibling);
      paintGridBtns();
    })();
    /* Ctrl+' and Ctrl+Shift+', as in Illustrator (the key reads " with Shift on most layouts) */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.code !== 'Quote' && e.key !== "'" && e.key !== '"') return;
      if (!S.items.length || (e.target.matches && e.target.matches('input,textarea,select'))) return;
      e.preventDefault();
      if (e.shiftKey) snapGrid(); else showGrid();
    });
    X.on('pages', paintAllGrids);
    X.on('layout', function () { if (grid.show) paintAllGrids(); });
    X.grid = {
      shown: function () { return grid.show; },
      snapping: function () { return grid.snap; },
      show: showGrid, setSnap: snapGrid, settings: askGrid,
      step: gridStep, snap: gridSnap, paint: paintAllGrids
    };

    X.rulers = {
      on: function () { return on; },
      toggle: toggle,
      unit: function () { return unit; },
      per: function () { return UNITS[unit].per; },
      /* the zero point, in points from the page's top-left corner as seen */
      zero: function () { return { x: zero.x, y: zero.y }; },
      units: function () { return Object.keys(UNITS).map(function (k) { return { id: k, name: UNITS[k].name }; }); },
      setUnit: function (k) {
        if (!UNITS[k]) return;
        unit = k; set('adpdf.rulerUnit', k); redraw();
        if (X.grid) X.grid.paint();
        X.emit('units', k);
      },
      clearGuides: function (it) {
        (it ? [it] : S.items).forEach(function (p) { if (p.guides && p.guides.length) { p.guides = []; paintGuides(p); } });
      }
    };

    apply();
  });
})();
