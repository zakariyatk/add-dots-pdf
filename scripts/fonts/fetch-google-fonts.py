"""Fetches the Google Fonts the Text tool offers, into
apps/web/public/assets/fonts/google/, and writes the list the app reads
(apps/web/public/js/fonts-list.js).

Each family comes in up to four styles (regular, bold, italic, bold italic),
as the static TrueType files the Google Fonts CSS API serves. Every glyph is
padded to a multiple of 4 bytes, for the reason given in build-noto-emoji.py:
fontkit, which embeds a subset of a font into a saved PDF, would otherwise
shift the glyphs after an odd-length one and they would print blank. Each
family's licence (SIL OFL 1.1 or Apache 2.0) is fetched from
github.com/google/fonts and kept beside its files.

    python3 -m venv .venv && .venv/bin/pip install fonttools==4.60.1
    .venv/bin/python scripts/fonts/fetch-google-fonts.py
"""

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/web/public/assets/fonts/google"
LIST = ROOT / "apps/web/public/js/fonts-list.js"

# name, CSS fallback
FAMILIES = [
    ("Roboto", "sans-serif"),
    ("Open Sans", "sans-serif"),
    ("Lato", "sans-serif"),
    ("Montserrat", "sans-serif"),
    ("Poppins", "sans-serif"),
    ("Inter", "sans-serif"),
    ("Noto Sans", "sans-serif"),
    ("Source Sans 3", "sans-serif"),
    ("Raleway", "sans-serif"),
    ("Nunito", "sans-serif"),
    ("Ubuntu", "sans-serif"),
    ("PT Sans", "sans-serif"),
    ("Fira Sans", "sans-serif"),
    ("Work Sans", "sans-serif"),
    ("Oswald", "sans-serif"),
    ("Merriweather", "serif"),
    ("Playfair Display", "serif"),
    ("Lora", "serif"),
    ("PT Serif", "serif"),
    ("Noto Serif", "serif"),
    ("Roboto Slab", "serif"),
    ("Libre Baskerville", "serif"),
    ("EB Garamond", "serif"),
    ("Crimson Text", "serif"),
    ("Roboto Mono", "monospace"),
    ("Dancing Script", "cursive"),
    ("Caveat", "cursive"),
    ("Pacifico", "cursive"),
    ("Great Vibes", "cursive"),
    ("Bebas Neue", "sans-serif"),
]

# regular, bold, italic, bold italic: the order core.js's fontIdx counts in
STYLES = [("r", 0, 400), ("b", 0, 700), ("i", 1, 400), ("bi", 1, 700)]


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as r:
        return r.read()


def css_for(name: str) -> str:
    """The family's @font-face rules, asking for every style it has."""
    fam = name.replace(" ", "+")
    for axes in (":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", ":ital@0;1", ""):
        try:
            return get(f"https://fonts.googleapis.com/css2?family={fam}{axes}").decode()
        except urllib.error.HTTPError:
            continue  # a style the family lacks: ask for fewer
    sys.exit(f"{name}: not on Google Fonts")


def licence(name: str) -> str:
    d = re.sub(r"[^a-z0-9]", "", name.lower())
    for path in (f"ofl/{d}/OFL.txt", f"apache/{d}/LICENSE.txt", f"ufl/{d}/UFL.txt"):
        try:
            return get(f"https://raw.githubusercontent.com/google/fonts/main/{path}").decode()
        except urllib.error.HTTPError:
            continue
    sys.exit(f"{name}: no licence found in google/fonts")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    out = []
    for name, fallback in FAMILIES:
        fid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        css = css_for(name)
        faces = {}
        for block in re.findall(r"@font-face\s*{([^}]*)}", css):
            style = 1 if "font-style: italic" in block else 0
            weight = int(re.search(r"font-weight:\s*(\d+)", block).group(1))
            url = re.search(r"url\((https://[^)]+\.ttf)\)", block)
            if url:
                faces[(style, weight)] = url.group(1)
        have = []
        for key, ital, wght in STYLES:
            url = faces.get((ital, wght))
            if not url:
                have.append(0)
                continue
            path = OUT / f"{fid}-{key}.ttf"
            path.write_bytes(get(url))
            font = TTFont(path, recalcTimestamp=False)
            font["glyf"].padding = 4
            font.save(path)
            have.append(1)
        if not have[0]:
            sys.exit(f"{name}: no regular style")
        (OUT / f"{fid}-LICENSE.txt").write_text(licence(name))
        out.append({"id": fid, "name": name, "fallback": fallback, "styles": have})
        print(f"{name}: {''.join(k for (k, _, _), h in zip(STYLES, have) if h)}")

    LIST.write_text(
        "/* The Google Fonts the Text tool offers: written by\n"
        "   scripts/fonts/fetch-google-fonts.py, with their files in\n"
        "   assets/fonts/google/. styles: has regular, bold, italic, bold italic. */\n"
        "self.ADDDOTS_FONT_LIST = "
        + "[\n  "
        + ",\n  ".join(json.dumps(f, ensure_ascii=False) for f in out)
        + "\n];\n"
    )


if __name__ == "__main__":
    main()
