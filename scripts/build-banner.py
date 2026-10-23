#!/usr/bin/env python3
"""Builds the README banner from the generated background plus the real marks.

The background is a generated image (design/hero/bg-a); everything drawn on top
is vector-true: the same node glyph as public/icon.svg and the bundled
Instrument Serif / Inter faces. Rendered at 2x and downsampled so text is crisp.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BG = ROOT / "design" / "hero" / "bg-a.jpg"
OUT = ROOT / "docs" / "banner.png"

W, H = 1600, 700
S = 2  # supersample factor

INK = (8, 9, 10)
TEXT = (242, 241, 237)
MUTED = (166, 172, 176)
LIME = (216, 255, 62)

SERIF = ImageFont.truetype("/private/tmp/instrument-serif-italic.ttf", 86 * S)
SANS = ImageFont.truetype("/private/tmp/inter.ttf", 27 * S)


def load_background() -> Image.Image:
    art = Image.open(BG).convert("RGB").resize((W * S, H * S), Image.LANCZOS)
    # Fade the artwork into the page colour on the left, where the type sits.
    veil = Image.new("L", (W * S, H * S), 0)
    d = ImageDraw.Draw(veil)
    for x in range(W * S):
        t = x / (W * S)
        if t < 0.42:
            a = 245
        elif t < 0.78:
            a = int(245 * (1 - (t - 0.42) / 0.36))
        else:
            a = 0
        d.line([(x, 0), (x, H * S)], fill=a)
    out = Image.composite(Image.new("RGB", art.size, INK), art, veil)
    # Even the un-veiled side sits back a little.
    return Image.blend(out, Image.new("RGB", art.size, INK), 0.18)


def glyph(size: int) -> Image.Image:
    """public/icon.svg's mark, drawn at `size` on a transparent card."""
    u = size / 1024
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    stroke = max(2, round(60 * u))
    r = round(64 * u)

    def box(x, y, w, h, fill=None):
        d.rounded_rectangle(
            [round(x * u), round(y * u), round((x + w) * u), round((y + h) * u)],
            radius=r,
            outline=LIME,
            width=stroke,
            fill=fill,
        )

    box(176, 196, 348, 236)
    box(500, 592, 348, 236, fill=LIME)

    edge = round(44 * u)
    pts = [(350, 432), (350, 514), (674, 514), (674, 592)]
    d.line([(x * u, y * u) for x, y in pts], fill=LIME, width=edge, joint="curve")
    for x, y in pts:
        d.ellipse(
            [x * u - edge / 2, y * u - edge / 2, x * u + edge / 2, y * u + edge / 2],
            fill=LIME,
        )
    return im


def main() -> None:
    canvas = load_background()
    d = ImageDraw.Draw(canvas)

    g = glyph(96 * S)
    canvas.paste(g, (120 * S, 250 * S), g)

    d.text((120 * S, 352 * S), "Boxology", font=SERIF, fill=TEXT)
    d.line([(122 * S, 470 * S), (182 * S, 470 * S)], fill=LIME, width=3 * S)
    d.text(
        (120 * S, 498 * S),
        "Describe a diagram. Get an editable draw.io file back.",
        font=SANS,
        fill=MUTED,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print(f"{OUT.relative_to(ROOT)}  {W}x{H}")


if __name__ == "__main__":
    main()
