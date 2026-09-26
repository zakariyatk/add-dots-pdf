/* ADD DOTS PDF — Insert
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
    /* click without drag: mirrors the pointerdown(move) + click(action) pair
       core.js's own text tool uses, so a drag never also fires the action */
    function moveAndClick(g, it, idx, onClick) {
      g.style.pointerEvents = 'all';
      let downAt = null;
      if (idx >= 0) g.addEventListener('pointerdown', function (e) {
        downAt = [e.clientX, e.clientY];
        X.beginDrag(it, idx, e, 'move');
      });
      if (onClick) g.addEventListener('click', function (e) {
        if (S.tool !== 'select') return;
        if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
        e.stopPropagation();
        onClick(e);
      });
    }

    /* rotate a box corner about the box's own centre for export, the same
       way core.js rotates a text patch about its anchor */
    function exportCorner(s) {
      const bx = X.boxOf(s), mid = X.shapeMid(s);
      return s.r ? X.rotPt([bx.x1, bx.y1], mid, s.r) : [bx.x1, bx.y1];
    }
    function paintBorder(p, s) {
      if (!s.w) return;
      const bx = X.boxOf(s), o0 = exportCorner(s);
      p.drawRectangle({
        x: o0[0], y: o0[1], width: bx.x2 - bx.x1, height: bx.y2 - bx.y1,
        rotate: PDFLib.degrees(s.r || 0), borderColor: X.hexRgb(s.c), borderWidth: s.w
      });
    }

    /* ================= shared image cache (image + video poster) ================= */
    X.prepare.push(async function (out, items, extra) {
      extra.insImgs = extra.insImgs || {};
      for (const it of items) {
        for (const s of it.shapes) {
          if ((s.t !== 'image' && s.t !== 'video') || !s.url || extra.insImgs[s.url]) continue;
          try { extra.insImgs[s.url] = await out.embedPng(s.url); }
          catch (e) { try { extra.insImgs[s.url] = await out.embedJpg(s.url); } catch (e2) { /* unreadable image, skip */ } }
        }
      }
    });

    function paintImageLike(p, s, ctx) {
      const img = ctx.extra.insImgs && ctx.extra.insImgs[s.url];
      if (img) {
        const bx = X.boxOf(s), o0 = exportCorner(s);
        p.drawImage(img, {
          x: o0[0], y: o0[1], width: bx.x2 - bx.x1, height: bx.y2 - bx.y1, rotate: PDFLib.degrees(s.r || 0)
        });
      }
      paintBorder(p, s);
    }

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
    X.shapePainters.image = paintImageLike;

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
    X.shapePainters.video = function (p, s, ctx) {
      paintImageLike(p, s, ctx);
      if (s.src && /^https?:\/\//i.test(s.src)) {
        const bx = X.boxOf(s);
        const annot = ctx.doc.context.obj({
          Type: 'Annot', Subtype: 'Link', Rect: [bx.x1, bx.y1, bx.x2, bx.y2], Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: PDFLib.PDFString.of(s.src) }
        });
        p.node.addAnnot(ctx.doc.context.register(annot));
      }
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
    X.prepare.push(async function (out, items, extra) {
      const needed = items.some(function (it) { return it.shapes.some(function (s) { return s.t === 'link' && s.style !== 'icon'; }); });
      if (needed && !extra.linkFont) extra.linkFont = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
    });
    X.shapePainters.link = function (p, s, ctx) {
      const bx = X.boxOf(s);
      const w = bx.x2 - bx.x1, h = bx.y2 - bx.y1;
      const cx = (bx.x1 + bx.x2) / 2, cy = (bx.y1 + bx.y2) / 2;
      const col = X.hexRgb(s.c || LINK_COLOR);
      const font = ctx.extra.linkFont;
      const fs = Math.max(8, Math.min(16, h * 0.55));
      if (s.style === 'underline' && font) {
        const label = linkLabel(s);
        p.drawText(label, { x: bx.x1, y: cy - fs * 0.35, size: fs, font: font, color: col });
        const lw = font.widthOfTextAtSize(label, fs);
        p.drawLine({ start: { x: bx.x1, y: cy - fs * 0.42 }, end: { x: bx.x1 + lw, y: cy - fs * 0.42 }, thickness: Math.max(0.5, fs * 0.06), color: col });
      } else if (s.style === 'button' && font) {
        p.drawRectangle({ x: bx.x1, y: bx.y1, width: w, height: h, color: col, borderWidth: 0 });
        const label = linkLabel(s);
        const lw = font.widthOfTextAtSize(label, fs);
        p.drawText(label, { x: cx - lw / 2, y: cy - fs * 0.35, size: fs, font: font, color: PDFLib.rgb(1, 1, 1) });
      } else {
        p.drawCircle({ x: cx, y: cy, size: Math.min(w, h) / 2, color: col });
      }
      const annot = ctx.doc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [bx.x1, bx.y1, bx.x2, bx.y2], Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFLib.PDFString.of(s.url) }
      });
      p.node.addAnnot(ctx.doc.context.register(annot));
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
      moveAndClick(g, it, idx, function () { openTableEditor(it, s, idx); });
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

    X.prepare.push(async function (out, items, extra) {
      const needed = items.some(function (it) { return it.shapes.some(function (s) { return s.t === 'table'; }); });
      if (needed && !extra.tableFont) extra.tableFont = await out.embedFont(PDFLib.StandardFonts.Helvetica);
    });
    X.shapePainters.table = function (p, s, ctx) {
      const bx = X.boxOf(s), rows = s.rows, cols = s.cols;
      const bw = bx.x2 - bx.x1, bh = bx.y2 - bx.y1;
      const colXs = cumFracs(colFracs(s)).map(function (f) { return bx.x1 + f * bw; });
      const rowYs = cumFracs(rowFracs(s)).map(function (f) { return bx.y2 - f * bh; });   /* row 0 at the top */
      const mid = X.shapeMid(s), col = X.hexRgb(s.c || TABLE_LINE);
      function ptAt(x, y) { return s.r ? X.rotPt([x, y], mid, s.r) : [x, y]; }
      rowYs.forEach(function (y) {
        const a = ptAt(bx.x1, y), b = ptAt(bx.x2, y);
        p.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: Math.max(0.4, s.w || 1) * 0.6, color: col });
      });
      colXs.forEach(function (x) {
        const a = ptAt(x, bx.y1), b = ptAt(x, bx.y2);
        p.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: Math.max(0.4, s.w || 1) * 0.6, color: col });
      });
      const font = ctx.extra.tableFont;
      if (!font) return;
      const minRowH = bh / rows;
      const fs = Math.max(6.5, Math.min(10.5, minRowH * 0.34));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const txt = (s.cells[r] && s.cells[r][c]) || '';
          if (!txt.trim()) continue;
          const cw = colXs[c + 1] - colXs[c], rh = rowYs[r] - rowYs[r + 1];
          const x = colXs[c] + 3, y = rowYs[r + 1] + rh * 0.32;
          const o = ptAt(x, y);
          p.drawText(X.fitText ? X.fitText(font, txt, fs, cw - 6) : txt.slice(0, 24), {
            x: o[0], y: o[1], size: fs, font: font, color: X.hexRgb('#1C1F24'), rotate: PDFLib.degrees(s.r || 0)
          });
        }
      }
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

    /* ---- editing a placed table: a floating HTML table over the mark,
       mirroring how the text tool opens a textarea over its own box.
       `tableEditing` carries everything close needs, so close never reaches
       into a stale invocation's own local variables. ---- */
    let tableEditing = null;

    function buildTableEl(rows, cols, data) {
      const t = document.createElement('table');
      for (let r = 0; r < rows; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < cols; c++) {
          const td = document.createElement('td');
          td.contentEditable = 'true';
          td.textContent = (data[r] && data[r][c]) || '';
          tr.appendChild(td);
        }
        t.appendChild(tr);
      }
      return t;
    }
    function readTableCells(tEl) {
      const out = [];
      tEl.querySelectorAll('tr').forEach(function (tr) {
        const rowVals = [];
        tr.querySelectorAll('td').forEach(function (td) { rowVals.push(td.textContent); });
        out.push(rowVals);
      });
      return out;
    }
    function closeTableEditor(commit) {
      const st = tableEditing; if (!st) return;
      tableEditing = null;
      if (commit) {
        const data = readTableCells(st.tEl);
        const rows = data.length, cols = rows ? data[0].length : st.s.cols;
        X.snapshot();
        st.s.rows = rows; st.s.cols = cols; st.s.cells = data;
      }
      st.wrap.remove();
      X.drawShapes(st.it); X.drawThumb(st.it); X.updateMeta();
    }
    function openTableEditor(it, s, idx) {
      if (tableEditing) closeTableEditor(true);
      const vp = it.vp; if (!vp) return;
      const box = boxViewport(vp, s);
      const wrap = document.createElement('div');
      wrap.className = 'tabled';
      wrap.style.left = box.x + 'px'; wrap.style.top = box.y + 'px';

      let tEl = buildTableEl(s.rows, s.cols, s.cells);
      wrap.appendChild(tEl);

      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML =
        '<label>Columns <input id="ted_c" value="' + s.cols + '" inputmode="numeric"></label>' +
        '<label>Rows <input id="ted_r" value="' + s.rows + '" inputmode="numeric"></label>';
      wrap.appendChild(row);

      const acts = document.createElement('div');
      acts.className = 'acts';
      acts.innerHTML = '<button class="ok" data-a="ok">Apply</button><button data-a="no">Cancel</button>';
      wrap.appendChild(acts);

      it.inner.appendChild(wrap);
      tableEditing = { it: it, s: s, idx: idx, wrap: wrap, tEl: tEl };

      function resize() {
        const rows = Math.max(1, Math.min(24, parseInt(row.querySelector('#ted_r').value, 10) || s.rows));
        const cols = Math.max(1, Math.min(12, parseInt(row.querySelector('#ted_c').value, 10) || s.cols));
        const data = readTableCells(tEl);
        const fresh = blankCells(rows, cols);
        for (let r = 0; r < Math.min(rows, data.length); r++)
          for (let c = 0; c < Math.min(cols, data[r].length); c++) fresh[r][c] = data[r][c];
        const nt = buildTableEl(rows, cols, fresh);
        wrap.replaceChild(nt, tEl);
        tEl = nt;
        tableEditing.tEl = nt;
      }
      row.querySelector('#ted_r').addEventListener('change', resize);
      row.querySelector('#ted_c').addEventListener('change', resize);
      [row.querySelector('#ted_r'), row.querySelector('#ted_c')].forEach(function (inp) {
        inp.addEventListener('keydown', function (e) { e.stopPropagation(); });
      });
      wrap.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeTableEditor(false); } });
      acts.addEventListener('click', function (e) {
        const b = e.target.closest('button'); if (!b) return;
        e.stopPropagation();
        closeTableEditor(b.dataset.a === 'ok');
      });

      const firstCell = tEl.querySelector('td');
      if (firstCell) firstCell.focus();
    }
  });
})();
