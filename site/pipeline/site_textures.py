"""Textures for the temple site (design §10.3), in the comic's palette (b1-p011-4, b1-p014-1, b1-p015-1).
Generated, seeded, tileable, built on lodge_textures' noise.

- canvas: the tent's cream cloth, faint seams and sun-bleached stains
- valance: the tent's scalloped edge with its gold-brown border (b1-p011-4), with transparency
- curtain: the deep red side curtains (b1-p011-4, b1-p015-1)
- carpet: a red carpet with a dark border and a repeating medallion (b1-p014-1)
- earth: the dug-over, stony, sun-baked field (novel ¶224, b1-p011-4)
- kund: the altar's brick with its white zigzag band (b1-p015-1)
- durrie: striped cotton mats where the villagers sit (b1-p015-1)
- diagram: the "large sheet of paper ... with a large diagram and text written around it" (novel ¶296)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from lodge_textures import SIZE, noise, rgb, tint, wood


def canvas(rng):
    n = noise(rng, scale=5)
    a = tint((236, 222, 190), n, 0.12)
    for x in range(0, SIZE, SIZE // 4):  # seams where the widths of cloth are stitched
        a[:, x:x + 3] *= 0.86
    stain = noise(rng, scale=3) > 0.68
    a = np.where(stain[..., None], a * 0.96, a)
    return rgb(a)


def valance():
    img = Image.new("RGBA", (SIZE, SIZE // 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    h = SIZE // 4
    d.rectangle([0, 0, SIZE, h * 0.55], fill=(226, 206, 160, 255))
    d.rectangle([0, h * 0.08, SIZE, h * 0.2], fill=(150, 96, 34, 255))   # the gold-brown border
    d.rectangle([0, h * 0.36, SIZE, h * 0.46], fill=(150, 96, 34, 255))
    for i in range(8):  # scallops
        x0 = i * SIZE / 8
        d.pieslice([x0, h * 0.3, x0 + SIZE / 8, h * 0.95], 0, 180, fill=(226, 206, 160, 255))
        d.arc([x0 + 4, h * 0.34, x0 + SIZE / 8 - 4, h * 0.88], 0, 180, fill=(150, 96, 34, 255), width=4)
    return img


def curtain(rng):
    x = np.linspace(0, 24, SIZE)[None, :]
    folds = 0.8 + 0.2 * np.sin(x + 2 * noise(rng, scale=2))
    a = np.asarray((132, 30, 26), float)[None, None, :] * folds[..., None] * np.ones((SIZE, 1, 1))
    return rgb(a * (0.92 + 0.16 * noise(rng, scale=12)[..., None]))


def carpet(rng):
    base = tint((122, 30, 26), noise(rng, scale=30, octaves=2), 0.25)
    img = rgb(base)
    d = ImageDraw.Draw(img)
    s = SIZE
    d.rectangle([0, 0, s - 1, s - 1], outline=(40, 22, 30), width=s // 14)        # the dark border
    d.rectangle([s // 14, s // 14, s - s // 14, s - s // 14], outline=(196, 150, 70), width=4)
    c = s // 2
    for r, col in ((s // 4, (40, 22, 30)), (s // 6, (196, 150, 70)), (s // 10, (30, 60, 70))):
        d.polygon([(c, c - r), (c + r, c), (c, c + r), (c - r, c)], fill=col)  # the medallion
    return img.filter(ImageFilter.GaussianBlur(0.6))


def earth(rng):
    n = noise(rng, scale=12)
    a = tint((192, 160, 112), n, 0.35)
    pebbles = noise(rng, scale=90, octaves=1) > 0.72
    a = np.where(pebbles[..., None], a * 0.78 + 20, a)
    dug = noise(rng, scale=4, octaves=2) > 0.62  # patches turned over in the Shalyodhara
    a = np.where(dug[..., None], a * 0.92, a)
    return rgb(a)


def kund(rng):
    a = tint((150, 74, 46), noise(rng, scale=40, octaves=2), 0.3)
    for y in range(0, SIZE, SIZE // 8):  # brick courses
        a[y:y + 3] *= 0.7
    img = rgb(a)
    d = ImageDraw.Draw(img)
    y0, y1 = SIZE * 0.4, SIZE * 0.6
    pts = [(i * SIZE / 16, y0 if i % 2 else y1) for i in range(17)]
    d.line(pts, fill=(238, 228, 206), width=10)  # the white zigzag band (b1-p015-1)
    return img


def durrie(rng):
    y = np.arange(SIZE)[:, None] // (SIZE // 10)
    a = np.where((y % 2 == 0)[..., None], np.array([160, 92, 66], float), np.array([118, 104, 120], float)) * np.ones((1, SIZE, 1))
    return rgb(a * (0.85 + 0.2 * noise(rng, scale=20)[..., None]))


def diagram():
    img = Image.new("RGB", (SIZE, SIZE * 3 // 4), (226, 214, 180))
    d = ImageDraw.Draw(img)
    w, h = img.size
    cx, cy = w // 2, h // 2
    for k in range(4):  # a temple's plan: nested squares, a cross of axes, a grid of the vaastu mandala
        r = 60 + k * 30
        d.rectangle([cx - r, cy - r * 0.8, cx + r, cy + r * 0.8], outline=(70, 50, 40), width=2)
    for i in range(-3, 4):
        d.line([cx + i * 25, cy - 120, cx + i * 25, cy + 120], fill=(120, 90, 70), width=1)
    d.line([cx, 20, cx, h - 20], fill=(150, 40, 30), width=3)
    d.line([30, cy, w - 30, cy], fill=(150, 40, 30), width=3)
    for row in range(10):  # the "text written around it": lines of script, as strokes
        y = 18 + row * 11 if row < 5 else h - 18 - (row - 5) * 11
        d.line([30, y, w - 30, y], fill=(110, 80, 60), width=2)
    return img


def all_textures(seed: int = 43) -> dict[str, Image.Image]:
    rng = np.random.default_rng(seed)
    return {
        "canvas": canvas(rng),
        "valance": valance(),
        "curtain": curtain(rng),
        "carpet": carpet(rng),
        "earth": earth(rng),
        "kund": kund(rng),
        "durrie": durrie(rng),
        "diagram": diagram(),
        "wood": wood(rng),
    }
