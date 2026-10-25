/* Add Dots PDF — tools for the Windows app
   ---------------------------------------
   The website keeps the everyday tools; the heavy ones — editing the PDF's
   own content (Edit Object), Convert and OCR — are in the Windows app, which
   has the memory and the processor for them. On the website their buttons
   stay, with a Windows badge, and opening one says where it is, with a link
   to the app in the Microsoft Store. In the Windows app (window.__TAURI__,
   or its parent's in a document tab) nothing changes.

   X.winOnly(feature) is what each tool asks before it starts: true means
   "not here" (the card is showing). The smoke test sets
   window.ADDDOTS_ALL_TOOLS to use them all in a browser. Loads after the
   modules, so their buttons are there to badge. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[winonly] core bridge missing'); return; }

  let tauri = window.__TAURI__;
  try { if (!tauri && window.parent !== window) tauri = window.parent.__TAURI__; } catch (e) { /* not the app's */ }
  const STORE = 'https://apps.microsoft.com/detail/9PGHPBRMLQMS';

  const FEATURES = {
    editobj: { name: 'Edit Object', what: 'Edit the shapes and text the PDF itself is made of: move, resize, recolour or delete them.',
      buttons: ['tEditObj'] },
    convert: { name: 'Convert', what: 'Turn a PDF into Word, Excel, PowerPoint, pictures, text or an AutoCAD drawing.',
      buttons: ['btnToWord', 'btnToExcel', 'btnToPpt', 'btnToImg', 'btnToTxt', 'btnToCad'] },
    ocr: { name: 'OCR', what: 'Read the text on scanned pages, so it can be searched and copied.',
      buttons: ['btnOcr'] }
  };

  function here() { return !!tauri || !!window.ADDDOTS_ALL_TOOLS; }

  let card = null;
  function show(f) {
    if (!card) {
      card = document.createElement('div');
      card.className = 'wocard'; card.id = 'winOnly'; card.hidden = true;
      card.innerHTML =
        '<div class="wobox" role="dialog" aria-modal="true" aria-labelledby="woTitle">' +
        '<svg class="wologo" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8"/>' +
        '<rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/>' +
        '<rect x="13" y="13" width="8" height="8"/></svg>' +
        '<b id="woTitle"></b><p id="woWhat"></p>' +
        '<p class="wonote">It runs in the Add Dots PDF app for Windows, which has the memory and speed big ' +
        'files need. Everything else works here as before.</p>' +
        '<div class="woacts"><button type="button" class="btn" id="woClose">Not now</button>' +
        '<a class="btn primary" id="woGet" href="' + STORE + '" target="_blank" rel="noopener">' +
        'Get it from the Microsoft Store</a></div></div>';
      document.body.appendChild(card);
      const close = function () { card.hidden = true; };
      card.querySelector('#woClose').addEventListener('click', close);
      card.querySelector('#woGet').addEventListener('click', close);
      card.addEventListener('mousedown', function (e) { if (e.target === card) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !card.hidden) close(); });
    }
    card.querySelector('#woTitle').textContent = f.name + ' is in the Windows app';
    card.querySelector('#woWhat').textContent = f.what;
    card.hidden = false;
    card.querySelector('#woGet').focus();
  }

  X.winOnly = function (feature) {
    const f = FEATURES[feature];
    if (!f || here()) return false;
    show(f);
    return true;
  };

  X.on('ready', function () {
    if (here()) return;
    Object.keys(FEATURES).forEach(function (k) {
      FEATURES[k].buttons.forEach(function (id) {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.add('winonly');
        b.title = (b.title ? b.title + '\n' : '') + 'In the Windows app';
      });
    });
    /* however the tool is picked up (a shortcut, a menu), it is put down again */
    X.on('tool', function (t) {
      /* after core has finished picking it up */
      if (t === 'editobj' && X.winOnly('editobj')) setTimeout(function () { X.setTool('select'); }, 0);
    });
  });
})();
