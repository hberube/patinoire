#!/usr/bin/env python3
"""Meme cards for the morning recap (font: Anton, SIL OFL, img/fonts/), in three formats so the
memes don't all look alike:
  classic   one picture, Impact-style caption on top and bottom
  versus    two stacked panels, "NON" then "OUI" (the Drake format, without Drake)
  breaking  a TV news screen: the picture, a "BULLETIN SPÉCIAL" banner, a headline and a ticker
The picture is an NHL player's headshot on his team colours, or a participant's own team logo or
photo (img/teams/, from data/logos.json).

Used by recap.py. Needs Pillow (in requirements.txt; on the PC it runs through `uv run --with pillow`).
  python scripts/meme.py <playerId> <TEAM> "top text" "bottom text" out.png   # try a classic by hand
"""
import io
import sys
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

SIZE = 720
ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "img/fonts/Anton-Regular.ttf"
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


def team_picture(participant_id):
    """A participant's team logo (or photo), from img/teams/ through data/logos.json."""
    import json
    imgs = json.loads((ROOT / "data/logos.json").read_text(encoding="utf-8")).get(participant_id, {})
    src = (imgs.get("logo") or imgs.get("face") or "").split("?")[0]
    if not src:
        raise ValueError(f"no image for {participant_id}")
    return Image.open(ROOT / src).convert("RGBA")


def picture(subject):
    """{"kind": "player", "id": 8478402} or {"kind": "team", "id": "usr_eve"} -> RGBA image."""
    return headshot(subject["id"]) if subject["kind"] == "player" else team_picture(subject["id"])


def save_card(img, out):
    # 256 colours (dithered so faces stay smooth) keeps a day's card around 150 KB in the repo
    img.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out, optimize=True)


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
    """Classic meme on an NHL player (kept for recap.py's older calls)."""
    render_classic({"kind": "player", "id": player_id}, team, top, bottom, out, stamp)


def render_classic(subject, team, top, bottom, out, stamp=""):
    img = background(team).convert("RGBA")
    if subject["kind"] == "player":
        mug = picture(subject).resize((600, 600), Image.LANCZOS)
        img.alpha_composite(mug, ((SIZE - 600) // 2, SIZE - 600))
    else:  # a participant's logo or photo, framed in the middle
        pic = square(picture(subject), 430)
        img.alpha_composite(pic, ((SIZE - 430) // 2, 150))
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
    save_card(img, out)


def square(img, size, radius=36):
    """img cropped to a centred square of `size`, with rounded corners."""
    w, h = img.size
    side = min(w, h)
    img = img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    bg.alpha_composite(img)
    bg.putalpha(mask)
    return bg


def text_block(draw, text, box, color, start=64, min_size=26, max_lines=3, align="left"):
    """Text fitted in box = (x, y, w, h), vertically centred."""
    x, y, w, h = box
    font, lines = fit_lines(draw, text, w, start, min_size, max_lines)
    lh = font.size * 1.1
    ty = y + (h - lh * len(lines)) / 2
    for line in lines:
        lw = draw.textlength(line, font=font)
        draw.text((x + (w - lw) / 2 if align == "center" else x, ty), line, font=font, fill=color)
        ty += lh


def mark(draw, x, y, ok):
    """A big ✓ (green) or ✗ (red) drawn with lines (no emoji font needed)."""
    color = "#16a34a" if ok else "#dc2626"
    draw.ellipse((x, y, x + 120, y + 120), fill=color)
    if ok:
        draw.line([(x + 30, y + 62), (x + 52, y + 86), (x + 92, y + 36)], fill="white", width=14, joint="curve")
    else:
        draw.line([(x + 36, y + 36), (x + 84, y + 84)], fill="white", width=14)
        draw.line([(x + 84, y + 36), (x + 36, y + 84)], fill="white", width=14)


def render_versus(no_subject, no_text, yes_subject, yes_text, out, labels=("NON", "OUI")):
    """Two stacked panels: the thing we reject (top, ✗) and the one we love (bottom, ✓)."""
    img = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    half = SIZE // 2
    for i, (subject, text, ok, label) in enumerate([(no_subject, no_text, False, labels[0]), (yes_subject, yes_text, True, labels[1])]):
        y0 = i * half
        draw.rectangle((0, y0, SIZE, y0 + half), fill="#fde2e2" if not ok else "#dcfce7")
        pic = square(picture(subject), 300, 28)
        img.alpha_composite(pic, (30, y0 + 30))
        mark(draw, 250, y0 + 200, ok)
        small = ImageFont.truetype(str(FONT), 30)
        draw.text((360, y0 + 26), label, font=small, fill="#dc2626" if not ok else "#16a34a")
        text_block(draw, text.upper(), (360, y0 + 64, SIZE - 390, half - 94), "#111111", start=54, min_size=24, max_lines=5)
    draw.line([(0, half), (SIZE, half)], fill="#111111", width=4)
    save_card(img, out)


def render_breaking(subject, team, label, headline, ticker, out):
    """A TV news screen: picture, red BREAKING banner, big headline, scrolling-ticker line."""
    img = background(team).convert("RGBA")
    if subject["kind"] == "player":
        mug = picture(subject).resize((520, 520), Image.LANCZOS)
        img.alpha_composite(mug, ((SIZE - 520) // 2, 30))
    else:
        img.alpha_composite(square(picture(subject), 380), ((SIZE - 380) // 2, 70))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 470, SIZE, 520), fill="#c8102e")
    lf = ImageFont.truetype(str(FONT), 34)
    draw.text((24, 474), label.upper(), font=lf, fill="white")
    draw.rectangle((0, 520, SIZE, 660), fill="#ffffff")
    text_block(draw, headline.upper(), (24, 526, SIZE - 48, 128), "#0d1b2a", start=58, min_size=26, max_lines=2)
    draw.rectangle((0, 660, SIZE, SIZE), fill="#0d1b2a")
    tf = ImageFont.truetype(str(FONT), 28)
    t = ticker.upper()
    if draw.textlength(t, font=tf) > SIZE - 40:
        while draw.textlength(t + "…", font=tf) > SIZE - 40 and len(t) > 10:
            t = t[:-1]
        t = t.rstrip(" ·,") + "…"
    draw.text((20, 672), t, font=tf, fill="#ffd166")
    save_card(img, out)


if __name__ == "__main__":
    render(int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
