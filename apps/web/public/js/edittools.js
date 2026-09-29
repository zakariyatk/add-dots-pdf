/* ADD DOTS PDF — Edit tools on a phone ("03 Editor" in
   design/AD PDF Editor iOS.dc.html)
   ------------------------------------------------------
   Five large tiles above the dock for what a phone reaches for most:
   Select, Text, Highlight, Pen and Undo. Each presses the button that
   already does it, so the dock and the tiles never disagree; the tile of
   the tool in use is dark teal, and Undo fades when there is nothing to
   undo. Phones only (brand.css), and only with a document open. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[edittools] core bridge missing'); return; }

  X.on('ready', function () {
    const $ = X.$;
    const TILES = [
      ['tSelect', 'select', 'Select', 'M5 3l14 8-6 1.4L10 19z'],
      ['tText', 'text', 'Text', 'M5 7V4h14v3M12 4v16M9 20h6'],
      ['tHighlight', 'highlight', 'Highlight', 'M9 11l6-6 4 4-6 6M9 11l-4 4v4h4l4-4M3 21h18'],
      ['tInk', 'ink', 'Pen', 'M3 17c3 0 4-6 6-6s1 5 3 5 3-3 5-3'],
      ['btnUndo', null, 'Undo', 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12h-3']
    ];

    const el = document.createElement('div');
    el.className = 'etools'; el.id = 'etools';
    el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Edit tools');
    el.innerHTML = TILES.map(function (t) {
      return '<button type="button" data-for="' + t[0] + '"' + (t[1] ? ' data-tool="' + t[1] + '" aria-pressed="false"' : '') +
        ' aria-label="' + t[2] + '" title="' + t[2] + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + t[3] + '"/></svg></button>';
    }).join('');
    const dock = $('dock');
    if (!dock) return;
    dock.before(el);

    el.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const target = $(b.dataset.for);
      if (target && !target.disabled) target.click();
    });

    /* the tool in use, as the dock shows it */
    function showTool(t) {
      el.querySelectorAll('[data-tool]').forEach(function (b) {
        const on = b.dataset.tool === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    X.on('tool', showTool);
    showTool(X.S.tool || 'select');

    /* Undo only when there is something to undo */
    const undo = $('btnUndo'), tile = el.querySelector('[data-for="btnUndo"]');
    const syncUndo = function () { tile.disabled = !undo || undo.disabled; };
    if (undo) new MutationObserver(syncUndo).observe(undo, { attributes: true, attributeFilter: ['disabled'] });
    syncUndo();
  });
})();
