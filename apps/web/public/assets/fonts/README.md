# Fonts for saved PDFs

Loaded by `js/core.js` only when a save has text the standard PDF fonts cannot
draw, then embedded into the PDF as a subset of the characters used.

| File | What | Source |
| --- | --- | --- |
| `DejaVuSans.ttf` | ✓ →, Greek, Cyrillic and most symbols | npm `dejavu-fonts-ttf@2.37.3`, `ttf/DejaVuSans.ttf` (pinned in `packages/engine`) |
| `NotoEmoji.ttf` | black-and-white emoji | built by `scripts/fonts/build-noto-emoji.py` from `ofl/notoemoji/NotoEmoji[wght].ttf` in github.com/google/fonts at commit `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`: fixed at the regular weight, every glyph padded to 4 bytes (see the script for why) |

Licences: `DejaVuSans-LICENSE.txt` (Bitstream Vera / DejaVu), `NotoEmoji-LICENSE.txt`
(SIL Open Font License 1.1; the build is a modified version under the same
licence). `apps/web/test/shell.test.ts` checks each file is byte-identical to
its source or build, and that every glyph has an even length.
