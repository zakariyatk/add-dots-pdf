"""Builds apps/web/public/assets/fonts/NotoEmoji.ttf from Google's Noto Emoji.

fontkit, which pdf-lib uses to subset a font into a PDF, writes the subset's
glyph offsets in the short format (halved) whenever they fit, but copies each
glyph as it is. The upstream font stores 788 glyphs at odd lengths, so every
glyph after one of them lands at the wrong offset: unreadable, printed blank.
This pads every glyph to a multiple of 4 bytes. It also fixes the weight at
regular: the upstream font is variable, and fontkit re-encodes every glyph of
a variable font (dropping its hinting) on the way into a subset. Everything
else is kept: cmap, metrics, and the GSUB ligatures that join emoji sequences
such as 👨‍👩‍👧 and 🇸🇦.

    python3 -m venv .venv && .venv/bin/pip install fonttools==4.60.1
    .venv/bin/python scripts/fonts/build-noto-emoji.py NotoEmoji[wght].ttf

The input is ofl/notoemoji/NotoEmoji[wght].ttf from github.com/google/fonts at
commit 23e54b51ddffbc7713c583748e3bd86f62b1fa4a (sha256 below). The output is
deterministic; apps/web/test/shell.test.ts checks its sha256.
"""

import hashlib
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE_SHA256 = "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551"
OUT = Path(__file__).resolve().parents[2] / "apps/web/public/assets/fonts/NotoEmoji.ttf"


def main(src: str) -> None:
    data = Path(src).read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        sys.exit("not the pinned NotoEmoji[wght].ttf (sha256 differs)")

    font = TTFont(src, recalcTimestamp=False)
    font = instantiateVariableFont(font, {"wght": 400})

    font["glyf"].padding = 4

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(OUT, hashlib.sha256(OUT.read_bytes()).hexdigest())


if __name__ == "__main__":
    main(sys.argv[1])
