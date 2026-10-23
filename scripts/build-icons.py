#!/usr/bin/env python3
"""Rasterises the app icon into every size the app and browsers ask for.

Source of truth is `public/icon.svg` (full-bleed, used at 180px and up) and
`public/favicon.svg` (rounded corners, used for tab icons and the .ico). Both
are rendered at 1024 with macOS QuickLook, then downsampled with Lanczos.

QuickLook flattens SVG onto white, so the rounded variant gets its corners
rebuilt as alpha -- inset by two source pixels to drop the white fringe.

Needs macOS (`qlmanage`) and Pillow. Re-run after editing either SVG:

    python3 scripts/build-icons.py
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SOURCE_SIZE = 1024
CORNER_RATIO = 7 / 32  # rx in favicon.svg, relative to its 32px canvas


def render(svg: Path, into: Path) -> Image.Image:
    subprocess.run(
        ["qlmanage", "-t", f"-s{SOURCE_SIZE}", "-o", str(into), str(svg)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    raster = into / f"{svg.name}.png"
    if not raster.exists():
        raise SystemExit(f"QuickLook did not produce {raster}")
    return Image.open(raster).convert("RGB")


def rounded_alpha(image: Image.Image, radius: int, inset: int = 2) -> Image.Image:
    """Cut the flattened rounded square out of its white page."""
    size = image.size[0]
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (inset * scale, inset * scale, (size - inset) * scale - 1, (size - inset) * scale - 1),
        radius=(radius - inset) * scale,
        fill=255,
    )
    mask = mask.resize((size, size), Image.LANCZOS)

    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        master = render(PUBLIC / "icon.svg", work)
        tile = render(PUBLIC / "favicon.svg", work)
        tile = rounded_alpha(tile, round(SOURCE_SIZE * CORNER_RATIO))

        # App icons: full-bleed squares, masked by the OS when it wants to.
        for size in (512, 192, 180):
            name = "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
            master.resize((size, size), Image.LANCZOS).save(
                PUBLIC / name, optimize=True
            )
            print(f"{name}  {size}x{size}")

        # Tab icon: one multi-size .ico. Browsers that understand the vector
        # form use favicon.svg and never ask for this.
        tile.resize((256, 256), Image.LANCZOS).save(
            PUBLIC / "favicon.ico",
            sizes=[(16, 16), (32, 32), (48, 48)],
        )
        print("favicon.ico  16/32/48")


if __name__ == "__main__":
    if sys.platform != "darwin":
        raise SystemExit("This script uses macOS QuickLook to rasterise SVG.")
    main()
