# Fonts for saved PDFs

Loaded by `js/core.js` only when a save has text the standard PDF fonts cannot
draw, then embedded into the PDF as a subset of the characters used.

`google/` holds the 30 Google Fonts the Text tool offers (listed in
`js/fonts-list.js`), each in the styles it has: regular, bold, italic, bold
italic. They are fetched by `scripts/fonts/fetch-google-fonts.py` from the
Google Fonts CSS API, every glyph padded to 4 bytes as NotoEmoji's is (see
below), with each family's licence beside its files (SIL OFL 1.1, Apache 2.0
or the Ubuntu Font Licence). A page loads one only when text uses it, and a
save embeds a subset of it.

| File | What | Source |
| --- | --- | --- |
| `DejaVuSans.ttf` | ✓ →, Greek, Cyrillic and most symbols | npm `dejavu-fonts-ttf@2.37.3`, `ttf/DejaVuSans.ttf` (pinned in `packages/engine`) |
| `NotoEmoji.ttf` | black-and-white emoji | built by `scripts/fonts/build-noto-emoji.py` from `ofl/notoemoji/NotoEmoji[wght].ttf` in github.com/google/fonts at commit `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`: fixed at the regular weight, every glyph padded to 4 bytes (see the script for why) |

Licences: `DejaVuSans-LICENSE.txt` (Bitstream Vera / DejaVu), `NotoEmoji-LICENSE.txt`
(SIL Open Font License 1.1; the build is a modified version under the same
licence). `apps/web/test/shell.test.ts` checks each file is byte-identical to
its source or build, and that every glyph has an even length.
