/* Add Dots PDF — Character and Paragraph
   -------------------------------------
   A selected text mark's type, laid out as Illustrator's Properties panel
   has it, in place of the plain font / B / I / size row (#mpText) on
   core's #markPop:

   Character  — the font, found by typing its name (each drawn in itself);
                its style (Regular, Bold, Italic, Bold Italic: those the
                family has); size; leading (Auto shows what it works out
                to, in brackets); tracking; underline and strikethrough.
                Each number takes typing, its up and down arrows, or a
                preset from its menu.
   Paragraph  — align left, centre, right; justify with the last line
                left, centred or right; justify all.

   Leading (s.lh) and tracking (s.tr) are the engine's (geometry.ts): the
   page, the editor and the saved PDF all lay the text out by them. A change
   goes to every text mark selected, as one undo step. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[typepanel] core bridge missing'); return; }
  const E = window.ADDPDFEngine;
  const GF = window.ADDDOTS_FONTS || null;

  const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 21, 24, 30, 36, 48, 60, 72];
  const LEADS = [6, 7, 8, 9, 10, 11, 12, 14, 18, 21, 24, 30, 36, 48, 60, 72];
  const TRACKS = [-100, -75, -50, -25, -10, -5, 0, 5, 10, 25, 50, 75, 100, 200];
  const STYLE_NAME = ['Regular', 'Bold', 'Italic', 'Bold Italic'];
  const ALIGNS = [
    ['left', 'Align left', 'M4 6h16M4 10h10M4 14h16M4 18h10'],
    ['center', 'Align centre', 'M4 6h16M7 10h10M4 14h16M7 18h10'],
    ['right', 'Align right', 'M4 6h16M10 10h10M4 14h16M10 18h10'],
    ['justify', 'Justify with last line aligned left', 'M4 6h16M4 10h16M4 14h16M4 18h9'],
    ['justify-center', 'Justify with last line aligned centre', 'M4 6h16M4 10h16M4 14h16M7.5 18h9'],
    ['justify-right', 'Justify with last line aligned right', 'M4 6h16M4 10h16M4 14h16M11 18h9'],
    ['justify-all', 'Justify all lines', 'M4 6h16M4 10h16M4 14h16M4 18h16']
  ];
  const ICON = {
    size: '<path d="M3 7V5h9v2M7.5 5v13M5.5 18h4"/><path d="M13 11v-1.5h7V11M16.5 9.5V18M15 18h3"/>',
    lead: '<path d="M10 4l-3 7M10 4l3 7M8 8.5h4M10 13l-3 7M10 13l3 7M8 17.5h4"/><path d="M19 5v14M17 7l2-2 2 2M17 17l2 2 2-2"/>',
    track: '<path d="M3 5l3 8 3-8M10 13l3-8 3 8M11.2 10h3.6"/><path d="M4 18h15M17 16l2 2-2 2M6 16l-2 2 2 2"/>',
    under: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
    strike: '<path d="M16 7a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0M4 12h16"/>'
  };
  const svg = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>'; };

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pop = $('markPop');
    if (!pop) return;

    /* ---------------- the fonts ---------------- */

    const FONTS = [
      { id: 'helv', name: 'Helvetica', css: 'Helvetica, Arial, sans-serif', styles: [1, 1, 1, 1] },
      { id: 'times', name: 'Times', css: '"Times New Roman", Times, serif', styles: [1, 1, 1, 1] },
      { id: 'cour', name: 'Courier', css: '"Courier New", Courier, monospace', styles: [1, 1, 1, 1] }
    ].concat(GF ? GF.list.map(function (f) {
      return { id: 'g:' + f.id, name: f.name, css: GF.css('g:' + f.id), styles: f.styles };
    }) : []);
    const fontOf = function (id) { return FONTS.filter(function (f) { return f.id === id; })[0] || FONTS[0]; };

    /* ---------------- the section ---------------- */

    function field(key, label, icon) {
      return '<div class="tpf" data-k="' + key + '">' +
        '<span class="tpi" title="' + label + '">' + svg(icon) + '</span>' +
        '<span class="tpspin"><button type="button" data-step="1" aria-label="' + label + ' up">' +
        svg('<path d="M7 14l5-5 5 5"/>') + '</button><button type="button" data-step="-1" aria-label="' + label + ' down">' +
        svg('<path d="M7 10l5 5 5-5"/>') + '</button></span>' +
        '<input type="text" inputmode="decimal" aria-label="' + label + '">' +
        '<select class="tppre" aria-label="' + label + ' presets"></select></div>';
    }
    const sec = document.createElement('div');
    sec.className = 'mptype'; sec.id = 'mpType'; sec.hidden = true;
    sec.innerHTML =
      '<div class="tpsec">' +
        '<div class="tphd">Character</div>' +
        '<div class="tpfont">' +
          '<span class="tpsearch">' + svg('<circle cx="10.5" cy="10.5" r="5.5"/><path d="M15 15l5 5"/>') + '</span>' +
          '<input type="text" id="tpFont" autocomplete="off" spellcheck="false" aria-label="Font" role="combobox" aria-expanded="false" aria-controls="tpFontList">' +
          '<button type="button" class="tpopen" id="tpFontOpen" aria-label="Show fonts">' + svg('<path d="M7 10l5 5 5-5"/>') + '</button>' +
          '<div class="tplist" id="tpFontList" role="listbox" hidden></div>' +
        '</div>' +
        '<select id="tpStyle" class="tpstyle" aria-label="Font style"></select>' +
        '<div class="tpgrid">' +
          field('size', 'Font size', ICON.size) +
          field('lead', 'Leading', ICON.lead) +
          field('track', 'Tracking', ICON.track) +
          '<div class="tpdeco">' +
            '<button type="button" class="tptog" id="tpUnder" title="Underline" aria-label="Underline">' + svg(ICON.under) + '</button>' +
            '<button type="button" class="tptog" id="tpStrike" title="Strikethrough" aria-label="Strikethrough">' + svg(ICON.strike) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tpsec">' +
        '<div class="tphd">Paragraph</div>' +
        '<div class="tpalign" role="group" aria-label="Paragraph alignment">' +
          ALIGNS.map(function (a) {
            return '<button type="button" class="tptog" data-align="' + a[0] + '" title="' + a[1] + '" aria-label="' + a[1] + '">' + svg('<path d="' + a[2] + '"/>') + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    /* where the plain row was, so the panel reads top to bottom as before */
    const old = $('mpText');
    if (old && old.parentNode === pop) pop.insertBefore(sec, old.nextSibling); else pop.appendChild(sec);
    document.body.classList.add('has-typepanel');

    const F = {};
    sec.querySelectorAll('.tpf').forEach(function (el) {
      F[el.dataset.k] = { el: el, input: el.querySelector('input'), pre: el.querySelector('.tppre') };
    });
    F.size.pre.innerHTML = '<option value="" hidden></option>' + SIZES.map(function (v) { return '<option value="' + v + '">' + v + ' pt</option>'; }).join('');
    F.lead.pre.innerHTML = '<option value="" hidden></option><option value="auto">Auto</option>' + LEADS.map(function (v) { return '<option value="' + v + '">' + v + ' pt</option>'; }).join('');
    F.track.pre.innerHTML = '<option value="" hidden></option>' + TRACKS.map(function (v) { return '<option value="' + v + '">' + v + '</option>'; }).join('');

    /* ---------------- reading and writing the selection ---------------- */

    function texts() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it) return null;
      const it = S.sel.it;
      const idx = X.selList().filter(function (i) { const s = it.shapes[i]; return s && s.t === 'text' && !s.locked; });
      return idx.length ? { it: it, idx: idx, s: it.shapes[S.sel.i] && it.shapes[S.sel.i].t === 'text' ? it.shapes[S.sel.i] : it.shapes[idx[0]] } : null;
    }
    function edit(fn) {
      const t = texts();
      if (!t) return;
      X.snapshot();
      t.idx.forEach(function (i) { fn(t.it.shapes[i]); });
      X.drawShapes(t.it);
      X.drawThumb(t.it);
      X.updateMeta();
      X.syncMarkPop();
      sync();
    }
    const round1 = function (v) { return Math.round(v * 10) / 10; };
    const num = function (v) { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

    /* ---------------- font: found by typing its name ---------------- */

    const fInput = $('tpFont'), fList = $('tpFontList');
    let listOn = -1;
    function showList(filter) {
      const q = (filter || '').trim().toLowerCase();
      const hits = FONTS.filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) >= 0; });
      fList.innerHTML = hits.length ? hits.map(function (f, k) {
        return '<div class="tpopt" role="option" data-id="' + f.id + '" data-k="' + k + '" style="font-family:' +
          f.css.replace(/"/g, '&quot;') + '">' + f.name + '</div>';
      }).join('') : '<div class="tpnone">No font by that name</div>';
      listOn = -1;
      fList.hidden = false;
      fInput.setAttribute('aria-expanded', 'true');
      const cur = fList.querySelector('[data-id="' + (texts() ? texts().s.f : '') + '"]');
      if (cur && !q) { cur.classList.add('cur'); cur.scrollIntoView({ block: 'nearest' }); }
    }
    function hideList() { fList.hidden = true; fInput.setAttribute('aria-expanded', 'false'); }
    function pickFont(id) {
      hideList();
      const fam = fontOf(id);
      edit(function (s) {
        s.f = id;
        /* a style the family lacks falls back to Regular */
        const st = (s.b ? 1 : 0) + (s.i ? 2 : 0);
        if (!fam.styles[st]) { s.b = false; s.i = false; }
      });
      fInput.blur();
    }
    fInput.addEventListener('focus', function () { fInput.select(); showList(''); });
    fInput.addEventListener('input', function () { showList(fInput.value); });
    fInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      const opts = fList.querySelectorAll('.tpopt');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (fList.hidden) showList(fInput.value);
        listOn = Math.max(0, Math.min(opts.length - 1, listOn + (e.key === 'ArrowDown' ? 1 : -1)));
        opts.forEach(function (o, k) { o.classList.toggle('on', k === listOn); });
        if (opts[listOn]) opts[listOn].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const o = opts[listOn >= 0 ? listOn : 0];
        if (o) pickFont(o.dataset.id); else { hideList(); sync(); fInput.blur(); }
      } else if (e.key === 'Escape') {
        hideList(); sync(); fInput.blur();
      }
    });
    fInput.addEventListener('blur', function () { setTimeout(function () { hideList(); sync(); }, 150); });
    fList.addEventListener('pointerdown', function (e) {
      const o = e.target.closest('.tpopt');
      if (!o) return;
      e.preventDefault();
      pickFont(o.dataset.id);
    });
    $('tpFontOpen').addEventListener('click', function () {
      if (fList.hidden) { fInput.focus(); } else { hideList(); fInput.blur(); }
    });

    $('tpStyle').addEventListener('change', function () {
      const st = +this.value;
      edit(function (s) { s.b = !!(st & 1); s.i = !!(st & 2); });
    });

    /* ---------------- size, leading, tracking ---------------- */

    const SET = {
      size: function (s, v) { s.size = Math.max(1, Math.min(1296, v)); },
      lead: function (s, v) { if (v == null) delete s.lh; else s.lh = Math.max(0, Math.min(5000, v)); },
      track: function (s, v) { if (!v) delete s.tr; else s.tr = Math.max(-1000, Math.min(10000, v)); }
    };
    const STEP = { size: 1, lead: 1, track: 10 };
    function current(k, s) {
      if (k === 'size') return s.size;
      if (k === 'lead') return E.leading(s);
      return s.tr || 0;
    }
    Object.keys(F).forEach(function (k) {
      const f = F[k];
      f.input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') sync(); this.blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          bump(k, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
        }
      });
      f.input.addEventListener('change', function () {
        const raw = this.value.trim().replace(/[()]/g, '');
        if (k === 'lead' && (/^auto$/i.test(raw) || raw === '')) { edit(function (s) { SET.lead(s, null); }); return; }
        const v = num(raw);
        if (v == null) { sync(); return; }
        edit(function (s) { SET[k](s, v); });
      });
      f.pre.addEventListener('change', function () {
        const v = this.value;
        this.value = '';
        if (v === '') return;
        if (v === 'auto') edit(function (s) { SET.lead(s, null); });
        else edit(function (s) { SET[k](s, +v); });
      });
      f.el.querySelectorAll('[data-step]').forEach(function (b) {
        b.addEventListener('click', function (e) { bump(k, +b.dataset.step, e.shiftKey); });
      });
    });
    /* an arrow: a step up or down (Shift: ten steps) */
    function bump(k, dir, big) {
      const st = STEP[k] * (big ? 10 : 1) * dir;
      edit(function (s) { SET[k](s, round1(current(k, s) + st)); });
    }

    $('tpUnder').addEventListener('click', function () {
      const on = !(texts() && texts().s.u);
      edit(function (s) { s.u = on; });
    });
    $('tpStrike').addEventListener('click', function () {
      const on = !(texts() && texts().s.k);
      edit(function (s) { s.k = on; });
    });
    sec.querySelectorAll('[data-align]').forEach(function (b) {
      b.addEventListener('click', function () {
        const v = b.dataset.align;
        edit(function (s) { s.align = v; });
      });
    });

    /* ---------------- showing what the selection has ---------------- */

    function sync() {
      const t = texts();
      sec.hidden = !t;
      if (!t) { hideList(); return; }
      const s = t.s, fam = fontOf(s.f);
      if (document.activeElement !== fInput) {
        fInput.value = fam.name;
        fInput.style.fontFamily = fam.css;
      }
      const st = (s.b ? 1 : 0) + (s.i ? 2 : 0);
      $('tpStyle').innerHTML = STYLE_NAME.map(function (n, k) {
        return fam.styles[k] ? '<option value="' + k + '">' + n + '</option>' : '';
      }).join('');
      $('tpStyle').value = String(fam.styles[st] ? st : 0);
      const set = function (k, text) { if (document.activeElement !== F[k].input) F[k].input.value = text; };
      set('size', round1(s.size) + ' pt');
      set('lead', s.lh != null && s.lh > 0 ? round1(s.lh) + ' pt' : '(' + round1(s.size * 1.2) + ' pt)');
      set('track', String(s.tr || 0));
      $('tpUnder').classList.toggle('on', !!s.u);
      $('tpStrike').classList.toggle('on', !!s.k);
      sec.querySelectorAll('[data-align]').forEach(function (b) {
        b.classList.toggle('on', (s.align || 'left') === b.dataset.align);
        b.setAttribute('aria-pressed', (s.align || 'left') === b.dataset.align ? 'true' : 'false');
      });
    }
    X.syncTypePanel = sync;
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(pop, { attributes: true, attributeFilter: ['hidden'] });
      if ($('mpTitle')) new MutationObserver(sync).observe($('mpTitle'), { childList: true, characterData: true, subtree: true });
    }
    document.addEventListener('pointerup', function (e) { if (!sec.contains(e.target)) setTimeout(sync, 0); });
    document.addEventListener('keyup', function (e) { if (!sec.contains(e.target)) setTimeout(sync, 0); });
    sync();
  });
})();
