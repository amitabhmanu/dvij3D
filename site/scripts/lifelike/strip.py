"""Frames into one labelled sheet: python scripts/lifelike/strip.py <dir> <out.jpg> [first] [last] [step] [cols] [width]
Labels each frame with its number, time and beat from <dir>/log.jsonl."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

d, out = Path(sys.argv[1]), sys.argv[2]
first, last, step, cols, width = (int(x) for x in (sys.argv[3:] + ["0", "99999", "1", "6", "1600"][len(sys.argv) - 3:]))
log = {}
if (d / "log.jsonl").exists():
    for line in (d / "log.jsonl").read_text().splitlines():
        r = json.loads(line)
        log[r["n"]] = r
frames = [p for p in sorted(d.glob("[0-9][0-9][0-9][0-9].jpg")) if first <= int(p.stem) <= last][::step]
tw = width // cols
im0 = Image.open(frames[0])
th = round(im0.height * tw / im0.width)
sheet = Image.new("RGB", (cols * tw, ((len(frames) + cols - 1) // cols) * (th + 16)), (20, 20, 20))
dr = ImageDraw.Draw(sheet)
for i, p in enumerate(frames):
    x, y = (i % cols) * tw, (i // cols) * (th + 16)
    sheet.paste(Image.open(p).resize((tw, th)), (x, y))
    r = log.get(int(p.stem), {})
    dr.text((x + 3, y + th + 2), f"{p.stem} {r.get('t', '')}s {r.get('beat') or ''}", fill=(230, 230, 230))
sheet.save(out, quality=85)
print(out, len(frames), "frames")
