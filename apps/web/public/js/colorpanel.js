/* Add Dots PDF — Fill and Stroke, and Swatches
   -------------------------------------------
   Illustrator's colour controls, at the head of the selected object's
   properties (core's #markPop, docked in the Properties panel):

   Fill and Stroke — two squares, one over the other: the fill (a colour, a
     gradient, or none) and the stroke (a square ring in its colour, or
     none). A click makes one active, and it comes to the front; a
     double-click opens it in the colour picker (js/colordlg.js: spectrum,
     hue, HSB, RGB, CMYK, hex, opacity, recent colours, copy and paste of the
     hex code). Beside them: swap fill and stroke, the default (white fill,
     black stroke), and None for the active one. Under them, the active
     one's hex code, to copy or paste one in.

   Swatches — the colours kept for this work, named, between sessions
     (localStorage): a click puts one on the active fill or stroke of
     everything selected; drag one onto any object on the page to give it
     that colour. New takes the active colour, a double-click renames one,
     the bin deletes the one picked. Recently used colours show under them.

   Every change is one undo step (core markEdit), on every object selected.
   The existing Fill and Border menus stay as they were. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[colorpanel] core bridge missing'); return; }

  const KEY_SW = 'adpdf.swatches';
  const KEY_SIDE = 'adpdf.fsActive';
  const DEFAULT_SWATCHES = [
    ['White', '#FFFFFF'], ['Black', '#000000'], ['Grey 50%', '#808080'], ['Light grey', '#D9D9D9'],
    ['Red', '#E2483D'], ['Orange', '#F28C28'], ['Yellow', '#F2C14E'], ['Green', '#2F9E44'],
    ['Teal', '#0CA678'], ['Cyan', '#22B8CF'], ['Blue', '#2F80ED'], ['Navy', '#1E3A8A'],
    ['Purple', '#7B5CFF'], ['Magenta', '#D6336C'], ['Brown', '#8B5A2B'], ['Beige', '#F5E6C8']
  ].map(function (x) { return { name: x[0], c: x[1] }; });
  const svg = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>'; };
  const ICON = {
    swap: '<path d="M7 4v9a4 4 0 0 0 4 4h9M17 14l3 3-3 3M4 7l3-3 3 3"/>',
    deflt: '<rect x="3.5" y="3.5" width="10" height="10" fill="#fff"/><rect x="10.5" y="10.5" width="10" height="10" fill="none" stroke-width="3"/>',
    none: '<rect x="4" y="4" width="16" height="16" rx="1" fill="#fff"/><path d="M5 19L19 5" stroke="#E03131" stroke-width="2"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    rename: '<path d="M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="1.5"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>',
    paste: '<path d="M9 5H6.5A1.5 1.5 0 0 0 5 6.5v12A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 5H15"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
    bin: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5"/>'
  };

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pop = $('markPop');
    if (!pop || !X.markEdit) return;

    let side = (function () { try { return localStorage.getItem(KEY_SIDE) === 'stroke' ? 'stroke' : 'fill'; } catch (e) { return 'fill'; } })();
    let picked = -1;                                /* the swatch picked, for rename and delete */

    function swatches() {
      try {
        const v = JSON.parse(localStorage.getItem(KEY_SW) || 'null');
        if (Array.isArray(v)) return v.filter(function (x) { return x && /^#[0-9A-F]{6}$/i.test(x.c); }).slice(0, 200);
      } catch (e) { /* none kept */ }
      return DEFAULT_SWATCHES.map(function (x) { return { name: x.name, c: x.c }; });
    }
    function keepSwatches(list) { try { localStorage.setItem(KEY_SW, JSON.stringify(list)); } catch (e) { /* this session only */ } }

    /* ---------------- the widget ---------------- */

    const sec = document.createElement('div');
    sec.className = 'fswrap'; sec.id = 'fsWrap'; sec.hidden = true;
    sec.innerHTML =
      '<div class="fsw">' +
        '<div class="fsstack" role="group" aria-label="Fill and stroke">' +
          '<button type="button" class="fsq fsfill" id="fsFill" title="Fill: click to make it active, double-click for the colour picker" aria-label="Fill"><i></i></button>' +
          '<button type="button" class="fsq fsstroke" id="fsStroke" title="Stroke: click to make it active, double-click for the colour picker" aria-label="Stroke"><i></i></button>' +
        '</div>' +
        '<div class="fsbtns">' +
          '<button type="button" class="fsb" id="fsSwap" title="Swap fill and stroke" aria-label="Swap fill and stroke">' + svg(ICON.swap) + '</button>' +
          '<button type="button" class="fsb" id="fsDefault" title="Default fill and stroke: white fill, black stroke" aria-label="Default fill and stroke">' + svg(ICON.deflt) + '</button>' +
          '<button type="button" class="fsb" id="fsNone" title="None for the active one" aria-label="None">' + svg(ICON.none) + '</button>' +
        '</div>' +
        '<div class="fshex">' +
          '<span class="fslbl" id="fsSide">Fill</span>' +
          '<input type="text" id="fsHex" maxlength="7" spellcheck="false" aria-label="Hex colour of the active fill or stroke">' +
          '<button type="button" class="fsb" id="fsCopy" title="Copy the hex code" aria-label="Copy the hex code">' + svg(ICON.copy) + '</button>' +
          '<button type="button" class="fsb" id="fsPaste" title="Paste a hex code" aria-label="Paste a hex code">' + svg(ICON.paste) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="swp">' +
        '<div class="swphd"><span>Swatches</span>' +
          '<button type="button" class="fsb" id="swAdd" title="New swatch: the active colour" aria-label="New swatch">' + svg(ICON.add) + '</button>' +
          '<button type="button" class="fsb" id="swRename" title="Rename the swatch picked" aria-label="Rename swatch">' + svg(ICON.rename) + '</button>' +
          '<button type="button" class="fsb" id="swDel" title="Delete the swatch picked" aria-label="Delete swatch">' + svg(ICON.bin) + '</button>' +
        '</div>' +
        '<div class="swgrid" id="swGrid" role="listbox" aria-label="Swatches"></div>' +
        '<div class="swphd sub" id="swRecentHd">Recent</div>' +
        '<div class="swgrid" id="swRecent"></div>' +
      '</div>';
    /* first in the properties, above the existing Fill and Border menus */
    const first = $('mpFillBtn');
    if (first && first.parentNode === pop) pop.insertBefore(sec, first); else pop.insertBefore(sec, pop.firstChild);

    function sel() {
      if (!S.sel || !S.sel.it) return null;
      const s = S.sel.it.shapes[S.sel.i];
      return s && s.t !== 'text' && s.t !== 'pin' && s.c != null ? s : null;
    }
    const closed = function (s) { return !!(X.closedShape && X.closedShape(s)); };

    function paint() {
      const s = sel();
      sec.hidden = !s;
      if (!s) return;
      const canFill = closed(s);
      if (!canFill && side === 'fill') side = 'stroke';
      sec.classList.toggle('stroke-on', side === 'stroke');
      const fi = $('fsFill').querySelector('i'), st = $('fsStroke').querySelector('i');
      fi.style.background = s.grad && X.gradCss ? X.gradCss(s.grad) : (s.fill || '');
      $('fsFill').classList.toggle('none', !s.fill);
      $('fsFill').disabled = !canFill;
      st.style.borderColor = s.nos ? 'transparent' : s.c;
      $('fsStroke').classList.toggle('none', !!s.nos);
      $('fsFill').classList.toggle('on', side === 'fill');
      $('fsStroke').classList.toggle('on', side === 'stroke');
      $('fsFill').setAttribute('aria-pressed', side === 'fill' ? 'true' : 'false');
      $('fsStroke').setAttribute('aria-pressed', side === 'stroke' ? 'true' : 'false');
      $('fsSwap').disabled = !canFill;
      $('fsSide').textContent = side === 'fill' ? 'Fill' : 'Stroke';
      if (document.activeElement !== $('fsHex')) $('fsHex').value = current(s) || 'None';
      paintSwatches();
    }
    /* the active one's colour: a gradient's first colour; null for none */
    function current(s) {
      if (side === 'fill') return s.fill ? String(s.fill).toUpperCase() : null;
      return s.nos ? null : String(s.c).toUpperCase();
    }

    /** Colour c (null: none) on the active fill or stroke of everything selected. */
    function apply(c, which) {
      which = which || side;
      if (c && X.noteRecent) X.noteRecent(c);
      X.markEdit(function (m) { setOn(m, which, c); });
      X.drawThumb(S.sel.it);
    }
    function setOn(m, which, c) {
      if (m.t === 'text' || m.t === 'pin' || m.c == null) return;
      if (which === 'fill') {
        if (!closed(m)) return;
        if (c) { m.fill = c; delete m.grad; } else { delete m.fill; delete m.grad; }
      } else if (c) { m.c = c; delete m.nos; }
      else if (closed(m)) m.nos = true;          /* an open line is nothing but its stroke */
    }

    function setSide(v) {
      side = v;
      try { localStorage.setItem(KEY_SIDE, v); } catch (e) { /* this session only */ }
      paint();
    }
    $('fsFill').addEventListener('click', function () { setSide('fill'); });
    $('fsStroke').addEventListener('click', function () { setSide('stroke'); });
    function openPicker(which) {
      const s = sel();
      if (!s || !X.colorDialog) return;
      setSide(which);
      const now = which === 'fill' ? (s.fill || '#FFFFFF') : s.c;
      X.colorDialog(now, function (h, a) {
        const op = Math.round(a * 100) / 100;
        X.markEdit(function (m) {
          setOn(m, which, h);
          /* the picker's opacity is the object's own, as the Opacity field is */
          if (op < 1) m.o = op; else delete m.o;
        });
        X.drawThumb(S.sel.it);
      }, { alpha: s.o == null ? 1 : s.o, title: which === 'fill' ? 'Fill colour' : 'Stroke colour' });
    }
    $('fsFill').addEventListener('dblclick', function () { openPicker('fill'); });
    $('fsStroke').addEventListener('dblclick', function () { openPicker('stroke'); });

    /* swap: the fill takes the stroke's colour and the stroke the fill's (a
       gradient's first colour), none going across as none */
    $('fsSwap').addEventListener('click', function () {
      X.markEdit(function (m) {
        if (!closed(m) || m.t === 'text') return;
        const f = m.fill ? String(m.fill).toUpperCase() : null, k = m.nos ? null : m.c;
        if (k) { m.fill = k; } else delete m.fill;
        delete m.grad;
        if (f) { m.c = f; delete m.nos; } else m.nos = true;
        if (!m.fill && m.nos) { delete m.nos; }   /* never neither: it could not be seen or picked */
      });
      X.drawThumb(S.sel.it);
    });
    $('fsDefault').addEventListener('click', function () {
      X.markEdit(function (m) {
        if (m.t === 'text' || m.t === 'pin' || m.c == null) return;
        m.c = '#000000'; delete m.nos;
        if (closed(m)) { m.fill = '#FFFFFF'; delete m.grad; }
      });
      X.drawThumb(S.sel.it);
    });
    $('fsNone').addEventListener('click', function () {
      const s = sel();
      if (!s) return;
      /* never both none: a shape with neither could not be seen or picked */
      if (side === 'fill' ? (s.nos) : (!s.fill)) { X.toast('A shape needs a fill or a stroke'); return; }
      apply(null);
    });

    /* the hex code: typed, copied, pasted */
    function hexOf(t) {
      t = String(t || '').trim().replace(/^#/, '');
      if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, '$&$&');
      return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toUpperCase() : null;
    }
    $('fsHex').addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
      else if (e.key === 'Escape') { this.value = current(sel()) || 'None'; this.blur(); }
    });
    $('fsHex').addEventListener('change', function () {
      const h = hexOf(this.value);
      if (h) apply(h); else paint();
    });
    $('fsCopy').addEventListener('click', function () {
      const h = current(sel());
      if (!h) { X.toast('No colour to copy: it is set to none'); return; }
      const done = function () { X.toast('Copied <b>' + h + '</b>'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(h).then(done, done);
      else done();
    });
    $('fsPaste').addEventListener('click', function () {
      const use = function (t) { const h = hexOf(t); if (h) apply(h); else X.toast('The clipboard has no hex colour (#RRGGBB)'); };
      if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(use, function () { $('fsHex').focus(); $('fsHex').select(); });
      else { $('fsHex').focus(); $('fsHex').select(); }
    });

    /* ---------------- swatches ---------------- */

    function chip(c, name, i, recent) {
      return '<button type="button" class="swq' + (!recent && i === picked ? ' picked' : '') + '"' +
        (recent ? ' data-rc="' + c + '"' : ' data-i="' + i + '" role="option" aria-selected="' + (i === picked ? 'true' : 'false') + '"') +
        ' draggable="true" data-c="' + c + '" title="' + X.esc((name ? name + ' · ' : '') + c) + '" aria-label="' + X.esc(name || c) + '" style="background:' + c + '"></button>';
    }
    function paintSwatches() {
      const list = swatches();
      if (picked >= list.length) picked = -1;
      $('swGrid').innerHTML = list.map(function (x, i) { return chip(x.c, x.name, i, false); }).join('');
      const rec = X.recentColors ? X.recentColors() : [];
      $('swRecent').innerHTML = rec.map(function (c) { return chip(c, '', 0, true); }).join('');
      $('swRecentHd').hidden = $('swRecent').hidden = !rec.length;
      $('swRename').disabled = $('swDel').disabled = picked < 0;
    }
    sec.addEventListener('click', function (e) {
      const b = e.target.closest('.swq');
      if (!b) return;
      if (b.dataset.i != null) picked = +b.dataset.i;
      apply(b.dataset.c);
    });
    $('swGrid').addEventListener('dblclick', function (e) {
      const b = e.target.closest('.swq');
      if (b) { picked = +b.dataset.i; rename(); }
    });
    $('swAdd').addEventListener('click', function () {
      const s = sel(), c = s ? current(s) : null;
      if (!c) { X.toast('Pick a fill or stroke with a colour to make a swatch of it'); return; }
      const list = swatches();
      list.push({ name: 'Swatch ' + (list.length + 1), c: c });
      keepSwatches(list);
      picked = list.length - 1;
      paintSwatches();
      X.toast('Swatch added: <b>' + c + '</b>');
    });
    function rename() {
      const list = swatches(), x = list[picked];
      if (!x) return;
      const done = function (v) {
        if (v == null) return;
        v = String(v).trim().slice(0, 60);
        if (!v) return;
        x.name = v; keepSwatches(list); paintSwatches();
      };
      /* the app's own dialog: the Windows app has no window.prompt */
      Promise.resolve(X.ask('A name for this swatch', x.name, { title: 'Rename swatch', ok: 'Rename' })).then(done);
    }
    $('swRename').addEventListener('click', rename);
    $('swDel').addEventListener('click', function () {
      const list = swatches();
      if (!list[picked]) return;
      list.splice(picked, 1);
      keepSwatches(list);
      picked = Math.min(picked, list.length - 1);
      paintSwatches();
    });

    /* a swatch dragged onto an object on the page gives it that colour, on
       the active fill or stroke, whether it is selected or not */
    sec.addEventListener('dragstart', function (e) {
      const b = e.target.closest('.swq');
      if (!b || !e.dataTransfer) return;
      e.dataTransfer.setData('text/x-adpdf-colour', b.dataset.c);
      e.dataTransfer.setData('text/plain', b.dataset.c);
      e.dataTransfer.effectAllowed = 'copy';
    });
    function markAt(x, y) {
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        const anno = el.closest && el.closest('svg.anno');
        if (!anno) continue;
        const it = S.items.filter(function (v) { return v.anno === anno; })[0];
        if (!it) continue;
        let top = el;
        while (top && top.parentNode && top.parentNode !== anno) top = top.parentNode;
        const i = top && top.parentNode === anno ? X.markKids(anno).indexOf(top) : -1;
        if (i >= 0 && i < it.shapes.length && it.shapes[i] && it.shapes[i].c != null && it.shapes[i].t !== 'text') return { it: it, i: i };
      }
      return null;
    }
    const stage = $('stage');
    stage.addEventListener('dragover', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'text/x-adpdf-colour') < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = markAt(e.clientX, e.clientY) ? 'copy' : 'none';
    });
    stage.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      const c = e.dataTransfer.getData('text/x-adpdf-colour');
      if (!c) return;
      e.preventDefault(); e.stopPropagation();
      const hit = markAt(e.clientX, e.clientY);
      if (!hit) { X.toast('Drop a swatch on an object to colour it'); return; }
      const m = hit.it.shapes[hit.i];
      const which = side === 'fill' && closed(m) ? 'fill' : 'stroke';
      X.snapshot();
      setOn(m, which, c);
      if (X.noteRecent) X.noteRecent(c);
      X.drawShapes(hit.it); X.drawThumb(hit.it); X.updateMeta(); X.syncMarkPop();
    }, true);

    X.on('markpop', paint);
    X.colorPanel = { side: function () { return side; }, apply: apply, swatches: swatches };
    paint();
  });
})();
