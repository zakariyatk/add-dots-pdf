/* ADD DOTS PDF — Pan
   ------------------
   The hand tool. It lives on the View tab beside the zoom controls, because
   panning is a way of looking at the document rather than a way of marking it.
   It declares itself `bare`, so it gets none of the editing chrome — no mode
   bar, no colour row, nothing to finish. You are not in a mode you have to
   leave; you are just looking at the page from somewhere else.

   Three ways in:
     · the Pan button        — stays on until you turn it off
     · hold Space            — borrows the hand from whatever tool is live
     · drag the middle mouse — pans from any tool without switching at all

   Panning is not limited by the scrollbars. A scroller stops dead at the edge
   of its content, which is exactly wrong when you are zoomed into the corner
   of a big drawing and want to swing it into the middle of the screen. So the
   drag is tracked as one continuous coordinate per axis: whatever the scroller
   will take it takes, and everything it refuses becomes a CSS translate on the
   pages. The document floats free in all four directions and hands itself back
   to normal scrolling the moment the drag re-enters the content.

   That translate goes on .pagebox, which does not change offsetTop — so
   core's goTo, its lazy-render pass and the thumbnails are untouched. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[navigate] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const stage = $('stage');

    /* the free-float offset, in CSS pixels */
    let offX = 0, offY = 0;

    function setOffset(x, y) {
      offX = x; offY = y;
      stage.style.setProperty('--pan-x', x + 'px');
      stage.style.setProperty('--pan-y', y + 'px');
      const floated = (x !== 0 || y !== 0);
      stage.classList.toggle('floated', floated);
      recentreBtn.hidden = !floated;
    }

    function recentre() {
      stage.classList.add('pan-ease');
      setOffset(0, 0);
      setTimeout(function () { stage.classList.remove('pan-ease'); }, 220);
    }

    /* ---------------- the shared drag ---------------- */

    let grab = null;

    function beginGrab(clientX, clientY) {
      /* One continuous coordinate per axis: scroll position minus the float.
         Tracking it this way is what lets a drag cross the edge of the content
         and come back without jumping. */
      grab = {
        x: clientX, y: clientY,
        vx: stage.scrollLeft - offX,
        vy: stage.scrollTop  - offY
      };
      document.body.classList.add('panning');
    }

    /* The clamp-and-float maths shared by every way of panning: take what the
       scroller will give on each axis, and let the rest become the CSS float. */
    function applyPanWant(wantX, wantY) {
      const maxX = Math.max(0, stage.scrollWidth  - stage.clientWidth);
      const maxY = Math.max(0, stage.scrollHeight - stage.clientHeight);

      const sx = Math.max(0, Math.min(maxX, wantX));
      const sy = Math.max(0, Math.min(maxY, wantY));

      stage.scrollLeft = sx;
      stage.scrollTop  = sy;

      /* Whatever the scroller would not take is the float. It returns to zero
         on its own as soon as the drag re-enters the scrollable range. */
      setOffset(sx - wantX, sy - wantY);
    }

    function moveGrab(clientX, clientY) {
      if (!grab) return;
      applyPanWant(grab.vx - (clientX - grab.x), grab.vy - (clientY - grab.y));
    }

    /* A trackpad's two-finger pan never touches beginGrab/moveGrab — it comes
       in as wheel deltas, so it needs its own path into the same clamp. Plain
       scroll semantics (delta down moves the content up), not grab semantics,
       since that is what a two-finger swipe already means everywhere else. */
    function applyPanDelta(dx, dy) {
      applyPanWant((stage.scrollLeft - offX) + dx, (stage.scrollTop - offY) + dy);
    }

    function endGrab() {
      grab = null;
      document.body.classList.remove('panning');
    }

    /* ---------------- the button, on the View tab next to zoom ---------------- */

    const b = document.createElement('button');
    b.className = 'btn';
    b.id = 'tPan';
    b.title = 'Pan — drag the page anywhere. Hold Space, or drag with the middle mouse button, from any tool.';
    b.setAttribute('aria-label', 'Pan tool');
    b.dataset.label = 'Pan';
    b.innerHTML =
      '<svg viewBox="0 0 24 24">' +
      /* an open hand: three inner fingers, then the thumb wrapping the palm */
      '<path d="M9 11V4.6a1.6 1.6 0 0 1 3.2 0V10"/>' +
      '<path d="M12.2 10V3.8a1.6 1.6 0 0 1 3.2 0V10"/>' +
      '<path d="M15.4 10.4V5.6a1.6 1.6 0 0 1 3.2 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.5-2l-3-3.4a1.7 1.7 0 0 1 2.4-2.4L9 15.4V11"/>' +
      '</svg><span class="lbl">Pan</span>';
    $('grpZoom').appendChild(b);

    b.addEventListener('click', function () { X.toggleTool('pan'); });

    X.toolBtn.pan = 'tPan';

    /* A pill over the page rather than a toolbar button: it only exists while
       the page is off its mark, and it should not make the toolbar jump. */
    const recentreBtn = document.createElement('button');
    recentreBtn.className = 'panhome';
    recentreBtn.id = 'panRecentre';
    recentreBtn.type = 'button';
    recentreBtn.hidden = true;
    recentreBtn.title = 'Put the page back where it started';
    recentreBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/>' +
      '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>' +
      '<line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>' +
      '<span>Recentre</span>';
    recentreBtn.addEventListener('click', recentre);
    document.body.appendChild(recentreBtn);

    /* ---------------- the tool (Pan button held on) ---------------- */

    X.tools.pan = {
      bare: true,               /* a view mode: no mode bar, nothing to finish */
      down: function (it, at, e) {
        beginGrab(e.clientX, e.clientY);
        try { it.capture.setPointerCapture(e.pointerId); } catch (err) {}
      },
      move: function (it, at, e) { moveGrab(e.clientX, e.clientY); },
      cancel: endGrab,
      up: endGrab
    };

    /* core routes pointerup to the tool but keeps pointercancel for itself,
       so catch the stragglers rather than leaving the cursor stuck grabbing */
    window.addEventListener('pointerup', endGrab);
    window.addEventListener('pointercancel', endGrab);

    /* double-click while panning puts the page back */
    stage.addEventListener('dblclick', function () {
      if (S.tool === 'pan') recentre();
    });

    /* ---------------- middle mouse button ---------------- */

    /* Drag with the wheel pressed and the page moves, whatever tool is live.
       Deliberately no tool switch: in a drawing app the middle button is a
       way of reaching the rest of the page mid-task, not a mode you enter. */
    let middle = false;

    /* Chrome starts its autoscroll ring on middle mousedown unless the default
       is prevented, and follows up with auxclick. Both have to go. */
    stage.addEventListener('mousedown', function (e) {
      if (e.button === 1 && S.items.length) e.preventDefault();
    }, true);
    stage.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });

    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 1 || !S.items.length || middle) return;
      e.preventDefault();
      e.stopPropagation();
      middle = true;
      document.body.classList.add('midpan');
      beginGrab(e.clientX, e.clientY);
      window.addEventListener('pointermove', onMiddleMove, true);
      window.addEventListener('pointerup', onMiddleUp, true);
    }, true);

    function onMiddleMove(e) {
      if (!middle) return;
      e.preventDefault();
      moveGrab(e.clientX, e.clientY);
    }
    function onMiddleUp(e) {
      if (!middle || (e.button !== 1 && e.type === 'pointerup' && e.buttons & 4)) return;
      middle = false;
      document.body.classList.remove('midpan');
      endGrab();
      window.removeEventListener('pointermove', onMiddleMove, true);
      window.removeEventListener('pointerup', onMiddleUp, true);
    }

    /* ---------------- hold Space ---------------- */

    let borrowedFrom = null;
    let spaceDown = false;            /* Space is physically down, even if the
                                          tool was already Pan and nothing was
                                          borrowed — the wheel handler below
                                          needs this one regardless */

    /* a dialog or sheet over the page keeps Space for its own buttons */
    function overlayUp() {
      return !!document.querySelector('.sigmodal:not([hidden]), .orgview:not([hidden]), [role="dialog"]:not([hidden]):not(.pop)');
    }
    document.addEventListener('keydown', function (e) {
      if ((e.code !== 'Space' && e.key !== ' ') || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && el.matches && el.matches('input,textarea,select,[contenteditable]')) return;
      if (el && el.isContentEditable) return;
      if (!S.items.length || S.editing) return;
      /* the toolbar button clicked last keeps focus; Space is still the
         hand, as in Acrobat and WPS, not a second click on that button */
      if (el && el.matches && el.matches('button,a')) {
        if (overlayUp() || !el.closest('.ribbon, .rbar, #ribbon, .toolbar, .rail, #stage, .top, header')) return;
        el.blur();
      }
      e.preventDefault();               /* otherwise the page jumps a screen */
      if (e.repeat) return;
      spaceDown = true;
      if (S.tool === 'pan') return;
      borrowedFrom = S.tool;
      X.setTool('pan');
    }, true);

    function handBack() {
      spaceDown = false;
      if (borrowedFrom === null) return;
      const back = borrowedFrom;
      borrowedFrom = null;
      endGrab();
      X.setTool(back);
    }
    document.addEventListener('keyup', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      /* no click on a button left focused, now the key comes up */
      if (spaceDown || borrowedFrom !== null) e.preventDefault();
      handBack();
    }, true);
    /* if focus leaves mid-hold the keyup never arrives, and the hand would
       stay borrowed for good */
    window.addEventListener('blur', function () {
      endGrab();
      if (middle) onMiddleUp({ button: 1, type: 'blur' });
      handBack();
    });

    /* ---------------- trackpad two-finger pan ---------------- */

    /* A two-finger swipe never fires a pointer event at all — Chrome and
       Safari deliver it as a wheel event with both deltas set, so it has to
       be picked up on its own rather than riding beginGrab/moveGrab. Only
       steps in while Pan is actually wanted (the tool, or Space held); a
       plain wheel scroll with neither is left to the browser's own
       .stage{overflow:auto}, unchanged. */
    stage.addEventListener('wheel', function (e) {
      if (S.tool !== 'pan' && !spaceDown) return;
      if (!S.items.length) return;
      e.preventDefault();
      applyPanDelta(e.deltaX, e.deltaY);
    }, { passive: false });

    /* ---------------- putting it back ---------------- */

    /* Fitting is an explicit "lay this out properly" instruction, so a float
       left over from earlier would just be in the way. */
    ['btnFitW', 'btnFitP'].forEach(function (id) {
      const el = $(id);
      if (el) el.addEventListener('click', function () { setOffset(0, 0); });
    });

    /* Jumping to a page scrolls it into view; a stale float would land it
       somewhere off screen instead. */
    const origGoTo = X.goTo;
    X.goTo = function () {
      if (offX || offY) setOffset(0, 0);
      return origGoTo.apply(null, arguments);
    };

    X.on('reset', function () {
      borrowedFrom = null;
      middle = false;
      endGrab();
      setOffset(0, 0);
    });

    X.pan = {
      recentre: recentre,
      offset: function () { return { x: offX, y: offY }; }
    };
  });
})();
