"""A labelled contact sheet of face crops: python pipeline/likeness/sheet.py out.jpg <glob or key>... [--cols 8]"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FACES = Path(__file__).resolve().parents[1] / ".cache" / "likeness" / "faces"


def sheet(paths, out, cols=8, size=192):
    rows = (len(paths) + cols - 1) // cols
    img = Image.new("RGB", (cols * size, rows * (size + 18)), (24, 24, 24))
    d = ImageDraw.Draw(img)
    for i, p in enumerate(paths):
        x, y = (i % cols) * size, (i // cols) * (size + 18)
        img.paste(Image.open(p).convert("RGB").resize((size, size)), (x, y))
        d.text((x + 4, y + size + 3), Path(p).stem, fill=(230, 230, 230))
    img.save(out, quality=88)


if __name__ == "__main__":
    args = sys.argv[1:]
    cols = 8
    if "--cols" in args:
        i = args.index("--cols")
        cols = int(args[i + 1])
        del args[i:i + 2]
    out, pats = args[0], args[1:]
    paths = []
    for pat in pats:
        paths += sorted(FACES.glob(pat if pat.endswith(".jpg") or "*" in pat else pat + ".jpg"))
    sheet(paths, out, cols)
