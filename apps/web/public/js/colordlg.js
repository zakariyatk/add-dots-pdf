/* Add Dots PDF — Edit colours
   --------------------------
   The app's own colour dialog, laid out like Windows's: a spectrum, a
   brightness bar, hex, RGB or HSV, basic and custom colours, and an
   eyedropper. It stands in for the browser's picker on every
   <input type="color"> in the app, so each colour option gets it.

   The eyedropper is the browser's where it has one, which reads anywhere on
   screen. Elsewhere (Firefox, phones) it reads a click on the PDF page. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[colordlg] core bridge missing'); return; }

  const CUSTOM_KEY = 'adpdf.customColors';
  const BASIC = [
    '#F08080', '#EE3024', '#7A4341', '#8C4136', '#390303', '#99FBFB', '#6EFCFC', '#3385EE', '#0026F5', '#00159B', '#1A4178', '#000C7B',
    '#FFFF99', '#FFFF4A', '#F19A56', '#F18650', '#7A4414', '#7F7F27', '#8088F5', '#782EF4', '#3B82BF', '#000244', '#57145F', '#380A42',
    '#A6FB8A', '#A4FB48', '#75F94C', '#6FF752', '#76F98E', '#7F7F47', '#F085C0', '#EF87EE', '#EA3FF7', '#EA3380', '#7F82BB', '#731339',
    '#377D22', '#387F4F', '#367C7E', '#4F7F80', '#173F0F', '#17444A', '#761B7C', '#3A0F7B', '#000000', '#808080', '#C0C0C0', '#FFFFFF'
  ];
  const clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  function hsvToRgb(h, s, v) {
    const f = function (n) {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  }
  function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return [h * 60, max ? d / max : 0, max / 255];
  }
  function hexOf(rgb) {
    return '#' + rgb.map(function (n) { return n.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /* '#abc', 'abc' or '#AABBCC' as #AABBCC, or null */
  function cleanHex(v) {
    let t = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, '$&$&');
    return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toUpperCase() : null;
  }

  function customColours() {
    try { return (JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') || []).slice(0, 24); } catch (e) { return []; }
  }
  function keepCustom(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* private window */ }
  }

  /* the colour at a screen point, read off the page's own canvas */
  function colourAt(x, y) {
    const cv = document.elementsFromPoint(x, y).filter(function (el) { return el.tagName === 'CANVAS'; })[0];
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const dot = document.createElement('canvas');
    dot.width = dot.height = 1;
    const c = dot.getContext('2d');
    c.drawImage(cv, (x - r.left) * cv.width / r.width, (y - r.top) * cv.height / r.height, 1, 1, 0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return hexOf([d[0], d[1], d[2]]);
  }

  /* the next click on the page gives a colour; Esc gives none */
  function pickFromPage(done) {
    X.toast('Click a colour on the page · <b>Esc</b> cancels');
    document.body.classList.add('cdpicking');
    function stop(hex) {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      document.body.classList.remove('cdpicking');
      done(hex);
    }
    function down(e) {
      e.preventDefault(); e.stopPropagation();
      /* the click this press ends in is not for the tool in hand */
      window.addEventListener('click', function (c) { c.preventDefault(); c.stopPropagation(); },
        { capture: true, once: true });
      const hex = colourAt(e.clientX, e.clientY);
      if (!hex) X.toast('Click on a PDF page to pick its colour');
      stop(hex);
    }
    function key(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      stop(null);
    }
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
  }

  /** A colour from the screen: done(hex), or done(null) if cancelled. */
  function pickColour(done) {
    if (!window.EyeDropper) { pickFromPage(done); return; }
    new window.EyeDropper().open().then(function (r) { done(cleanHex(r.sRGBHex)); }, function () { done(null); });
  }

  let open = false;

  /** The dialog: onPick(#RRGGBB) on OK, nothing on Cancel. */
  function colorDialog(current, onPick) {
    if (open) return;
    open = true;
    const start = cleanHex(current) || '#000000';
    let hsv = rgbToHsv.apply(null, rgbOf(start));
    let mode = 'rgb';
    let custom = customColours();

    const wrap = document.createElement('div');
    wrap.className = 'cdwrap';
    wrap.innerHTML =
      '<div class="cdbox" role="dialog" aria-modal="true" aria-label="Edit colours">' +
        '<h2>Edit colours</h2>' +
        '<div class="cdtop">' +
          '<div class="cdsv" tabindex="0" role="slider" aria-label="Hue and saturation"><i></i></div>' +
          '<div class="cdnow"></div>' +
          '<div class="cdval" tabindex="0" role="slider" aria-label="Brightness"><i></i></div>' +
          '<div class="cdfields">' +
            '<input class="cdhex" maxlength="7" aria-label="Hex colour" spellcheck="false">' +
            '<select class="cdmode" aria-label="Colour model"><option value="rgb">RGB</option><option value="hsv">HSV</option></select>' +
            [0, 1, 2].map(function (i) {
              return '<label class="cdnum"><input inputmode="numeric" data-i="' + i + '"><span></span></label>';
            }).join('') +
            '<button type="button" class="btn cdeye"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l5 5M4 20l1.5-4.5 9-9 3 3-9 9z"/></svg>Pick colour</button>' +
          '</div>' +
        '</div>' +
        '<div class="cdlists">' +
          '<div><div class="cdhd">Basic colours</div><div class="cdgrid cdbasic"></div></div>' +
          '<div><div class="cdhd">Custom colours<button type="button" class="cdadd" title="Add this colour" aria-label="Add this colour">+</button></div>' +
          '<div class="cdgrid cdcustom"></div></div>' +
        '</div>' +
        '<div class="cdfoot"><button type="button" class="btn primary cdok">OK</button>' +
        '<button type="button" class="btn cdno">Cancel</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    const q = function (sel) { return wrap.querySelector(sel); };
    const sv = q('.cdsv'), val = q('.cdval'), hexIn = q('.cdhex');
    const nums = Array.prototype.slice.call(wrap.querySelectorAll('.cdnum input'));

    function hex() { return hexOf(hsvToRgb(hsv[0], hsv[1], hsv[2])); }
    function fieldValues() {
      if (mode === 'rgb') return rgbOf(hex());
      return [Math.round(hsv[0]), Math.round(hsv[1] * 100), Math.round(hsv[2] * 100)];
    }
    /* `from`: the field being typed in, left as it is */
    function paint(from) {
      const now = hex();
      sv.firstChild.style.left = hsv[0] / 360 * 100 + '%';
      sv.firstChild.style.top = (1 - hsv[1]) * 100 + '%';
      val.firstChild.style.top = (1 - hsv[2]) * 100 + '%';
      val.style.setProperty('--cd-top', hexOf(hsvToRgb(hsv[0], hsv[1], 1)));
      q('.cdnow').style.background = now;
      if (from !== hexIn) hexIn.value = now;
      const vals = fieldValues();
      nums.forEach(function (n, i) { if (n !== from) n.value = vals[i]; });
    }
    function setHex(h, from) {
      const c = rgbToHsv.apply(null, rgbOf(h));
      /* a grey or black has no hue of its own: keep the one in hand */
      hsv = [c[1] && c[2] ? c[0] : hsv[0], c[2] ? c[1] : hsv[1], c[2]];
      paint(from);
    }

    function labels() {
      const names = mode === 'rgb' ? ['Red', 'Green', 'Blue'] : ['Hue', 'Sat', 'Val'];
      wrap.querySelectorAll('.cdnum span').forEach(function (s, i) { s.textContent = names[i]; });
    }

    function dot(c, cls) {
      return '<button type="button" class="cddot' + (cls || '') + '" data-c="' + c + '" title="' + c + '" aria-label="Colour ' + c + '" style="background:' + c + '"></button>';
    }
    function drawCustom() {
      let h = custom.map(function (c) { return dot(c); }).join('');
      for (let i = custom.length; i < 24; i++) h += '<span class="cddot empty"></span>';
      q('.cdcustom').innerHTML = h;
    }
    q('.cdbasic').innerHTML = BASIC.map(function (c) { return dot(c); }).join('');
    drawCustom();

    function drag(el, move) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        el.focus({ preventScroll: true });
        el.setPointerCapture(e.pointerId);
        const at = function (ev) {
          const r = el.getBoundingClientRect();
          move(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
          paint();
        };
        at(e);
        el.addEventListener('pointermove', at);
        el.addEventListener('pointerup', function () { el.removeEventListener('pointermove', at); }, { once: true });
      });
    }
    /* a colour with no brightness is black whatever is chosen on the
       spectrum, so choosing there brings the brightness up */
    drag(sv, function (x, y) {
      hsv[0] = Math.min(359.9, x * 360); hsv[1] = 1 - y;
      if (!hsv[2]) hsv[2] = 1;
    });
    drag(val, function (x, y) { hsv[2] = 1 - y; });
    function arrows(el, step) {
      el.addEventListener('keydown', function (e) {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (!d) return;
        e.preventDefault();
        step(d[0], d[1]);
        paint();
      });
    }
    arrows(sv, function (x, y) {
      hsv[0] = clamp(hsv[0] + x * 3.6, 0, 359.9); hsv[1] = clamp(hsv[1] + y * 0.01, 0, 1);
    });
    arrows(val, function (x, y) { hsv[2] = clamp(hsv[2] + y * 0.01, 0, 1); });

    hexIn.addEventListener('input', function () {
      const h = cleanHex(hexIn.value);
      hexIn.classList.toggle('bad', !h);
      if (h) setHex(h, hexIn);
    });
    hexIn.addEventListener('blur', function () { hexIn.classList.remove('bad'); paint(); });
    nums.forEach(function (n) {
      n.addEventListener('input', function () {
        const v = nums.map(function (x) { return parseFloat(x.value) || 0; });
        if (mode === 'rgb') setHex(hexOf(v.map(function (c) { return clamp(Math.round(c), 0, 255); })), n);
        else {
          hsv = [clamp(v[0], 0, 359.9), clamp(v[1], 0, 100) / 100, clamp(v[2], 0, 100) / 100];
          paint(n);
        }
      });
      n.addEventListener('blur', function () { paint(); });
    });
    q('.cdmode').addEventListener('change', function () { mode = this.value; labels(); paint(); });

    wrap.addEventListener('click', function (e) {
      const c = e.target.closest('[data-c]');
      if (c) setHex(c.dataset.c);
    });
    q('.cdadd').addEventListener('click', function () {
      const now = hex();
      custom = [now].concat(custom.filter(function (c) { return c !== now; })).slice(0, 24);
      keepCustom(custom);
      drawCustom();
    });
    q('.cdeye').addEventListener('click', function () {
      wrap.hidden = true;
      pickColour(function (h) {
        wrap.hidden = false;
        if (h) setHex(h);
      });
    });

    function close() {
      open = false;
      wrap.remove();
    }
    q('.cdok').addEventListener('click', function () { const h = hex(); close(); onPick(h); });
    q('.cdno').addEventListener('click', close);
    /* what is typed here is not a shortcut for the app behind */
    wrap.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') q('.cdok').click();
    });
    wrap.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    wrap.addEventListener('click', function (e) { e.stopPropagation(); });

    labels();
    paint();
    hexIn.focus();
    hexIn.select();
  }

  /* every colour input opens the dialog in place of the browser's picker */
  window.addEventListener('click', function (e) {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'color') return;
    e.preventDefault();
    colorDialog(el.value, function (h) {
      el.value = h.toLowerCase();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);

  X.colorDialog = colorDialog;
  X.pickColour = pickColour;
})();
