/* ADD DOTS PDF — Forms & signatures
   ---------------------------------
   Reads the AcroForm fields pdf.js finds on each page, floats a real HTML
   control over each one so they can be filled in, and writes the answers back
   out on Save. Also draws, types or uploads a signature and drops it anywhere
   on the page.

   On saving, core rebuilds the document page by page (that is what lets pages
   be reordered, dropped and merged), and a rebuilt page cannot carry the
   original interactive widgets with it. So filled values are painted into the
   page — flattened — which is what a signed, issued copy should be anyway.
   When the page set is untouched there is a second path that keeps the fields
   live; the Form panel offers it whenever it applies. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[forms] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const E = window.ADDPDFEngine;

    /* fieldName -> value. Kept per document, cleared when a new file opens. */
    let values = {};
    let showFields = true;

    /* ---------------- ribbon tab ---------------- */

    const tab = document.createElement('button');
    tab.className = 'tab'; tab.id = 'ribForm'; tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panForm');
    tab.textContent = 'Form';
    $('ribTabs').appendChild(tab);

    const pan = document.createElement('div');
    pan.className = 'rpan'; pan.id = 'panForm'; pan.hidden = true;
    pan.setAttribute('role', 'tabpanel'); pan.setAttribute('aria-labelledby', 'ribForm');
    pan.innerHTML =
      '<div class="grp">' +
      '<button class="btn" id="btnFields" title="Show the fillable fields on the page" data-label="Fill fields">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="5" rx="1"/>' +
      '<rect x="3" y="14" width="11" height="5" rx="1"/></svg><span class="lbl">Fields</span></button>' +
      '<span class="cnt" id="fieldCount" hidden></span>' +
      '<button class="btn" id="btnFormClear" title="Empty every field" data-label="Clear form">' +
      '<svg viewBox="0 0 24 24"><path d="M19 5L5 19"/><path d="M5 5l14 14"/></svg></button>' +
      '</div>' +
      '<span class="sep"></span>' +
      '<div class="grp">' +
      '<button class="btn" id="btnSign" title="Add a signature (Shift+S)" data-label="Signature">' +
      '<svg viewBox="0 0 24 24"><path d="M3 18c3 0 4-9 7-9s2 7 4.5 7S18 12 21 12"/>' +
      '<line x1="3" y1="21" x2="21" y2="21"/></svg><span class="lbl">Sign</span></button>' +
      '<button class="btn" id="btnInitials" title="Place your initials" data-label="Initials">' +
      '<svg viewBox="0 0 24 24"><path d="M6 6v12"/><path d="M12 18V6l6 12V6"/></svg></button>' +
      '</div>' +
      '<span class="sep"></span>' +
      '<div class="grp">' +
      '<button class="btn" id="btnFlatten" title="Bake the filled values and signatures into the page" data-label="Flatten">' +
      '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5z"/><path d="M3 14l9 5 9-5"/></svg>' +
      '<span class="lbl">Flatten</span></button>' +
      '</div>';
    $('ribbon').appendChild(pan);
    X.addRibbonTab('ribForm', 'panForm');

    /* ---------------- reading the fields off each page ---------------- */

    /* One descriptor per widget: where it sits on the page (PDF points), what
       kind it is, and the HTML control we floated over it. */
    async function readFields(it) {
      if (it.fields) return it.fields;
      /* a page pdf.js cannot load has no fields to offer; left unscanned, so
         a later scan tries it again, and the pages after it are still read */
      try { await X.ensurePage(it); } catch (e) { return []; }
      let annots = [];
      try { annots = await it.page.getAnnotations({ intent: 'display' }); }
      catch (e) { annots = []; }
      it.fields = annots.filter(function (a) {
        return a.subtype === 'Widget' && a.fieldType && !a.hidden;
      }).map(function (a) {
        return {
          name: a.fieldName,
          type: a.fieldType,                       /* Tx | Btn | Ch | Sig */
          rect: a.rect,                            /* [x1,y1,x2,y2] in PDF points */
          readOnly: !!a.readOnly,
          multiline: !!a.multiLine,
          maxLen: a.maxLen || 0,
          options: (a.options || []).map(function (o) {
            return { v: o.exportValue != null ? o.exportValue : o.displayValue, l: o.displayValue };
          }),
          radio: !!a.radioButton,
          checkbox: !!a.checkBox,
          exportValue: a.exportValue,
          fontSize: a.fontSize || 0,
          initial: a.fieldValue
        };
      });
      /* seed the answers from whatever the file already had in it */
      it.fields.forEach(function (f) {
        if (values[f.name] === undefined && f.initial != null && f.initial !== '') {
          values[f.name] = f.initial;
        }
      });
      return it.fields;
    }

    /* The scan reads every page's widgets through the pdf.js worker, so it
       gives way to the pages being drawn, before each page it reads: a long
       form must not hold up the first page, which is drawn in another worker
       and so no longer queues behind it. Saving waits for it (below), so a
       value the file already held is always written out. */
    let scanning = Promise.resolve(0);
    function scanSoon() {
      /* never rejects: saving waits on it */
      scanning = X.renderIdle().then(scanAll).catch(function () { return 0; });
      return scanning;
    }
    X.beforeSave.push(function () { return scanning; });

    async function scanAll() {
      let n = 0;
      for (const it of S.items) {
        if (!it.fields) await X.renderIdle();
        n += (await readFields(it)).length;
      }
      const c = $('fieldCount');
      c.textContent = n ? String(n) : '';
      c.hidden = !n;
      $('btnFields').classList.toggle('on', n > 0 && showFields);
      $('btnFields').disabled = !n;
      $('btnFormClear').disabled = !n;
      return n;
    }

    /* ---------------- floating the controls over the page ---------------- */

    function layerFor(it) {
      if (it.formLayer) return it.formLayer;
      const d = document.createElement('div');
      d.className = 'formlayer';
      it.inner.appendChild(d);
      it.formLayer = d;
      return d;
    }

    function paintFields(it) {
      if (!it.vp || !it.fields) return;
      const host = layerFor(it);
      host.innerHTML = '';
      host.hidden = !showFields;
      if (!showFields) return;

      it.fields.forEach(function (f) {
        const a = it.vp.convertToViewportPoint(f.rect[0], f.rect[1]);
        const b = it.vp.convertToViewportPoint(f.rect[2], f.rect[3]);
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
        const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
        if (w < 4 || h < 4) return;

        let el;
        if (f.type === 'Btn' && f.checkbox) {
          el = document.createElement('input');
          el.type = 'checkbox';
          el.checked = isOn(values[f.name], f.exportValue);
          el.addEventListener('change', function () {
            values[f.name] = el.checked ? (f.exportValue || 'Yes') : 'Off';
            X.updateMeta();
          });
        } else if (f.type === 'Btn' && f.radio) {
          el = document.createElement('input');
          el.type = 'radio';
          el.name = 'adf_' + f.name;
          el.checked = values[f.name] === f.exportValue;
          el.addEventListener('change', function () {
            if (el.checked) values[f.name] = f.exportValue;
            X.updateMeta();
          });
        } else if (f.type === 'Ch') {
          el = document.createElement('select');
          el.innerHTML = '<option value=""></option>' + f.options.map(function (o) {
            return '<option value="' + X.esc(o.v) + '">' + X.esc(o.l) + '</option>';
          }).join('');
          el.value = values[f.name] || '';
          el.addEventListener('change', function () { values[f.name] = el.value; X.updateMeta(); });
        } else if (f.type === 'Sig') {
          el = document.createElement('button');
          el.type = 'button';
          el.className = 'sigslot';
          el.textContent = 'Sign here';
          el.addEventListener('click', function () { openSign(it, f); });
        } else {
          el = document.createElement(f.multiline ? 'textarea' : 'input');
          if (!f.multiline) el.type = 'text';
          if (f.maxLen) el.maxLength = f.maxLen;
          el.value = values[f.name] || '';
          el.addEventListener('input', function () { values[f.name] = el.value; });
          el.addEventListener('change', X.updateMeta);
        }

        el.classList.add('ffield');
        el.title = f.name + (f.readOnly ? ' (read only)' : '');
        if (f.readOnly) el.disabled = true;
        el.style.left = x + 'px'; el.style.top = y + 'px';
        el.style.width = w + 'px'; el.style.height = h + 'px';
        if (el.tagName !== 'BUTTON' && el.type !== 'checkbox' && el.type !== 'radio') {
          el.style.fontSize = Math.max(7, Math.min(h * 0.68, (f.fontSize || 0) * S.scale || h * 0.68)) + 'px';
        }
        host.appendChild(el);
      });
    }

    const isOn = E.isOn;

    function paintAll() { S.items.forEach(paintFields); }

    $('btnFields').addEventListener('click', function () {
      showFields = !showFields;
      $('btnFields').classList.toggle('on', showFields);
      paintAll();
      X.toast(showFields ? 'Fields shown' : 'Fields hidden');
    });

    $('btnFormClear').addEventListener('click', function () {
      values = {};
      paintAll();
      X.toast('Every field cleared');
    });

    /* ---------------- signatures ---------------- */

    const sigModal = document.createElement('div');
    sigModal.className = 'sigmodal'; sigModal.id = 'sigModal'; sigModal.hidden = true;
    sigModal.innerHTML =
      '<div class="sigbox" role="dialog" aria-modal="true" aria-label="Add a signature">' +
      '<header><b id="sigTitle">Add your signature</b><span class="grow"></span>' +
      '<button class="x" id="sigClose" aria-label="Close">&times;</button></header>' +
      '<div class="sigtabs">' +
      '<button class="on" data-m="draw">Draw</button>' +
      '<button data-m="type">Type</button>' +
      '<button data-m="upload">Upload</button>' +
      '</div>' +
      '<div class="sigpane" id="sigDraw">' +
      '<canvas id="sigCanvas" width="620" height="200"></canvas>' +
      '<p class="sighint">Draw with a mouse, a finger or a stylus.</p>' +
      '</div>' +
      '<div class="sigpane" id="sigType" hidden>' +
      '<input id="sigName" placeholder="Type your name" autocomplete="name">' +
      '<div class="sigfonts" id="sigFonts"></div>' +
      '</div>' +
      '<div class="sigpane" id="sigUpload" hidden>' +
      '<input type="file" id="sigFile" accept="image/*">' +
      '<p class="sighint">A PNG with a transparent background looks best.</p>' +
      '<div class="sigprev" id="sigPrev"></div>' +
      '</div>' +
      '<div class="sigcolors">' +
      '<span class="anno-lbl">Ink</span>' +
      '<button class="sw on" data-c="#1B2A4A" style="background:#1B2A4A"></button>' +
      '<button class="sw" data-c="#0B0B0B" style="background:#0B0B0B"></button>' +
      '<button class="sw" data-c="#123C8C" style="background:#123C8C"></button>' +
      '</div>' +
      '<footer>' +
      '<label class="sigsave"><input type="checkbox" id="sigRemember" checked> Remember on this device</label>' +
      '<span class="grow"></span>' +
      '<button class="btn" id="sigClear">Clear</button>' +
      '<button class="btn primary" id="sigApply" disabled>Place</button>' +
      '</footer></div>';
    document.body.appendChild(sigModal);

    const SIG_FONTS = [
      { n: 'Brush', css: '"Segoe Script","Bradley Hand","Lucida Handwriting",cursive' },
      { n: 'Formal', css: '"Palatino Linotype","Book Antiqua",Georgia,serif' },
      { n: 'Plain', css: '"Segoe UI",Helvetica,Arial,sans-serif' }
    ];
    let sigMode = 'draw', sigInk = '#1B2A4A', sigFont = SIG_FONTS[0];
    let sigData = null;          /* dataURL of the signature about to be placed */
    let sigTarget = null;        /* {it, field} when a Sig widget asked for it */
    let sigKind = 'sig';         /* sig | initials */

    $('sigFonts').innerHTML = SIG_FONTS.map(function (f, i) {
      return '<button data-f="' + i + '"' + (i === 0 ? ' class="on"' : '') +
        ' style="font-family:' + f.css + '">Signature</button>';
    }).join('');

    const cv = $('sigCanvas');
    const cx = cv.getContext('2d');
    let drawing = false, inked = false;

    function cvPoint(e) {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)];
    }
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      drawing = true; inked = true;
      const p = cvPoint(e);
      cx.beginPath(); cx.moveTo(p[0], p[1]);
      cx.lineWidth = 3.2; cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.strokeStyle = sigInk;
      syncApply();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      const p = cvPoint(e);
      cx.lineTo(p[0], p[1]); cx.stroke();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      cv.addEventListener(ev, function () { drawing = false; });
    });

    function clearCanvas() { cx.clearRect(0, 0, cv.width, cv.height); inked = false; syncApply(); }

    sigModal.querySelector('.sigtabs').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      sigMode = b.dataset.m;
      Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.toggle('on', x === b); });
      $('sigDraw').hidden = sigMode !== 'draw';
      $('sigType').hidden = sigMode !== 'type';
      $('sigUpload').hidden = sigMode !== 'upload';
      syncApply();
    });
    $('sigFonts').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      sigFont = SIG_FONTS[+b.dataset.f];
      Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.toggle('on', x === b); });
      syncApply();
    });
    sigModal.querySelector('.sigcolors').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      sigInk = b.dataset.c;
      Array.prototype.forEach.call(b.parentNode.querySelectorAll('.sw'), function (x) {
        x.classList.toggle('on', x === b);
      });
      $('sigFonts').style.color = sigInk;
      syncApply();
    });
    $('sigName').addEventListener('input', syncApply);
    $('sigClear').addEventListener('click', function () {
      clearCanvas(); $('sigName').value = ''; $('sigPrev').innerHTML = '';
      uploaded = null; syncApply();
    });
    $('sigClose').addEventListener('click', closeSign);
    sigModal.addEventListener('mousedown', function (e) {
      if (e.target === sigModal) closeSign();
    });

    let uploaded = null;
    $('sigFile').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () {
        uploaded = r.result;
        $('sigPrev').innerHTML = '<img src="' + uploaded + '" alt="Signature preview">';
        syncApply();
      };
      r.readAsDataURL(f);
    });

    function syncApply() {
      let ok = false;
      if (sigMode === 'draw') ok = inked;
      if (sigMode === 'type') ok = !!$('sigName').value.trim();
      if (sigMode === 'upload') ok = !!uploaded;
      $('sigApply').disabled = !ok;
    }

    /* Render the typed name onto a canvas so every mode ends in the same
       place: a PNG we can embed straight into the PDF. */
    function typedToPng(text) {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 260;
      const g = c.getContext('2d');
      const size = 120;
      g.font = size + 'px ' + sigFont.css;
      g.fillStyle = sigInk;
      g.textBaseline = 'middle';
      const w = g.measureText(text).width;
      const k = Math.min(1, (c.width - 40) / Math.max(1, w));
      g.translate(20, c.height / 2);
      g.scale(k, k);
      g.fillText(text, 0, 0);
      return c.toDataURL('image/png');
    }

    /* Crop the transparent margin off so the placed signature is tight. */
    function trimPng(dataUrl) {
      return new Promise(function (res) {
        const img = new Image();
        img.onload = function () {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          let d;
          try { d = g.getImageData(0, 0, c.width, c.height).data; }
          catch (e) { res({ url: dataUrl, w: img.width, h: img.height }); return; }
          let x1 = c.width, y1 = c.height, x2 = -1, y2 = -1;
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              if (d[(y * c.width + x) * 4 + 3] > 12) {
                if (x < x1) x1 = x; if (x > x2) x2 = x;
                if (y < y1) y1 = y; if (y > y2) y2 = y;
              }
            }
          }
          if (x2 < 0) { res({ url: dataUrl, w: img.width, h: img.height }); return; }
          const pad = 6;
          x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad);
          x2 = Math.min(c.width - 1, x2 + pad); y2 = Math.min(c.height - 1, y2 + pad);
          const o = document.createElement('canvas');
          o.width = x2 - x1 + 1; o.height = y2 - y1 + 1;
          o.getContext('2d').drawImage(c, x1, y1, o.width, o.height, 0, 0, o.width, o.height);
          res({ url: o.toDataURL('image/png'), w: o.width, h: o.height });
        };
        img.onerror = function () { res(null); };
        img.src = dataUrl;
      });
    }

    let sigReplace = null;       /* {it, shape} when a placed one is being changed */

    function openSign(it, field, kind, replacing) {
      /* the Sign and Initials buttons toggle their own modal */
      if (!replacing) sigReplace = null;
      if (!sigModal.hidden && !it && !replacing && (kind || 'sig') === sigKind) { closeSign(); return; }
      sigTarget = it ? { it: it, field: field } : null;
      sigKind = kind || 'sig';
      $('sigTitle').textContent = sigKind === 'initials' ? 'Add your initials' : 'Add your signature';
      sigModal.hidden = false;
      const saved = remembered();
      if (saved && !inked) {
        $('sigPrev').innerHTML = '<img src="' + saved + '" alt="Saved signature">';
        uploaded = saved;
      }
      syncApply();
    }
    function closeSign() { sigModal.hidden = true; sigTarget = null; sigReplace = null; }

    function remembered() {
      try { return localStorage.getItem('adddots.sig.' + sigKind) || null; }
      catch (e) { return null; }
    }
    function remember(url) {
      try { localStorage.setItem('adddots.sig.' + sigKind, url); } catch (e) {}
    }

    $('sigApply').addEventListener('click', async function () {
      let raw = null;
      if (sigMode === 'draw') raw = cv.toDataURL('image/png');
      if (sigMode === 'type') raw = typedToPng($('sigName').value.trim());
      if (sigMode === 'upload') raw = uploaded;
      if (!raw) return;
      const trimmed = await trimPng(raw);
      if (!trimmed) { X.toast('That image could not be read'); return; }
      sigData = trimmed;
      if ($('sigRemember').checked) remember(trimmed.url);

      if (sigReplace) {
        replaceSig(sigReplace.it, sigReplace.shape, trimmed);
      } else if (sigTarget) {
        placeInField(sigTarget.it, sigTarget.field, trimmed);
      } else {
        placeOnPage(trimmed);
      }
      closeSign();
    });

    function placeInField(it, field, img) {
      X.snapshot();
      const w = field.rect[2] - field.rect[0], h = field.rect[3] - field.rect[1];
      const k = Math.min(w / img.w, h / img.h);
      const dw = img.w * k, dh = img.h * k;
      it.shapes.push({
        t: 'sig', id: 'sig' + Date.now().toString(36), kind: sigKind,
        url: img.url, iw: img.w, ih: img.h,
        a: [field.rect[0] + (w - dw) / 2, field.rect[1] + (h - dh) / 2],
        b: [field.rect[0] + (w + dw) / 2, field.rect[1] + (h + dh) / 2]
      });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.toast('Signature placed');
    }

    /* the new picture where the old one was: same height and centre, its
       own width; turn, opacity and the rest stay */
    function replaceSig(it, s, img) {
      if (it.shapes.indexOf(s) < 0) return;
      X.snapshot();
      const x1 = Math.min(s.a[0], s.b[0]), x2 = Math.max(s.a[0], s.b[0]);
      const y1 = Math.min(s.a[1], s.b[1]), y2 = Math.max(s.a[1], s.b[1]);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, h = y2 - y1, w = h * img.w / img.h;
      s.url = img.url; s.iw = img.w; s.ih = img.h;
      delete s.ink; delete s.free;
      s.a = [cx - w / 2, cy - h / 2]; s.b = [cx + w / 2, cy + h / 2];
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.toast('Signature changed');
    }

    /* Nothing goes on the page until you say where, as in Acrobat and WPS:
       after Place the signature is in hand, and a click puts it there at its
       usual size (centred on the click), or a drag draws the box it fills. */
    let sigHand = null;          /* { img, kind } while the tool is in hand */
    let sigPress = null;         /* { it, from } between press and release */
    function sigBox(it, from, to, img) {
      if (!to) {
        const v = it.page.view, pw = v[2] - v[0];
        const w = Math.min(pw * 0.34, 210), h = w * img.h / img.w;
        return [[from[0] - w / 2, from[1] - h / 2], [from[0] + w / 2, from[1] + h / 2]];
      }
      /* the dragged box, with the signature's own proportions: its width
         decides, the height follows, growing the way the drag went */
      const w = Math.abs(to[0] - from[0]), h = w * img.h / img.w;
      const x = Math.min(from[0], to[0]);
      const y = to[1] >= from[1] ? from[1] : from[1] - h;
      return [[x, y], [x + w, y + h]];
    }
    function sigShape(box) {
      return {
        t: 'sig', id: 'sig' + Date.now().toString(36), kind: sigHand.kind,
        url: sigHand.img.url, iw: sigHand.img.w, ih: sigHand.img.h, a: box[0], b: box[1]
      };
    }
    X.hints.sigplace = 'Click on the page where the signature goes, or drag to draw its size.';
    X.toolBtn.sigplace = 'btnSign';
    X.tools.sigplace = {
      down: function (it, at, e) {
        if (!sigHand || !it.page) return;
        try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* a mouse works without it */ }
        sigPress = { it: it, from: it.vp.convertToPdfPoint(at[0], at[1]), x: e.clientX, y: e.clientY, drag: false };
      },
      move: function (it, at, e) {
        if (!sigPress || sigPress.it !== it) return;
        if (!sigPress.drag && Math.hypot(e.clientX - sigPress.x, e.clientY - sigPress.y) < 6) return;
        sigPress.drag = true;
        const to = it.vp.convertToPdfPoint(at[0], at[1]);
        X.drawShapes(it, sigShape(sigBox(it, sigPress.from, to, sigHand.img)));
      },
      up: function (it, at) {
        const p = sigPress; sigPress = null;
        if (!p || p.it !== it || !sigHand) return;
        const to = p.drag ? it.vp.convertToPdfPoint(at[0], at[1]) : null;
        let box = sigBox(it, p.from, to, sigHand.img);
        /* a drag too small to see is taken as a click */
        if (to && Math.abs(box[1][0] - box[0][0]) < 12) box = sigBox(it, p.from, null, sigHand.img);
        X.snapshot();
        it.shapes.push(sigShape(box));
        sigHand = null;
        X.setTool('select');
        S.sel = { it: it, i: it.shapes.length - 1 };
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
        X.toast('Signature placed');
      },
      cancel: function (it) { sigPress = null; if (it) X.drawShapes(it); }
    };
    X.on('tool', function (t) { if (t !== 'sigplace') { sigHand = null; sigPress = null; } });

    function placeOnPage(img) {
      const it = S.items[S.current - 1];
      if (!it || !it.page) { X.toast('Open a page first'); return; }
      sigHand = { img: img, kind: sigKind };
      X.setTool('sigplace');
      X.toast('Click where the signature goes, or drag to size it');
    }

    $('btnSign').addEventListener('click', function () {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      openSign(null, null, 'sig');
    });
    $('btnInitials').addEventListener('click', function () {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      openSign(null, null, 'initials');
    });

    /* ---------------- the signature as a mark ---------------- */

    /* Placed, it is a mark like a picture, as in Acrobat and WPS: drag it,
       pull a corner to scale it (its proportions held; Shift frees them),
       turn it by the round grip, and the properties panel changes the rest. */
    X.handleKind.sig = 'rect';
    X.keepRatio.sig = function (s) { return !s.free; };

    X.shapeRenderers.sig = function (it, s, vp, idx) {
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      const g = document.createElementNS(X.SVGNS, 'g');
      g.setAttribute('class', 'sig-mk');
      if (s.r) {
        const mid = X.shapeMid(s);
        g.setAttribute('transform', 'rotate(' + X.dirAngle(vp, mid[0], mid[1], s.r) + ',' + (x + w / 2) + ',' + (y + h / 2) + ')');
      }
      const im = document.createElementNS(X.SVGNS, 'image');
      im.setAttribute('x', x); im.setAttribute('y', y);
      im.setAttribute('width', w); im.setAttribute('height', h);
      im.setAttribute('preserveAspectRatio', 'none');
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', s.url);
      im.setAttribute('href', s.url);
      if (s.o != null) im.setAttribute('opacity', s.o);
      g.appendChild(im);
      g.style.pointerEvents = 'all';
      if (idx >= 0) g.addEventListener('pointerdown', function (e) { X.beginDrag(it, idx, e, 'move'); });
      return g;
    };

    /* ink colours a placed signature can be switched to */
    const SIG_INKS = ['#0B0B0B', '#1B2A4A', '#123C8C', '#B3261E'];

    /* every dark pixel of the picture in the new ink, its edges kept soft */
    function recolour(url, hex) {
      return new Promise(function (res) {
        const img = new Image();
        img.onload = function () {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          let d;
          try { d = g.getImageData(0, 0, c.width, c.height); } catch (e) { res(null); return; }
          const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
          const px = d.data;
          for (let i = 0; i < px.length; i += 4) {
            if (!px[i + 3]) continue;
            px[i] = r; px[i + 1] = gg; px[i + 2] = bb;
          }
          g.putImageData(d, 0, 0);
          res(c.toDataURL('image/png'));
        };
        img.onerror = function () { res(null); };
        img.src = url;
      });
    }

    function selSig() {
      if (!S.sel) return null;
      const s = S.sel.it.shapes[S.sel.i];
      return s && s.t === 'sig' ? s : null;
    }
    function sigEdit(fn) {
      const s = selSig(); if (!s) return;
      X.snapshot();
      fn(s);
      const it = S.sel.it;
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
    }

    (function () {
      const el = document.createElement('div');
      el.className = 'sigprops';
      el.innerHTML =
        '<div class="row" style="gap:6px"><button class="btn" id="mpSigChange" style="flex:1">Change…</button>' +
        '<button class="btn" id="mpSigAll" style="flex:1" title="Put a copy in the same place on every other page">All pages</button></div>' +
        '<div class="row sigink"><span class="anno-lbl">Ink</span>' +
        SIG_INKS.map(function (c) {
          return '<button class="sw" data-ink="' + c + '" style="background:' + c + '" title="Ink ' + c + '"></button>';
        }).join('') + '</div>' +
        '<div class="row" style="gap:6px">' +
        '<button class="btn" id="mpSigLock" style="flex:1" title="Corners keep the proportions (Shift does the opposite)">Keep proportions</button>' +
        '<button class="btn" id="mpSigReset" style="flex:1" title="Back to the signature\'s own proportions">Original shape</button></div>';
      X.markPop.sig = {
        el: el,
        sync: function (s) {
          el.querySelector('#mpSigLock').classList.toggle('on', !s.free);
          Array.prototype.forEach.call(el.querySelectorAll('[data-ink]'), function (b) {
            b.classList.toggle('on', (s.ink || '') === b.dataset.ink);
          });
        }
      };
      el.addEventListener('click', function (e) { e.stopPropagation(); });
      el.querySelector('#mpSigLock').addEventListener('click', function () {
        sigEdit(function (s) { if (s.free) delete s.free; else s.free = true; });
        X.markPop.sig.sync(selSig());
      });
      el.querySelector('#mpSigReset').addEventListener('click', function () {
        sigEdit(function (s) {
          if (!s.iw || !s.ih) return;
          const bx = { x1: Math.min(s.a[0], s.b[0]), y1: Math.min(s.a[1], s.b[1]), x2: Math.max(s.a[0], s.b[0]), y2: Math.max(s.a[1], s.b[1]) };
          const cx = (bx.x1 + bx.x2) / 2, cy = (bx.y1 + bx.y2) / 2;
          const w = bx.x2 - bx.x1, h = w * s.ih / s.iw;
          s.a = [cx - w / 2, cy - h / 2]; s.b = [cx + w / 2, cy + h / 2];
        });
      });
      el.querySelector('.sigink').addEventListener('click', async function (e) {
        const b = e.target.closest('[data-ink]'); if (!b) return;
        const s = selSig(); if (!s) return;
        const url = await recolour(s.url, b.dataset.ink);
        if (!url) { X.toast('That signature could not be recoloured'); return; }
        sigEdit(function (m) { m.url = url; m.ink = b.dataset.ink; });
        X.markPop.sig.sync(selSig());
      });
      el.querySelector('#mpSigChange').addEventListener('click', function () {
        const s = selSig(); if (!s) return;
        sigReplace = { it: S.sel.it, shape: s };
        openSign(null, null, s.kind || 'sig', true);
      });
      el.querySelector('#mpSigAll').addEventListener('click', function () {
        const s = selSig(); if (!s) return;
        const from = S.sel.it;
        X.snapshot();
        let n = 0;
        S.items.forEach(function (it) {
          if (it === from) return;
          /* not twice in the same place on a page that already has it */
          if (it.shapes.some(function (m) { return m.t === 'sig' && m.url === s.url && m.a[0] === s.a[0] && m.a[1] === s.a[1]; })) return;
          const c = JSON.parse(JSON.stringify(s));
          c.id = 'sig' + Date.now().toString(36) + (n++);
          it.shapes.push(c);
          if (it.anno) X.drawShapes(it);
          X.drawThumb(it);
        });
        X.updateMeta();
        X.toast(n ? 'Signature added to <b>' + n + '</b> more page' + (n === 1 ? '' : 's') + ' · <b>Ctrl+Z</b> to undo'
                  : 'Every page already has it');
      });
    })();

    /* ---------------- writing the filled values into the PDF ---------------- */

    /* Values are painted onto the rebuilt page by the engine
       (packages/engine/src/painters/fields.ts), read at save time; signatures
       are embedded and painted there too (E.saveHooks). */
    X.saveState.values = function () { return values; };

    function hasValue(f) { return E.hasValue(f, values); }

    /* ---------------- flatten ---------------- */

    $('btnFlatten').addEventListener('click', function () {
      const filled = S.items.reduce(function (n, it) {
        return n + (it.fields || []).filter(hasValue).length;
      }, 0);
      const sigs = S.items.reduce(function (n, it) {
        return n + it.shapes.filter(function (s) { return s.t === 'sig'; }).length;
      }, 0);
      X.toast(filled || sigs
        ? 'Saving flattens <b>' + filled + '</b> field' + (filled === 1 ? '' : 's') +
          ' and <b>' + sigs + '</b> signature' + (sigs === 1 ? '' : 's') + ' into the page'
        : 'Nothing to flatten yet — fill a field or add a signature first');
    });

    /* ---------------- keep in step with the viewer ---------------- */

    let repaintTimer = null;
    function repaintSoon() {
      clearTimeout(repaintTimer);
      repaintTimer = setTimeout(paintAll, 60);
    }
    /* the controls are positioned in viewport pixels, so any zoom or rotate
       has to move them too */
    window.addEventListener('resize', repaintSoon);
    $('stage').addEventListener('scroll', function () { /* positions are page-relative */ }, { passive: true });

    const origRelayout = X.relayout;
    X.relayout = function () {
      return origRelayout.apply(null, arguments).then(function (r) { repaintSoon(); return r; });
    };

    X.on('pages', function () {
      scanSoon().then(repaintSoon);
    });
    X.on('reset', function () {
      values = {};
      S.items.forEach(function (it) { it.fields = null; it.formLayer = null; });
      const c = $('fieldCount'); c.hidden = true; c.textContent = '';
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (e.key === 'Escape' && !sigModal.hidden) { closeSign(); return; }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's' && S.items.length) {
        e.preventDefault(); openSign(null, null, 'sig');
      }
    });

    scanAll();
    X.forms = {
      values: function () { return values; },
      scan: scanAll,
      paint: paintAll,
      openSign: openSign,
      hasValue: hasValue
    };
  });
})();
