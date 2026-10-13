#!/usr/bin/env python3
"""Publish (or remove) a participant's images: their face and their team logo.

Usage:
  python scripts/set_logo.py <participant_id> <face|logo> <image file>   # e.g. from an email
  python scripts/set_logo.py <participant_id> <face|logo> --remove
  LOGO_B64=... python scripts/set_logo.py <participant_id> <face|logo> --b64   # set-logo.yml

Every image is decoded and re-encoded (never copied as-is) to 256x256: photos are
centre-cropped to a square, logos with transparency are fitted whole. The result is saved
as img/teams/<participant_id>-<kind>.webp and listed in data/logos.json
({participant_id: {"face": url, "logo": url}}) with a version stamp so browsers pick up the new file.
"""
import base64
import io
import os
import re
import sys

from PIL import Image, ImageOps

from pool_lib import ROOT, load, now_iso, save

SIZE = 256
MAX_INPUT = 8 * 1024 * 1024
LOGO_DIR = ROOT / "img" / "teams"
KINDS = ("face", "logo")


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def normalize(raw):
    if len(raw) > MAX_INPUT:
        fail("Image too large.")
    try:
        im = Image.open(io.BytesIO(raw))
        if im.format not in ("PNG", "JPEG", "WEBP", "GIF"):
            fail(f"Unsupported image format {im.format}.")
        im.seek(0)
        im = ImageOps.exif_transpose(im).convert("RGBA")
    except Exception:
        fail("Not a readable image.")
    if im.getchannel("A").getextrema()[0] == 255:
        # Opaque (a photo): crop to a centred square so it fills the round avatar
        canvas = ImageOps.fit(im, (SIZE, SIZE), Image.LANCZOS)
    else:
        # Has transparency (a logo): keep all of it, centred on a transparent square
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    out = io.BytesIO()
    canvas.save(out, "WEBP", quality=88, method=6)
    return out.getvalue()


def main(args):
    if len(args) != 3 or args[1] not in KINDS:
        print(__doc__)
        sys.exit(1)
    pid, kind, source = args
    if not re.fullmatch(r"usr_[a-z_]+", pid) or pid not in {r["participantId"] for r in load("rosters.json")}:
        fail(f"Unknown participant {pid}.")

    logos = load("logos.json", {}) or {}
    entry = logos.setdefault(pid, {})
    target = LOGO_DIR / f"{pid}-{kind}.webp"
    if source == "--remove":
        target.unlink(missing_ok=True)
        entry.pop(kind, None)
        if not entry:
            logos.pop(pid)
        save("logos.json", logos)
        print(f"{kind} removed for {pid}.")
        return

    if source == "--b64":
        data = os.environ.get("LOGO_B64", "")
        data = data.split(",", 1)[1] if data.startswith("data:") else data
        try:
            raw = base64.b64decode(data, validate=True)
        except Exception:
            fail("Logo data is not valid base64.")
    else:
        raw = open(source, "rb").read()

    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    target.write_bytes(normalize(raw))
    stamp = re.sub(r"\D", "", now_iso())
    entry[kind] = f"img/teams/{pid}-{kind}.webp?v={stamp}"
    save("logos.json", logos)
    print(f"{kind} published for {pid} ({target.stat().st_size // 1024} KB).")


if __name__ == "__main__":
    main(sys.argv[1:])
