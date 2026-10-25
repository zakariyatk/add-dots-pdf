/* Add Dots PDF — Insert
   ----------------------
   Image, video, link and table marks. Each is an ordinary rectangular mark —
   an a/b box in PDF points, same as a rectangle shape — so the existing
   move, resize, rotate, undo, save and PDF export machinery in core.js
   already works for them with no changes there. This file only supplies
   how each type draws on screen, how it exports, and the popovers that
   create one.

   Reuses the mark-properties popover (EXT.markPop) for a border colour and
   width on the box types, and the same "type into a floating box" pattern
   the text tool uses (openEditor in core.js) for editing a table's cells. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[insert] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, PDFLib = X.PDFLib, SVGNS = X.SVGNS;

    /* the tab and panel are static markup (same pattern as Page), but the
       ribbon only wires up tabs it knows about — this is what makes
       clicking "Insert" actually show panInsert */
    X.addRibbonTab('ribInsert', 'panInsert');

    function currentItem() {
      const it = S.items[S.current - 1];
      return (it && it.page) ? it : null;
    }

    /* a sensible default box for a freshly inserted mark: about two fifths
       of the page wide, centred either on the page or on an explicit point
       (where the user clicked to place it) */
    function centeredBox(it, aspect, center) {
      const v = it.page.view, pw = v[2] - v[0], ph = v[3] - v[1];
      const w = Math.min(pw * 0.42, 260);
      const h = aspect ? w / aspect : w * 0.62;
      const cx = center ? center[0] : v[0] + pw / 2;
      const cy = center ? center[1] : v[1] + ph / 2;
      return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]];
    }

    /* arm-then-click placement, the same idea as the Pin tool: a popover
       collects what to place, then the next click on the page says where.
       fn(it, centerPt) builds and places the shape at that point. */
    function armPlacement(toolName, hint, fn) {
      X.hints[toolName] = hint;
      X.tools[toolName] = {
        down: function (it, at) {
          const c = it.vp.convertToPdfPoint(at[0], at[1]);
          fn(it, c);
          X.setTool('select');
        }
      };
      X.setTool(toolName);
      X.toast(hint);
    }

    function placeShape(it, s) {
      X.snapshot();
      it.shapes.push(s);
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.setTool('select');
      S.sel = { it: it, i: it.shapes.length - 1 };
      X.drawShapes(it);
    }

    function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    function readImageFile(file) {
      return new Promise(function (resolve, reject) {
        const fr = new FileReader();
        fr.onload = function () {
          const img = new Image();
          img.onload = function () { resolve({ url: fr.result, w: img.naturalWidth || 1, h: img.naturalHeight || 1 }); };
          img.onerror = function () { reject(new Error('bad image')); };
          img.src = fr.result;
        };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(file);
      });
    }

    function blobToDataUrl(blob) {
      return new Promise(function (resolve, reject) {
        const fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(blob);
      });
    }

    /* the angle a box-style mark reads as on screen — same maths textEl uses,
       applied once to the whole group instead of per line */
    function boxAngle(vp, s) {
      if (!s.r) return 0;
      const mid = X.shapeMid(s);
      return X.dirAngle(vp, mid[0], mid[1], s.r);
    }
    function boxViewport(vp, s) {
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      return {
        x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
        w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]),
        cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2
      };
    }
    function applyBoxTransform(g, vp, s, box) {
      const ang = boxAngle(vp, s);
      if (ang) g.setAttribute('transform', 'rotate(' + ang + ',' + box.cx + ',' + box.cy + ')');
    }
    function boxBorderEl(box, s) {
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', box.x); r.setAttribute('y', box.y);
      r.setAttribute('width', box.w); r.setAttribute('height', box.h);
      r.setAttribute('fill', 'none');
      r.style.stroke = s.c; r.style.strokeWidth = Math.max(0.6, (s.w || 0) * S.scale);
      return r;
    }
    /* click without drag. The press selects the mark, redraws it and takes
       the pointer for the drag, so neither a click nor the release ever
       reaches this element: the release is watched for once, on the window,
       and one close to the press is the click. */
    function moveAndClick(g, it, idx, onClick) {
      g.style.pointerEvents = 'all';
      if (idx < 0) return;
      g.addEventListener('pointerdown', function (e) {
        /* where in the mark it was pressed, as fractions of its box (before
           the drag redraws it): the selection bar can shift the page before
           the release */
        const r = g.getBoundingClientRect();
        X.beginDrag(it, idx, e, 'move');
        if (!onClick || e.button !== 0 || S.tool !== 'select') return;
        const x = e.clientX, y = e.clientY;
        const at = { fx: (x - r.left) / (r.width || 1), fy: (y - r.top) / (r.height || 1) };
        window.addEventListener('pointerup', function up(ev) {
          window.removeEventListener('pointerup', up, true);
          if (S.tool !== 'select' || Math.hypot(ev.clientX - x, ev.clientY - y) > 4) return;
          setTimeout(function () { onClick(at); }, 0);   /* after the drag has let go */
        }, true);
      });
    }

    /* rotate a box corner about the box's own centre for export, the same
       way core.js rotates a text patch about its anchor */

    /* ================= shared image cache (image + video poster) ================= */
    /* pictures, video posters and the link and table fonts are embedded,
       and all four marks painted, by the engine */

    /* ================= IMAGE ================= */
    X.handleKind.image = 'rect';

    X.shapeRenderers.image = function (it, s, vp, idx) {
      const box = boxViewport(vp, s);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'ins-mk');
      applyBoxTransform(g, vp, s, box);
      const im = document.createElementNS(SVGNS, 'image');
      im.setAttribute('x', box.x); im.setAttribute('y', box.y);
      im.setAttribute('width', box.w); im.setAttribute('height', box.h);
      im.setAttribute('preserveAspectRatio', 'none');
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', s.url);
      im.setAttribute('href', s.url);
      g.appendChild(im);
      if (s.w) g.appendChild(boxBorderEl(box, s));
      moveAndClick(g, it, idx, null);
      return g;
    };

    function placeImage(url, iw, ih, it, center) {
      it = it || currentItem();
      if (!it) { X.toast('Open a PDF first'); return; }
      const box = centeredBox(it, iw / ih, center);
      placeShape(it, { t: 'image', id: uid('img'), url: url, iw: iw, ih: ih, a: box[0], b: box[1], c: '#1C1F24', w: 0 });
      X.toast(center ? 'Image placed' : 'Image placed — drag it into position, or crop it from the properties panel');
    }
    function armImage(url, iw, ih) {
      armPlacement('insimg', 'Click where the image should go', function (it, c) { placeImage(url, iw, ih, it, c); });
    }

    /* device picker */
    $('btnInsImage').addEventListener('click', function () { X.togglePop('insImgPop', $('btnInsImage')); });
    X.registerPop('insImgPop', 'btnInsImage');
    $('insImgDevice').addEventListener('click', function () { $('insImgIn').click(); });
    $('insImgIn').addEventListener('change', function () {
      const f = this.files && this.files[0]; this.value = '';
      if (!f) return;
      readImageFile(f).then(function (img) { X.closePops(true); armImage(img.url, img.w, img.h); })
        .catch(function () { X.toast('Could not read that image'); });
    });

    /* online picture search — Openverse: free, openly-licensed, no sign-in */
    let imgSearchTimer = null, imgSearchSeq = 0;
    function renderImgResults(items, msg) {
      const host = $('insImgResults');
      if (msg) { host.innerHTML = '<div class="msg">' + X.esc(msg) + '</div>'; return; }
      host.innerHTML = '';
      items.forEach(function (r) {
        const b = document.createElement('button');
        b.type = 'button'; b.title = r.title || 'Insert this picture';
        const img = document.createElement('img');
        img.src = r.thumb; img.alt = r.title || '';
        img.loading = 'lazy';
        b.appendChild(img);
        b.addEventListener('click', function () {
          b.disabled = true;
          fetch(r.full).then(function (res) { if (!res.ok) throw new Error('fetch'); return res.blob(); })
            .then(function (blob) {
              return blobToDataUrl(blob).then(function (url) {
                const probe = new Image();
                probe.onload = function () { X.closePops(true); armImage(url, probe.naturalWidth || 1, probe.naturalHeight || 1); };
                probe.onerror = function () { X.toast('Could not load that picture'); };
                probe.src = url;
              });
            })
            .catch(function () { X.toast('Could not fetch that picture'); b.disabled = false; });
        });
        host.appendChild(b);
      });
      if (!items.length) renderImgResults([], 'No results');
    }
    $('insImgSearch').addEventListener('input', function () {
      const q = this.value.trim();
      clearTimeout(imgSearchTimer);
      if (!q) { $('insImgResults').innerHTML = ''; return; }
      const seq = ++imgSearchSeq;
      imgSearchTimer = setTimeout(function () {
        renderImgResults([], 'Searching…');
        fetch('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) + '&page_size=12&mature=false')
          .then(function (r) { if (!r.ok) throw new Error('search failed'); return r.json(); })
          .then(function (data) {
            if (seq !== imgSearchSeq) return;
            const items = (data.results || []).map(function (x) {
              return { title: x.title, thumb: x.thumbnail || x.url, full: x.url };
            });
            renderImgResults(items);
          })
          .catch(function () { if (seq === imgSearchSeq) renderImgResults([], 'Search unavailable — check your connection'); });
      }, 450);
    });
    $('insImgSearch').addEventListener('keydown', function (e) { e.stopPropagation(); });

    /* ---- crop: bake a sub-rectangle into a fresh image, in place ---- */
    let cropModal = null, cropState = null;
    function buildCropModal() {
      if (cropModal) return cropModal;
      const m = document.createElement('div');
      m.className = 'sigmodal'; m.id = 'cropModal'; m.hidden = true;
      m.innerHTML =
        '<div class="sigbox" role="dialog" aria-modal="true" aria-label="Crop image">' +
        '<header><b>Crop image</b><span class="grow"></span><button class="x" id="cropClose" aria-label="Cancel">&times;</button></header>' +
        '<div id="cropStage"><img id="cropSrcImg" alt=""><div id="cropBox"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div></div>' +
        '<footer><span class="grow"></span><button class="btn" id="cropCancelBtn">Cancel</button>' +
        '<button class="btn primary" id="cropApplyBtn">Apply crop</button></footer></div>';
      document.body.appendChild(m);
      cropModal = m;
      function close() { m.hidden = true; cropState = null; }
      $('cropClose').addEventListener('click', close);
      $('cropCancelBtn').addEventListener('click', close);
      m.addEventListener('click', function (e) { if (e.target === m) close(); });
      document.addEventListener('keydown', function (e) { if (!m.hidden && e.key === 'Escape') close(); });

      const box = $('cropBox');
      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function drag(mode) {
        return function (e) {
          e.preventDefault(); e.stopPropagation();
          const img = $('cropSrcImg');
          const stageR = img.getBoundingClientRect();
          const st = cropState;
          function move(ev) {
            const x = clamp(ev.clientX, stageR.left, stageR.right) - stageR.left;
            const y = clamp(ev.clientY, stageR.top, stageR.bottom) - stageR.top;
            if (mode === 'move') {
              const w = st.x2 - st.x1, h = st.y2 - st.y1;
              const dx = x - st.gx, dy = y - st.gy;
              st.x1 = clamp(st.ox1 + dx, 0, stageR.width - w); st.x2 = st.x1 + w;
              st.y1 = clamp(st.oy1 + dy, 0, stageR.height - h); st.y2 = st.y1 + h;
            } else {
              if (mode.indexOf('l') >= 0) st.x1 = clamp(x, 0, st.x2 - 24);
              if (mode.indexOf('r') >= 0) st.x2 = clamp(x, st.x1 + 24, stageR.width);
              if (mode.indexOf('t') >= 0) st.y1 = clamp(y, 0, st.y2 - 24);
              if (mode.indexOf('b') >= 0) st.y2 = clamp(y, st.y1 + 24, stageR.height);
            }
            paint();
          }
          function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); }
          if (mode === 'move') {
            st.gx = clamp(e.clientX, stageR.left, stageR.right) - stageR.left;
            st.gy = clamp(e.clientY, stageR.top, stageR.bottom) - stageR.top;
            st.ox1 = st.x1; st.oy1 = st.y1;
          }
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        };
      }
      function paint() {
        const st = cropState; if (!st) return;
        box.style.left = st.x1 + 'px'; box.style.top = st.y1 + 'px';
        box.style.width = (st.x2 - st.x1) + 'px'; box.style.height = (st.y2 - st.y1) + 'px';
      }
      box.addEventListener('pointerdown', drag('move'));
      box.querySelector('.tl').addEventListener('pointerdown', drag('tl'));
      box.querySelector('.tr').addEventListener('pointerdown', drag('tr'));
      box.querySelector('.bl').addEventListener('pointerdown', drag('bl'));
      box.querySelector('.br').addEventListener('pointerdown', drag('br'));
      cropModal._paint = paint;

      $('cropApplyBtn').addEventListener('click', function () {
        const st = cropState, s = st && st.shape; if (!st || !s) return;
        const img = $('cropSrcImg');
        const kx = img.naturalWidth / img.clientWidth, ky = img.naturalHeight / img.clientHeight;
        const sx = Math.round(st.x1 * kx), sy = Math.round(st.y1 * ky);
        const sw = Math.max(1, Math.round((st.x2 - st.x1) * kx)), sh = Math.max(1, Math.round((st.y2 - st.y1) * ky));
        const cv = document.createElement('canvas');
        cv.width = sw; cv.height = sh;
        cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const url = cv.toDataURL('image/png');
        X.snapshot();
        s.url = url; s.iw = sw; s.ih = sh;
        X.drawShapes(st.it); X.drawThumb(st.it); X.updateMeta();
        close();
        X.toast('Crop applied');
      });
      return m;
    }
    function openCropModal(it, s) {
      const m = buildCropModal();
      $('cropSrcImg').src = s.url;
      m.hidden = false;
      const img = $('cropSrcImg');
      function ready() {
        const r = img.getBoundingClientRect();
        cropState = { it: it, shape: s, x1: r.width * 0.08, y1: r.height * 0.08, x2: r.width * 0.92, y2: r.height * 0.92 };
        cropModal._paint();
      }
      if (img.complete) ready(); else img.onload = ready;
    }

    /* the border/crop controls that show on the properties popover when an
       image mark is selected — the same extension point a dimension tool
       would use for its own scale control */
    (function () {
      const el = document.createElement('div');
      el.innerHTML = '<button class="btn" id="mpCropImg" style="width:100%">Crop image…</button>';
      X.markPop.image = {
        el: el,
        sync: function () { /* nothing to reflect — border colour/width already ride mpStroke/mpWidth */ }
      };
      el.querySelector('#mpCropImg').addEventListener('click', function (e) {
        e.stopPropagation();
        if (!S.sel) return;
        const s = S.sel.it.shapes[S.sel.i];
        if (s && s.t === 'image') openCropModal(S.sel.it, s);
      });
    })();

    /* ================= VIDEO ================= */
    X.handleKind.video = 'rect';

    function playIconPath(box) {
      const s = Math.min(box.w, box.h) * 0.28;
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      return [[cx - s * 0.5, cy - s * 0.62], [cx - s * 0.5, cy + s * 0.62], [cx + s * 0.75, cy]];
    }
    X.shapeRenderers.video = function (it, s, vp, idx) {
      const box = boxViewport(vp, s);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'ins-mk');
      applyBoxTransform(g, vp, s, box);
      if (s.url) {
        const im = document.createElementNS(SVGNS, 'image');
        im.setAttribute('x', box.x); im.setAttribute('y', box.y);
        im.setAttribute('width', box.w); im.setAttribute('height', box.h);
        im.setAttribute('preserveAspectRatio', 'none');
        im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', s.url);
        im.setAttribute('href', s.url);
        g.appendChild(im);
      } else {
        const r = document.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', box.x); r.setAttribute('y', box.y);
        r.setAttribute('width', box.w); r.setAttribute('height', box.h);
        r.setAttribute('fill', '#14161A');
        g.appendChild(r);
      }
      const dim = Math.min(box.w, box.h);
      const disc = document.createElementNS(SVGNS, 'circle');
      disc.setAttribute('cx', box.cx); disc.setAttribute('cy', box.cy); disc.setAttribute('r', dim * 0.17);
      disc.setAttribute('fill', 'rgba(5,5,5,.62)');
      g.appendChild(disc);
      const tri = document.createElementNS(SVGNS, 'polygon');
      tri.setAttribute('points', playIconPath(box).map(function (p) { return p[0] + ',' + p[1]; }).join(' '));
      tri.setAttribute('fill', '#fff');
      g.appendChild(tri);
      if (s.w) g.appendChild(boxBorderEl(box, s));
      moveAndClick(g, it, idx, function () { playVideo(s); });
      return g;
    };

    function playVideo(s) {
      if (!s.src) { X.toast('No video source for this mark'); return; }
      $('vidPlayEl').src = s.src;
      $('vidPlay').hidden = false;
      $('vidPlayEl').play().catch(function () {});
    }
    $('vidPlayClose').addEventListener('click', closeVideo);
    $('vidPlay').addEventListener('click', function (e) { if (e.target === $('vidPlay')) closeVideo(); });
    document.addEventListener('keydown', function (e) { if (!$('vidPlay').hidden && e.key === 'Escape') closeVideo(); });
    function closeVideo() { $('vidPlayEl').pause(); $('vidPlayEl').removeAttribute('src'); $('vidPlay').hidden = true; }

    function placeVideo(poster, iw, ih, src, it, center) {
      it = it || currentItem();
      if (!it) { X.toast('Open a PDF first'); return; }
      const box = centeredBox(it, iw && ih ? iw / ih : 16 / 9, center);
      placeShape(it, {
        t: 'video', id: uid('vid'), url: poster || '', iw: iw || 0, ih: ih || 0,
        src: src, a: box[0], b: box[1], c: '#1C1F24', w: 0
      });
      X.toast(center ? 'Video placed' : 'Video placed — click it to play, drag to reposition');
    }
    function armVideo(poster, iw, ih, src) {
      armPlacement('insvid', 'Click where the video should go', function (it, c) { placeVideo(poster, iw, ih, src, it, c); });
    }
    function captureVideoPoster(file) {
      return new Promise(function (resolve, reject) {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
        v.addEventListener('loadeddata', function () {
          const cv = document.createElement('canvas');
          cv.width = v.videoWidth || 320; cv.height = v.videoHeight || 180;
          try {
            cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
            resolve({ poster: cv.toDataURL('image/jpeg', 0.85), iw: cv.width, ih: cv.height, src: url });
          } catch (e) { resolve({ poster: null, iw: cv.width, ih: cv.height, src: url }); }
        }, { once: true });
        v.addEventListener('error', function () { reject(new Error('bad video')); }, { once: true });
      });
    }

    $('btnInsVideo').addEventListener('click', function () { X.togglePop('insVideoPop', $('btnInsVideo')); });
    X.registerPop('insVideoPop', 'btnInsVideo');
    $('insVidDevice').addEventListener('click', function () { $('insVidIn').click(); });
    $('insVidIn').addEventListener('change', function () {
      const f = this.files && this.files[0]; this.value = '';
      if (!f) return;
      $('insVidNote').textContent = 'Reading the video…';
      captureVideoPoster(f).then(function (r) {
        $('insVidNote').textContent = '';
        X.closePops(true);
        armVideo(r.poster, r.iw, r.ih, r.src);
      }).catch(function () { $('insVidNote').textContent = ''; X.toast('Could not read that video'); });
    });
    $('insVidUrlGo').addEventListener('click', function () {
      let u = $('insVidUrl').value.trim();
      if (!u) { X.toast('Paste a video URL first'); return; }
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      $('insVidUrl').value = '';
      X.closePops(true);
      armVideo(null, 0, 0, u);
    });
    $('insVidCancel').addEventListener('click', function () { X.closePops(true); });
    ['insVidUrl'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { e.stopPropagation(); }); });

    /* ================= LINK ================= */
    X.handleKind.link = 'rect';
    const LINK_COLOR = '#2F6FED';
    let linkStyle = 'icon';   /* remembered between opens of the popover */

    function linkIcon(g, box, s) {
      const dim = Math.min(box.w, box.h);
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', box.cx); c.setAttribute('cy', box.cy); c.setAttribute('r', dim / 2);
      c.setAttribute('fill', s.c || LINK_COLOR);
      c.setAttribute('stroke', '#FFFFFF'); c.setAttribute('stroke-width', Math.max(1, dim * 0.06));
      g.appendChild(c);
      const path = document.createElementNS(SVGNS, 'path');
      const k = dim * 0.16;
      path.setAttribute('d',
        'M ' + (box.cx - k * 1.4) + ' ' + (box.cy + k * 0.5) +
        ' a ' + k + ' ' + k + ' 0 0 1 0 ' + (-k * 1.4) +
        ' l ' + k * 0.6 + ' ' + (-k * 0.6) +
        ' a ' + k + ' ' + k + ' 0 0 1 ' + k * 1.4 + ' 0' +
        ' M ' + (box.cx + k * 1.4) + ' ' + (box.cy - k * 0.5) +
        ' a ' + k + ' ' + k + ' 0 0 1 0 ' + (k * 1.4) +
        ' l ' + (-k * 0.6) + ' ' + k * 0.6 +
        ' a ' + k + ' ' + k + ' 0 0 1 ' + (-k * 1.4) + ' 0');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#FFFFFF');
      path.setAttribute('stroke-width', Math.max(1, dim * 0.09)); path.setAttribute('stroke-linecap', 'round');
      g.appendChild(path);
    }
    function linkFontSize(box) { return Math.max(8, Math.min(16, box.h * 0.55)); }
    function linkLabel(s) { return s.label || s.url || 'Link'; }
    function linkUnderline(g, box, s) {
      const fs = linkFontSize(box);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', box.x); t.setAttribute('y', box.cy + fs * 0.35);
      t.setAttribute('font-size', fs); t.setAttribute('fill', s.c || LINK_COLOR);
      t.style.textDecoration = 'underline';
      t.textContent = linkLabel(s);
      g.appendChild(t);
    }
    function linkButton(g, box, s) {
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', box.x); r.setAttribute('y', box.y);
      r.setAttribute('width', box.w); r.setAttribute('height', box.h);
      r.setAttribute('rx', Math.min(10, box.h / 2));
      r.setAttribute('fill', s.c || LINK_COLOR);
      g.appendChild(r);
      const fs = linkFontSize(box);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', box.cx); t.setAttribute('y', box.cy + fs * 0.35);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', fs); t.setAttribute('font-weight', '700'); t.setAttribute('fill', '#FFFFFF');
      t.textContent = linkLabel(s);
      g.appendChild(t);
    }
    X.shapeRenderers.link = function (it, s, vp, idx) {
      const box = boxViewport(vp, s);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'ins-mk');
      applyBoxTransform(g, vp, s, box);
      if (s.style === 'underline') linkUnderline(g, box, s);
      else if (s.style === 'button') linkButton(g, box, s);
      else linkIcon(g, box, s);
      moveAndClick(g, it, idx, function () { window.open(s.url, '_blank', 'noopener'); });
      const tip = document.createElementNS(SVGNS, 'title');
      tip.textContent = s.url;
      g.appendChild(tip);
      return g;
    };

    function placeLink(url, style, label, it, center) {
      it = it || currentItem();
      if (!it) { X.toast('Open a PDF first'); return; }
      const box = centeredBox(it, 1, center);
      const cx = center ? center[0] : (box[0][0] + box[1][0]) / 2;
      const cy = center ? center[1] : (box[0][1] + box[1][1]) / 2;
      let a, b;
      if (style === 'icon') {
        const side = Math.min(box[1][0] - box[0][0], box[1][1] - box[0][1], 26);
        a = [cx - side / 2, cy - side / 2]; b = [cx + side / 2, cy + side / 2];
      } else {
        const fs = 12, pad = style === 'button' ? 16 : 2;
        const lw = X.textWidth({ f: 'helv', b: style === 'button', i: false, size: fs }, label || url) || (label || url).length * fs * 0.55;
        const w = lw + pad * 2, h = fs * (style === 'button' ? 2.1 : 1.6);
        a = [cx - w / 2, cy - h / 2]; b = [cx + w / 2, cy + h / 2];
      }
      placeShape(it, { t: 'link', id: uid('lnk'), url: url, style: style, label: label || '', a: a, b: b, c: LINK_COLOR });
      X.toast(center ? 'Link placed' : 'Link placed — drag it where it belongs');
    }
    function armLink(url, style, label) {
      armPlacement('inslink', 'Click where the link should go', function (it, c) { placeLink(url, style, label, it, c); });
    }
    $('btnInsLink').addEventListener('click', function () { X.togglePop('insLinkPop', $('btnInsLink')); });
    X.registerPop('insLinkPop', 'btnInsLink');
    (function () {
      const host = $('insLinkStyle');
      if (!host) return;
      Array.prototype.forEach.call(host.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.dataset.style === linkStyle);
        b.addEventListener('click', function () {
          linkStyle = b.dataset.style;
          Array.prototype.forEach.call(host.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
          $('insLinkLabelRow').hidden = linkStyle === 'icon';
        });
      });
      $('insLinkLabelRow').hidden = linkStyle === 'icon';
    })();
    $('insLinkGo').addEventListener('click', function () {
      let u = $('insLinkUrl').value.trim();
      if (!u) { X.toast('Type a URL first'); return; }
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      const label = $('insLinkLabel') ? $('insLinkLabel').value.trim() : '';
      $('insLinkUrl').value = '';
      if ($('insLinkLabel')) $('insLinkLabel').value = '';
      X.closePops(true);
      armLink(u, linkStyle, label);
    });
    $('insLinkUrl').addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); $('insLinkGo').click(); }
    });

    /* ================= TABLE ================= */
    X.handleKind.table = 'rect';
    const TABLE_LINE = '#8A8F98';

    function blankCells(rows, cols) {
      const g = [];
      for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push(''); g.push(row); }
      return g;
    }

    /* columns/rows are stored as ratios (fractions of the box that sum to 1),
       not equal division, so each one can be resized on its own — the whole
       table's own corner-resize handles keep working since ratios are
       relative to whatever box.w/box.h currently is */
    function colFracs(s) { return (s.colW && s.colW.length === s.cols) ? s.colW : Array(s.cols).fill(1 / s.cols); }
    function rowFracs(s) { return (s.rowH && s.rowH.length === s.rows) ? s.rowH : Array(s.rows).fill(1 / s.rows); }
    function cumFracs(fracs) { let acc = 0; return [0].concat(fracs.map(function (f) { acc += f; return acc; })); }
    /* move divider i (between entries i-1 and i) to cumulative fraction
       target, borrowing only from its immediate neighbour so every other
       column/row stays exactly where it was */
    function applyDividerFrac(fracs, i, target) {
      const before = fracs.slice(0, i - 1).reduce(function (a, b) { return a + b; }, 0);
      const pairSum = fracs[i - 1] + fracs[i];
      const MIN = 0.035;
      let a = Math.max(MIN, Math.min(pairSum - MIN, target - before));
      fracs[i - 1] = a; fracs[i] = pairSum - a;
    }
    function dividerDrag(e, it, s, kind, i) {
      e.stopPropagation(); e.preventDefault();
      let moved = false;
      function move(ev) {
        moved = true;
        /* .capture is display:none in Select mode — which is exactly when a
           divider handle is draggable — so it has no box to measure. .anno
           (the SVG the shape itself renders into) is always live, and unlike
           .capture it already sits inside the crop-shifted .inner, so no
           extra offset is needed on top of it. */
        const r = it.anno.getBoundingClientRect();
        const px = ev.clientX - r.left, py = ev.clientY - r.top;
        const box = boxViewport(it.vp, s);
        if (kind === 'col') {
          const fracs = colFracs(s).slice();
          applyDividerFrac(fracs, i, (px - box.x) / box.w);
          s.colW = fracs;
        } else {
          const fracs = rowFracs(s).slice();
          applyDividerFrac(fracs, i, (py - box.y) / box.h);
          s.rowH = fracs;
        }
        X.drawShapes(it);
      }
      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (moved) { X.updateMeta(); X.drawThumb(it); }
      }
      X.snapshot();
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }

    X.shapeRenderers.table = function (it, s, vp, idx) {
      const box = boxViewport(vp, s);
      const selected = idx >= 0 && S.sel && S.sel.it === it && S.sel.i === idx;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'ins-mk');
      applyBoxTransform(g, vp, s, box);
      const bg = document.createElementNS(SVGNS, 'rect');
      bg.setAttribute('x', box.x); bg.setAttribute('y', box.y);
      bg.setAttribute('width', box.w); bg.setAttribute('height', box.h);
      bg.setAttribute('fill', '#808080'); bg.style.fillOpacity = '0.05';
      g.appendChild(bg);
      const rows = s.rows, cols = s.cols;
      const colX = cumFracs(colFracs(s)).map(function (f) { return box.x + f * box.w; });
      const rowY = cumFracs(rowFracs(s)).map(function (f) { return box.y + f * box.h; });
      const sw = Math.max(0.6, (s.w || 1) * S.scale * 0.5);
      function line(x1, y1, x2, y2) {
        const l = document.createElementNS(SVGNS, 'line');
        l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        l.style.stroke = s.c || TABLE_LINE; l.style.strokeWidth = sw;
        g.appendChild(l);
      }
      rowY.forEach(function (y) { line(box.x, y, box.x + box.w, y); });
      colX.forEach(function (x) { line(x, box.y, x, box.y + box.h); });
      const fs = Math.max(8, Math.min(13, box.h / rows * 0.42));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const txt = (s.cells[r] && s.cells[r][c]) || '';
          if (!txt) continue;
          const t = document.createElementNS(SVGNS, 'text');
          t.setAttribute('x', colX[c] + 4);
          t.setAttribute('y', (rowY[r] + rowY[r + 1]) / 2 + fs * 0.32);
          t.setAttribute('font-size', fs);
          t.setAttribute('fill', '#1C1F24');
          t.textContent = txt.length > 40 ? txt.slice(0, 39) + '…' : txt;
          g.appendChild(t);
        }
      }
      moveAndClick(g, it, idx, function (e) { openTableEditor(it, s, idx, e); });
      if (selected) {
        for (let c = 1; c < cols; c++) {
          const h = document.createElementNS(SVGNS, 'rect');
          h.setAttribute('x', colX[c] - 3); h.setAttribute('y', box.y - 5);
          h.setAttribute('width', 6); h.setAttribute('height', box.h + 10);
          h.setAttribute('fill', 'transparent'); h.style.cursor = 'col-resize';
          h.addEventListener('pointerdown', function (e) { dividerDrag(e, it, s, 'col', c); });
          g.appendChild(h);
        }
        for (let r = 1; r < rows; r++) {
          const h = document.createElementNS(SVGNS, 'rect');
          h.setAttribute('x', box.x - 5); h.setAttribute('y', rowY[r] - 3);
          h.setAttribute('width', box.w + 10); h.setAttribute('height', 6);
          h.setAttribute('fill', 'transparent'); h.style.cursor = 'row-resize';
          h.addEventListener('pointerdown', function (e) { dividerDrag(e, it, s, 'row', r); });
          g.appendChild(h);
        }
      }
      return g;
    };

    function placeTable(rows, cols, it, center) {
      it = it || currentItem();
      if (!it) { X.toast('Open a PDF first'); return; }
      rows = Math.max(1, Math.min(24, rows | 0)); cols = Math.max(1, Math.min(12, cols | 0));
      const v = it.page.view, pw = v[2] - v[0], ph = v[3] - v[1];
      const w = Math.min(pw * 0.7, cols * 60), h = Math.min(ph * 0.5, rows * 24);
      const cx = center ? center[0] : v[0] + pw / 2, cy = center ? center[1] : v[1] + ph / 2;
      const x = cx - w / 2, y = cy - h / 2;
      placeShape(it, {
        t: 'table', id: uid('tbl'), rows: rows, cols: cols, cells: blankCells(rows, cols),
        a: [x, y], b: [x + w, y + h], c: TABLE_LINE, w: 1
      });
      X.toast(center ? 'Table placed' : 'Table placed — click it to type into cells');
    }
    function armTable(rows, cols) {
      armPlacement('instable', 'Click where the table should go', function (it, c) { placeTable(rows, cols, it, c); });
    }

    /* grid-picker popover */
    (function () {
      const GN = 8;
      const grid = $('insTableGrid');
      const cells = [];
      for (let r = 0; r < GN; r++) for (let c = 0; c < GN; c++) {
        const i = document.createElement('i');
        i.dataset.r = r; i.dataset.c = c;
        grid.appendChild(i); cells.push(i);
      }
      function paint(rows, cols) {
        cells.forEach(function (i) {
          i.classList.toggle('on', +i.dataset.r < rows && +i.dataset.c < cols);
        });
        $('insTableNote').textContent = cols + ' × ' + rows;
      }
      paint(4, 4);
      grid.addEventListener('pointerover', function (e) {
        const i = e.target.closest('i'); if (!i) return;
        paint(+i.dataset.r + 1, +i.dataset.c + 1);
      });
      grid.addEventListener('click', function (e) {
        const i = e.target.closest('i'); if (!i) return;
        const rows = +i.dataset.r + 1, cols = +i.dataset.c + 1;
        $('insTableRows').value = rows; $('insTableCols').value = cols;
        X.closePops(true);
        armTable(rows, cols);
      });
      grid.addEventListener('pointerleave', function () {
        paint(+$('insTableRows').value || 4, +$('insTableCols').value || 4);
      });
    })();
    $('btnInsTable').addEventListener('click', function () { X.togglePop('insTablePop', $('btnInsTable')); });
    X.registerPop('insTablePop', 'btnInsTable');
    $('insTableGo').addEventListener('click', function () {
      const rows = +$('insTableRows').value || 1, cols = +$('insTableCols').value || 1;
      X.closePops(true);
      armTable(rows, cols);
    });
    $('insTableCancel').addEventListener('click', function () { X.closePops(true); });
    ['insTableRows', 'insTableCols'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') $('insTableGo').click(); });
    });

    /* ---- typing in a placed table, as in WPS: the cells themselves turn
       editable, laid exactly over the drawn ones, with the caret in the
       cell that was clicked. Tab / Shift+Tab, Enter and the arrows move
       between cells (Tab past the last adds a row); a click anywhere else
       keeps what was typed, Escape drops it. The small bar under the table
       adds and removes rows and columns. `tableEditing` carries everything
       close needs. ---- */
    let tableEditing = null;

    function readTableCells(tEl) {
      const out = [];
      tEl.querySelectorAll('tr').forEach(function (tr) {
        const rowVals = [];
        tr.querySelectorAll('td').forEach(function (td) { rowVals.push(td.textContent.replace(/\s+/g, ' ').trim()); });
        out.push(rowVals);
      });
      return out;
    }
    function closeTableEditor(commit) {
      const st = tableEditing; if (!st) return;
      tableEditing = null;
      document.removeEventListener('pointerdown', st.outside, true);
      if (commit) {
        const data = readTableCells(st.tEl);
        const rows = data.length, cols = rows ? data[0].length : st.s.cols;
        const changed = JSON.stringify(data) !== JSON.stringify(st.s.cells) || rows !== st.s.rows || cols !== st.s.cols;
        if (changed) {
          X.snapshot();
          /* a new row or column takes an even share; the rest keep theirs */
          if (cols !== st.s.cols) st.s.colW = null;
          if (rows !== st.s.rows) st.s.rowH = null;
          st.s.rows = rows; st.s.cols = cols; st.s.cells = data;
        }
      }
      st.wrap.remove();
      X.drawShapes(st.it); X.drawThumb(st.it); X.updateMeta();
    }

    function openTableEditor(it, s, idx, e) {
      if (tableEditing) closeTableEditor(true);
      const vp = it.vp; if (!vp) return;
      const box = boxViewport(vp, s);
      const wrap = document.createElement('div');
      wrap.className = 'tabled';
      wrap.style.left = box.x + 'px'; wrap.style.top = box.y + 'px';
      wrap.style.width = box.w + 'px';
      const fs = Math.max(8, Math.min(13, box.h / s.rows * 0.42));

      let tEl = null;
      function build(rows, cols, data, colW, rowH) {
        const t = document.createElement('table');
        const cg = document.createElement('colgroup');
        (colW || Array(cols).fill(1 / cols)).forEach(function (f) {
          const c = document.createElement('col'); c.style.width = (f * 100) + '%'; cg.appendChild(c);
        });
        t.appendChild(cg);
        const fr = rowH || Array(rows).fill(1 / rows);
        for (let r = 0; r < rows; r++) {
          const tr = document.createElement('tr');
          tr.style.height = Math.max(fs * 1.6, fr[r] * box.h) + 'px';
          for (let c = 0; c < cols; c++) {
            const td = document.createElement('td');
            td.contentEditable = 'true';
            td.spellcheck = false;
            td.style.fontSize = fs + 'px';
            td.textContent = (data[r] && data[r][c]) || '';
            tr.appendChild(td);
          }
          t.appendChild(tr);
        }
        if (tEl) wrap.replaceChild(t, tEl); else wrap.appendChild(t);
        tEl = t;
        if (tableEditing) tableEditing.tEl = t;
      }
      build(s.rows, s.cols, s.cells, s.colW && s.colW.length === s.cols ? s.colW : null,
            s.rowH && s.rowH.length === s.rows ? s.rowH : null);

      const bar = document.createElement('div');
      bar.className = 'tbar';
      bar.innerHTML =
        '<button data-a="row+" title="Add a row">+ Row</button>' +
        '<button data-a="col+" title="Add a column">+ Column</button>' +
        '<button data-a="row-" title="Remove the last row">− Row</button>' +
        '<button data-a="col-" title="Remove the last column">− Column</button>' +
        '<span class="grow"></span><button class="ok" data-a="ok" title="Keep (or click outside the table)">Done</button>';
      wrap.appendChild(bar);

      it.inner.appendChild(wrap);
      tableEditing = { it: it, s: s, idx: idx, wrap: wrap, tEl: tEl };

      function cells() { return Array.prototype.slice.call(tEl.querySelectorAll('td')); }
      function dims() { const rws = tEl.querySelectorAll('tr'); return [rws.length, rws[0] ? rws[0].children.length : 0]; }
      function focusCell(td) {
        if (!td) return;
        td.focus();
        const r = document.createRange(); r.selectNodeContents(td); r.collapse(false);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
      function reshape(rows, cols) {
        rows = Math.max(1, Math.min(60, rows)); cols = Math.max(1, Math.min(20, cols));
        const data = readTableCells(tEl);
        const fresh = blankCells(rows, cols);
        for (let r = 0; r < Math.min(rows, data.length); r++)
          for (let c = 0; c < Math.min(cols, data[r].length); c++) fresh[r][c] = data[r][c];
        build(rows, cols, fresh, null, null);
      }
      bar.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });   /* keep the caret */
      bar.addEventListener('click', function (ev) {
        const b = ev.target.closest('button'); if (!b) return;
        ev.stopPropagation();
        const d = dims(), a = b.dataset.a;
        if (a === 'ok') { closeTableEditor(true); return; }
        if (a === 'row+') reshape(d[0] + 1, d[1]);
        if (a === 'col+') reshape(d[0], d[1] + 1);
        if (a === 'row-') reshape(d[0] - 1, d[1]);
        if (a === 'col-') reshape(d[0], d[1] - 1);
        focusCell(cells()[0]);
      });

      wrap.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        const td = ev.target.closest && ev.target.closest('td');
        if (ev.key === 'Escape') { ev.preventDefault(); closeTableEditor(false); return; }
        if (!td) return;
        const list = cells(), i = list.indexOf(td), d = dims(), cols = d[1];
        const caretAt = function (end) {
          const sel = window.getSelection();
          if (!sel.rangeCount || !sel.isCollapsed) return false;
          const len = td.textContent.length;
          const r = sel.getRangeAt(0).cloneRange(); r.selectNodeContents(td); r.setEnd(sel.anchorNode, sel.anchorOffset);
          const pos = r.toString().length;
          return end ? pos >= len : pos === 0;
        };
        let to = -1;
        if (ev.key === 'Tab') {
          to = ev.shiftKey ? i - 1 : i + 1;
          if (!ev.shiftKey && to >= list.length) { reshape(d[0] + 1, cols); focusCell(cells()[to]); ev.preventDefault(); return; }
        } else if (ev.key === 'Enter') to = ev.shiftKey ? i - cols : i + cols;
        else if (ev.key === 'ArrowUp') to = i - cols;
        else if (ev.key === 'ArrowDown') to = i + cols;
        else if (ev.key === 'ArrowLeft' && caretAt(false)) to = i - 1;
        else if (ev.key === 'ArrowRight' && caretAt(true)) to = i + 1;
        else return;
        ev.preventDefault();
        if (to >= 0 && to < list.length) focusCell(list[to]);
      });
      /* one line per cell, as it is drawn and saved */
      wrap.addEventListener('paste', function (ev) {
        const t = (ev.clipboardData || window.clipboardData).getData('text');
        if (t == null) return;
        ev.preventDefault();
        document.execCommand('insertText', false, t.replace(/\s+/g, ' '));
      });

      /* a click outside the table keeps what was typed */
      tableEditing.outside = function (ev) {
        if (wrap.contains(ev.target)) return;
        closeTableEditor(true);
      };
      setTimeout(function () {
        if (tableEditing && tableEditing.wrap === wrap) document.addEventListener('pointerdown', tableEditing.outside, true);
      }, 0);

      /* the caret in the cell that was clicked */
      let start = cells()[0];
      if (e && e.fx != null) {
        const pick = function (fracs, f) {
          const cum = cumFracs(fracs);
          for (let i = 0; i < fracs.length; i++) if (f < cum[i + 1]) return i;
          return fracs.length - 1;
        };
        const r = pick(rowFracs(s), e.fy), c = pick(colFracs(s), e.fx);
        start = cells()[r * s.cols + c] || start;
      }
      focusCell(start);
    }
  });
})();
