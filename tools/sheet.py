#!/usr/bin/env python3
"""Saves one picture of every scene in the mock window, light beside dark, to look at them together.

    python3 tools/sheet.py /some/folder        # writes all-scenes.png there
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from build import ORDER  # noqa: E402
from dither import alone  # noqa: E402
from look import CHROME, page  # noqa: E402


def main():
    from PIL import Image, ImageDraw, ImageFont

    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    w, h, pad, label = 1000, 650, 14, 40
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    rows = []
    for name in ORDER:
        try:
            module = importlib.import_module(f"scene_{name}")
        except ModuleNotFoundError:
            continue
        pair = []
        for tag, picture, dark in (("light", module.day(), False), ("dark", module.night(), True)):
            html = out / f"_{module.ID}_{tag}.html"
            png = out / f"_{module.ID}_{tag}.png"
            html.write_text(page(alone(picture), dark))
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=2000,1300", f"--screenshot={png}", f"file://{html}"], check=True, capture_output=True)
            pair.append(Image.open(png).resize((w, h), Image.LANCZOS))
            html.unlink()
            png.unlink()
        rows.append((module.NAME, pair))
    sheet = Image.new("RGB", (2 * w + 3 * pad, len(rows) * (h + label + pad) + pad), (236, 233, 224))
    d = ImageDraw.Draw(sheet)
    for i, (name, pair) in enumerate(rows):
        y = pad + i * (h + label + pad)
        d.text((pad + 2, y + 6), f"{i + 1}. {name}", font=font, fill=(40, 38, 34))
        sheet.paste(pair[0], (pad, y + label))
        sheet.paste(pair[1], (2 * pad + w, y + label))
    sheet.save(out / "all-scenes.png")
    print(f"{out / 'all-scenes.png'}: {len(rows)} scenes")


if __name__ == "__main__":
    main()
