#!/usr/bin/env python3
"""Meme card for the morning recap: a player's headshot on his team colours, with an
Impact-style caption on top and bottom (font: Anton, SIL OFL, img/fonts/).

Used by recap.py. Needs Pillow (in requirements.txt; on the PC it runs through `uv run --with pillow`).
  python scripts/meme.py <playerId> <TEAM> "top text" "bottom text" out.png   # try one by hand
"""
import io
import sys
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

SIZE = 720
FONT = Path(__file__).resolve().parent.parent / "img/fonts/Anton-Regular.ttf"
TEAM_COLORS = {  # primary jersey colour per NHL team
    "ANA": "#F47A38", "BOS": "#FFB81C", "BUF": "#003087", "CAR": "#CE1126", "CBJ": "#002654",
    "CGY": "#C8102E", "CHI": "#CF0A2C", "COL": "#6F263D", "DAL": "#006847", "DET": "#CE1126",
    "EDM": "#041E42", "FLA": "#C8102E", "LAK": "#111111", "MIN": "#154734", "MTL": "#AF1E2D",
    "NJD": "#CE1126", "NSH": "#FFB81C", "NYI": "#00539B", "NYR": "#0038A8", "OTT": "#C52032",
    "PHI": "#F74902", "PIT": "#FCB514", "SEA": "#001628", "SJS": "#006D75", "STL": "#002F87",
    "TBL": "#002868", "TOR": "#00205B", "UTA": "#6CACE4", "VAN": "#00205B", "VGK": "#B4975A",
    "WPG": "#041E42", "WSH": "#C8102E",
}


def headshot(player_id):
    r = requests.get(f"https://assets.nhle.com/mugs/nhl/latest/{player_id}.png", timeout=20)
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGBA")


def background(team):
    base = Image.new("RGB", (1, 1), TEAM_COLORS.get(team, "#0D2240")).getpixel((0, 0))
    bg = Image.new("RGB", (SIZE, SIZE))
    px = bg.load()
    cx, cy = SIZE / 2, SIZE * .55
    for y in range(SIZE):
        for x in range(SIZE):
            # Spotlight behind the player, fading to a darker edge
            d = min(1, (((x - cx) ** 2 + (y - cy) ** 2) ** .5) / (SIZE * .75))
            k = 1.15 - .75 * d
            px[x, y] = tuple(max(0, min(255, int(c * k + 18 * (1 - d)))) for c in base)
    return bg


def fit_lines(draw, text, max_w, start, min_size, max_lines=2):
    """Largest font (and line split) that fits `text` in max_lines within max_w."""
    words = text.upper().split()
    for size in range(start, min_size - 1, -2):
        font = ImageFont.truetype(str(FONT), size)
        lines, line = [], ""
        for w in words:
            trial = f"{line} {w}".strip()
            if draw.textlength(trial, font=font) <= max_w:
                line = trial
            else:
                lines.append(line)
                line = w
        lines.append(line)
        if len(lines) <= max_lines and all(draw.textlength(l, font=font) <= max_w for l in lines):
            return font, lines
    return font, lines[:max_lines]


def caption(draw, text, top):
    font, lines = fit_lines(draw, text, SIZE - 60, 78, 34)
    lh = font.size * 1.12
    y = 22 if top else SIZE - 26 - lh * len(lines)
    for line in lines:
        w = draw.textlength(line, font=font)
        draw.text(((SIZE - w) / 2, y), line, font=font, fill="white",
                  stroke_width=max(3, font.size // 14), stroke_fill="black")
        y += lh


def render(player_id, team, top, bottom, out, stamp=""):
    img = background(team).convert("RGBA")
    mug = headshot(player_id).resize((600, 600), Image.LANCZOS)
    img.alpha_composite(mug, ((SIZE - 600) // 2, SIZE - 600))
    # Darken the bottom so the caption reads over the jersey
    shade = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for i in range(220):
        sd.line([(0, SIZE - i), (SIZE, SIZE - i)], fill=(0, 0, 0, int(150 * (1 - i / 220))))
    img.alpha_composite(shade)
    draw = ImageDraw.Draw(img)
    caption(draw, top, True)
    caption(draw, bottom, False)
    if stamp:
        small = ImageFont.truetype(str(FONT), 18)
        draw.text((SIZE - 12 - draw.textlength(stamp, font=small), SIZE - 26), stamp, font=small, fill=(255, 255, 255, 170))
    # 256 colours (dithered so faces stay smooth) keeps a day's card around 150 KB in the repo
    img.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out, optimize=True)


if __name__ == "__main__":
    render(int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
