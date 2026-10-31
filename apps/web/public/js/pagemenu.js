/* Add Dots PDF — Page menu
   ------------------------
   A right-click on a page opens the app's own menu instead of the browser's
   (Back, Reload, Inspect…), with what is wanted where the click was:

   - the words: Copy text (the selection), Select all text (this page),
     Highlight (the selection)
   - marking up at that spot: Add comment here, Add text here
   - the page: Rotate, Insert blank page after, Extract this page…, Delete
   - the view: Zoom in here, Fit page, Print…

   On a mark (with Select) the menu is the mark's: Edit text (a text mark),
   Duplicate, the four stacking moves, Delete. The right-click selects the mark first
   (core beginDrag). Each item does what its button, tool or shortcut does,
   and shows that shortcut. Text being typed keeps the browser's own menu
   (spelling, paste); so do phones and tablets, where a long press selects
   words. Shift+F10 or the menu key open it too, at the page in view. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[pagemenu] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const stage = $('stage');

    const I = {
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
      all: '<path d="M4 6h16M4 12h16M4 18h10"/>',
      hl: '<path d="M4 20h7"/><path d="m14 4 6 6-8 8H6v-6z"/>',
      note: '<path d="M4 4h16v12H8l-4 4z"/>',
      text: '<path d="M5 6h14M12 6v13"/>',
      rot: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
      ins: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 9v6M9 12h6"/>',
      ext: '<path d="M14 3h7v7"/><path d="M21 3 11 13"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
      del: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
      zin: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
      fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
      prn: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
      edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
      dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
      front: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M4 14V5a1 1 0 0 1 1-1h9"/>',
      back: '<rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M20 10v9a1 1 0 0 1-1 1h-9"/>'
    };

    const menu = document.createElement('div');
    menu.className = 'dtmenu pgmenu'; menu.id = 'pageMenu';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Page');
    menu.hidden = true; menu.tabIndex = -1;
    document.body.appendChild(menu);

    /* where the menu was opened: page item and number, the point, a mark */
    let at = null;

    function item(a, icon, label, key, opts) {
      opts = opts || {};
      return '<button type="button" role="menuitem" data-a="' + a + '"' +
        (opts.off ? ' disabled' : '') + (opts.danger ? ' class="danger"' : '') +
        (opts.title ? ' title="' + X.esc(opts.title) + '"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[icon] + '</svg><span>' + label + '</span>' +
        (key ? '<kbd>' + key + '</kbd>' : '') + '</button>';
    }

    function build(c) {
      if (c.mark) {
        const s = c.it.shapes[S.sel.i];
        const many = c.many > 1;
        return '<div class="hd">' + (many ? c.many + ' marks' : 'Mark') + '</div>' +
          (!many && s && s.t === 'text' ? item('mkedit', 'edit', 'Edit text') : '') +
          item('mkdup', 'dup', 'Duplicate') +
          '<hr>' + item('mkfront', 'front', 'Bring to front') +
          item('mkup', 'front', 'Bring forward') +
          item('mkdown', 'back', 'Send backward') +
          item('mkback', 'back', 'Send to back') +
          '<hr>' + item('mkdel', 'del', 'Delete', 'Del', { danger: true });
      }
      const words = !!(X.selectedText && X.selectedText());
      return item('copy', 'copy', 'Copy text', 'Ctrl+C', { off: !words, title: words ? '' : 'Select some text first' }) +
        item('selall', 'all', 'Select all text') +
        '<hr>' +
        (words && X.applyMarkup ? item('hl', 'hl', 'Highlight') : '') +
        item('note', 'note', 'Add comment here') +
        item('text', 'text', 'Add text here') +
        '<hr><div class="hd">Page ' + c.n + '</div>' +
        item('rot', 'rot', 'Rotate page', 'R') +
        item('blank', 'ins', 'Insert blank page after') +
        item('extract', 'ext', 'Extract this page…') +
        item('delpage', 'del', 'Delete page', S.tool === 'select' ? 'Del' : '', { danger: true, off: S.items.length < 2 }) +
        '<hr>' +
        item('zin', 'zin', 'Zoom in here', '+') +
        item('fit', 'fit', 'Fit page', 'P') +
        item('print', 'prn', 'Print…', 'Ctrl+P');
    }

    function show(c) {
      at = c;
      menu.innerHTML = build(c);
      menu.hidden = false;
      menu.style.left = Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, c.x)) + 'px';
      menu.style.top = Math.max(6, Math.min(window.innerHeight - menu.offsetHeight - 6, c.y)) + 'px';
      /* from the keyboard, on the first item; from the mouse, on the menu,
         so the arrows still reach the items but none is lit up */
      const first = menu.querySelector('button:not([disabled])');
      if (c.keys && first) first.focus({ preventScroll: true });
      else menu.focus({ preventScroll: true });
      /* a mark's own bars (Delete; Done) would sit under the menu: hidden
         while it is open (app.css), whatever shows it meanwhile */
      document.body.classList.add('pgmenu-open');
    }
    function hide() {
      if (menu.hidden) return;
      const c = at;
      menu.hidden = true; at = null;
      document.body.classList.remove('pgmenu-open');
      if (c && c.mark && X.syncMarkPop) X.syncMarkPop();
    }
    X.pageMenu = { open: function () { return !menu.hidden; }, hide: hide };

    function itemOf(target) {
      for (let i = 0; i < S.items.length; i++) {
        const it = S.items[i];
        if (it.box && it.box.contains(target)) return i;
      }
      return -1;
    }

    /* the menu for page i, at (x, y); t: what was right-clicked, if anything */
    function openAt(i, x, y, t, keys) {
      const it = S.items[i];
      const onMark = !!t && S.tool === 'select' && S.sel && S.sel.it === it &&
        it.anno && it.anno.contains(t) && t !== it.anno;
      show({
        it: it, n: i + 1, x: x, y: y, keys: !!keys,
        mark: onMark, many: onMark && X.selList ? X.selList().length : 1
      });
    }
    /* the page in view, a little in from its corner (the keyboard's way in) */
    function openForKeys() {
      const i = S.current - 1, it = S.items[i];
      if (!it || !it.box) return;
      const r = it.box.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      openAt(i, Math.max(r.left, sr.left) + 40, Math.max(r.top, sr.top) + 40, null, true);
    }

    stage.addEventListener('contextmenu', function (e) {
      /* a tool that uses the right button (ending a chain of dimensions) */
      if (e.defaultPrevented || !S.items.length) return;
      const t = e.target;
      if (t.closest && t.closest('textarea, input, select, [contenteditable="true"]')) return;
      if (X.isMobile && X.isMobile()) return;
      e.preventDefault();
      /* the menu key in a browser that sends no keydown for it first */
      if (e.button !== 2 && !e.clientX && !e.clientY) { openForKeys(); return; }
      const i = itemOf(t);
      if (i < 0) return;
      openAt(i, e.clientX, e.clientY, t);
    });
    /* Shift+F10 and the menu key, the keyboard's right-click */
    document.addEventListener('keydown', function (e) {
      if (!((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') || !S.items.length) return;
      const t = e.target;
      if (t.closest && t.closest('textarea, input, select, [contenteditable="true"], .pop, [role="dialog"]')) return;
      if (X.isMobile && X.isMobile()) return;
      e.preventDefault();
      openForKeys();
    });

    /* a click replayed where the menu was opened, for a tool that places
       a mark with one (the comment and text tools) */
    function clickAt(it, x, y) {
      const el = it.capture;
      if (!el) return;
      const o = { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ buttons: 1 }, o)));
      el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ buttons: 0 }, o)));
      el.dispatchEvent(new MouseEvent('click', o));
    }

    function copyText() {
      let done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      if (!done && navigator.clipboard && X.selectedText) {
        navigator.clipboard.writeText(X.selectedText() || '').then(function () { X.toast('Text copied'); },
          function () { X.toast('Could not copy: press Ctrl+C'); });
        return;
      }
      X.toast(done ? 'Text copied' : 'Could not copy: press Ctrl+C');
    }

    function selectAll(it) {
      if (!it.tl || !it.tl.firstChild) { X.toast('No text on this page to select'); return; }
      const r = document.createRange();
      r.selectNodeContents(it.tl);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    }

    function run(a, c) {
      const it = c.it, n = c.n;
      switch (a) {
        case 'copy': copyText(); break;
        case 'selall': selectAll(it); break;
        case 'hl': X.applyMarkup('highlight'); break;
        case 'note': X.setTool('note'); clickAt(it, c.x, c.y); break;
        case 'text': X.setTool('text'); clickAt(it, c.x, c.y); break;
        case 'rot': X.rotateItem(n - 1, 90); break;
        case 'blank': X.setCurrent(n); X.insertBlank(); break;
        case 'extract':
          if (X.organize && X.organize.extractSelected) {
            X.setPicks([n]);
            Promise.resolve(X.organize.extractSelected(null)).then(function () { X.setPicks([]); });
          }
          break;
        case 'delpage': X.removeItem(n - 1); break;
        case 'zin': X.zoomTo(X.zoom() * 1.25, c.x, c.y); break;
        case 'fit': X.fitPage(); break;
        case 'print': X.print(); break;
        case 'mkedit': X.editText(it, S.sel.i); break;
        case 'mkdup': X.duplicateSelected(); break;
        case 'mkfront': X.stackSelected('front'); break;
        case 'mkup': X.stackSelected('up'); break;
        case 'mkdown': X.stackSelected('down'); break;
        case 'mkback': X.stackSelected('back'); break;
        case 'mkdel': X.deleteSelected(); break;
      }
    }

    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || b.disabled || !at) return;
      const c = at;
      hide();
      run(b.dataset.a, c);
    });
    /* the keys of any menu: arrows move, Enter or Space picks, Esc closes */
    menu.addEventListener('keydown', function (e) {
      const list = Array.prototype.slice.call(menu.querySelectorAll('button:not([disabled])'));
      const k = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = list[(k + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length];
        if (next) next.focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const next = e.key === 'Home' ? list[0] : list[list.length - 1];
        if (next) next.focus();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        hide();
        stage.focus({ preventScroll: true });
      }
      /* every other key stays here: a letter is not a tool shortcut while
         the menu is open */
      e.stopPropagation();
    });
    document.addEventListener('pointerdown', function (e) {
      if (!menu.hidden && !menu.contains(e.target)) hide();
    }, true);
    /* scrolled by the reader (a scroll of the app's own, as pages take their
       sizes, leaves it open) */
    stage.addEventListener('wheel', hide, { passive: true });
    stage.addEventListener('touchmove', hide, { passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    X.on('tool', hide);
  });
})();
