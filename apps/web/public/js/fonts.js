/* Add Dots PDF — Google Fonts for text
   ------------------------------------
   The fonts the Text tool offers beyond Helvetica, Times and Courier: the
   families in js/fonts-list.js, their files in assets/fonts/google/ (fetched
   by scripts/fonts/fetch-google-fonts.py). A text mark in one names it as
   'g:<id>'.

   On screen each is an @font-face the browser loads the first time it is
   used. A style the family lacks (Pacifico has no bold) is given the nearest
   one it has, the same file the saved PDF embeds, so the page and the PDF
   agree. Saving embeds the file as a subset of the characters used (core.js,
   save-worker.js). Loads before core.js. */
(function () {
  'use strict';

  const list = window.ADDDOTS_FONT_LIST || [];
  const byId = {};
  list.forEach(function (f) { byId['g:' + f.id] = f; });
  const KEYS = ['r', 'b', 'i', 'bi'];
  /* nearest style the family has: bold italic → bold → italic → regular */
  const NEAR = [[0], [1, 0], [2, 0], [3, 1, 2, 0]];

  function file(f, style) {
    const fam = byId[f];
    if (!fam) return null;
    const k = NEAR[style].filter(function (i) { return fam.styles[i]; })[0] || 0;
    return 'assets/fonts/google/' + fam.id + '-' + KEYS[k] + '.ttf';
  }
  function cssName(fam) { return 'ADG ' + fam.name; }

  /* every style of every family, each pointing at the file that draws it */
  const rules = [];
  list.forEach(function (fam) {
    for (let s = 0; s < 4; s++) {
      rules.push('@font-face{font-family:"' + cssName(fam) + '";font-weight:' + (s & 1 ? 700 : 400) +
        ';font-style:' + (s & 2 ? 'italic' : 'normal') + ';font-display:swap;src:url("' +
        file('g:' + fam.id, s) + '") format("truetype")}');
    }
  });
  const st = document.createElement('style');
  st.id = 'gfonts';
  st.textContent = rules.join('\n');
  document.head.appendChild(st);

  window.ADDDOTS_FONTS = {
    list: list,
    is: function (f) { return !!byId[f]; },
    /* the CSS font-family of 'g:<id>' */
    css: function (f) {
      const fam = byId[f];
      return fam ? '"' + cssName(fam) + '", ' + fam.fallback : null;
    },
    name: function (f) { return byId[f] ? byId[f].name : null; },
    /* the file for a style (fontIdx: 0 regular, 1 bold, 2 italic, 3 bold italic) */
    file: file,
    /* <option>s for a font <select>: the standard three, then these */
    options: function () {
      return '<optgroup label="Standard">' +
        '<option value="helv">Helvetica</option><option value="times">Times</option>' +
        '<option value="cour">Courier</option></optgroup>' +
        '<optgroup label="Google Fonts">' + list.map(function (fam) {
          return '<option value="g:' + fam.id + '" style="font-family:\'' + cssName(fam) + '\',' +
            fam.fallback + '">' + fam.name + '</option>';
        }).join('') + '</optgroup>';
    }
  };
})();
