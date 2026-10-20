"""Textures for the lodge (design §10.3): surfaces of a colonial house that has
not been kept up, in the comic's palette. Generated, seeded, tileable.

- whitewash: lime-washed plaster, mould streaking down from the roof line
  (novel ¶164), paint peeling in patches to brick (novel ¶164), grime at the foot
- whitewash-grey: the "staid grey" back wall (novel ¶1446)
- tiles: red clay roof tiles in rows, weathered, a few cracked or missing
- flags: worn stone flags for floors, the corridor and the courtyard, cracked
- wood: dark sal-wood (novel ¶194) for beams, doors and furniture
- shutter: faded green paint over wood, flaking (comic b1-p008-2)
- iron: rusting iron (novel ¶163, ¶193)
- gravel, lawn: the drive and the burnt, unkempt lawn (novel ¶163, comic b1-p008-2)
- soot: the kitchen's soot-black end (novel ¶195)
- fretwork: the verandah's fretted frieze, with transparency (novel ¶164, comic b1-p008-2)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512


def noise(rng, size=SIZE, scale=8, octaves=4):
    out = np.zeros((size, size))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = scale * 2 ** o
        grid = rng.random((n + 1, n + 1))
        grid[-1, :], grid[:, -1] = grid[0, :], grid[:, 0]  # tileable
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((size + size // n, size + size // n), Image.BICUBIC)
        out += amp * np.asarray(img, float)[:size, :size] / 255
        total += amp
        amp *= 0.5
    return out / total


def rgb(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def tint(base, n, spread):
    return np.asarray(base, float)[None, None, :] * (1 - spread / 2 + spread * n[..., None])


def whitewash(rng, base=(238, 220, 178)):  # the comic's warm cream (b1-p008-2)
    n = noise(rng, scale=6)
    img = tint(base, n, 0.12)
    # mould: dark streaks running down from the top edge (the roof line)
    streak = np.zeros((SIZE, SIZE))
    for _ in range(40):
        x = rng.integers(0, SIZE)
        length = rng.integers(SIZE // 6, SIZE // 1.6)
        w = rng.integers(2, 9)
        fade = np.linspace(1, 0, length) ** 1.5
        for dx in range(-w, w + 1):
            streak[:length, (x + dx) % SIZE] = np.maximum(streak[:length, (x + dx) % SIZE], fade * (1 - abs(dx) / (w + 1)))
    streak = np.asarray(Image.fromarray((streak * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)), float) / 255
    mould = np.array([88, 92, 70], float)
    img = img * (1 - 0.4 * streak[..., None]) + mould * 0.4 * streak[..., None]
    # peeling: patches where the wash has gone, to plaster and brick
    peel = noise(rng, scale=14, octaves=3) > 0.7  # small flakes, not continents
    brick = tint((168, 102, 72), noise(rng, scale=40, octaves=2), 0.3)
    plaster = tint((210, 188, 146), noise(rng, scale=20), 0.15)
    deep = noise(rng, scale=20) > 0.66
    img = np.where(peel[..., None], np.where(deep[..., None], brick, plaster), img)
    edge = np.asarray(Image.fromarray((peel * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES), float) / 255
    img = img * (1 - 0.2 * edge[..., None])
    # grime toward the foot (the bottom of the texture)
    foot = np.linspace(0, 1, SIZE)[:, None] ** 4
    img = img * (1 - 0.3 * foot[..., None])
    return rgb(img)


def tiles(rng):
    n = noise(rng, scale=10)
    img = tint((170, 74, 48), n, 0.35)
    rows, cols = 16, 10
    h, w = SIZE // rows, SIZE // cols
    a = np.asarray(img).copy()
    for r in range(rows):
        off = (w // 2) * (r % 2)
        y = r * h
        a[y:y + 2] = a[y:y + 2] * 0.45  # the shadow under each course
        for c in range(cols + 1):
            x = (c * w + off) % SIZE
            a[y:y + h, x:x + 1] *= 0.6
            shade = 0.85 + 0.3 * rng.random()
            x2 = min(SIZE, x + w)
            a[y + 2:y + h, x + 1:x2] *= shade
            if rng.random() < 0.04:  # a broken or missing tile
                a[y + 2:y + h, x + 1:x2] = np.array([60, 48, 40])
    mould = noise(rng, scale=4) > 0.62
    a = np.where(mould[..., None], a * 0.7 + np.array([30, 36, 20]), a)
    return rgb(a)


def flags(rng, base=(178, 168, 150)):
    img = tint(base, noise(rng, scale=12), 0.25)
    a = np.asarray(img).copy()
    d = Image.new("L", (SIZE, SIZE), 0)
    dr = ImageDraw.Draw(d)
    step = SIZE // 4
    for i in range(5):
        dr.line([(0, i * step), (SIZE, i * step)], fill=255, width=3)
    for r in range(4):
        off = step // 2 * (r % 2)
        for i in range(5):
            dr.line([(i * step + off, r * step), (i * step + off, (r + 1) * step)], fill=255, width=3)
    for _ in range(14):  # cracks
        x, y = rng.integers(0, SIZE, 2)
        pts = [(int(x), int(y))]
        for _ in range(6):
            x, y = x + rng.integers(-30, 30), y + rng.integers(-30, 30)
            pts.append((int(x), int(y)))
        dr.line(pts, fill=180, width=1)
    m = np.asarray(d, float)[..., None] / 255
    a = a * (1 - 0.5 * m)
    return rgb(a)


def wood(rng, base=(92, 58, 34)):
    y = np.linspace(0, 40, SIZE)[:, None]
    grain = np.sin(y + 6 * noise(rng, scale=3)) * 0.5 + 0.5
    n = noise(rng, scale=20, octaves=2)
    a = np.asarray(base, float) * (0.75 + 0.25 * grain[..., None] + 0.15 * (n[..., None] - 0.5))
    return rgb(a)


def shutter(rng):
    a = np.asarray(wood(rng), float)
    paint = tint((70, 110, 84), noise(rng, scale=8), 0.2)
    keep = noise(rng, scale=6) < 0.72  # paint flaked off in places
    a = np.where(keep[..., None], paint, a)
    for i in range(0, SIZE, SIZE // 12):  # louvres
        a[i:i + 4] *= 0.55
    return rgb(a)


def iron(rng):
    a = tint((92, 60, 44), noise(rng, scale=14), 0.6)
    dark = noise(rng, scale=5) > 0.5
    a = np.where(dark[..., None], a * 0.6, a)
    return rgb(a)


def gravel(rng):
    a = tint((186, 172, 148), noise(rng, scale=64, octaves=2), 0.5)
    return rgb(a)


def lawn(rng):
    n = noise(rng, scale=10)
    a = tint((168, 146, 92), n, 0.4)  # burnt brown
    green = noise(rng, scale=7) > 0.6
    a = np.where(green[..., None], a * 0.7 + np.array([20, 40, 5]), a)
    return rgb(a)


def soot(rng):
    a = np.asarray(whitewash(rng, base=(150, 140, 125)), float)
    k = np.linspace(0.15, 1, SIZE)[:, None, None]  # blackest at the top, where the smoke gathers
    return rgb(a * (1 - 0.8 * (1 - k)) * 0.5)


def books(rng) -> Image.Image:
    """Shelves full to the ceiling (comic b1-p004-8, b1-p007-2): rows of worn spines."""
    a = np.zeros((SIZE, SIZE, 3))
    shelf = SIZE // 6
    palette = np.array([[120, 40, 32], [62, 70, 40], [40, 52, 78], [140, 110, 60], [90, 60, 40], [150, 140, 110], [70, 30, 30]])
    for r in range(6):
        y0 = r * shelf
        a[y0:y0 + 8] = (70, 44, 26)  # the shelf board
        x = 0
        while x < SIZE:
            w = int(rng.integers(6, 18))
            h = int(rng.integers(shelf * 0.6, shelf - 10))
            c = palette[rng.integers(0, len(palette))] * (0.7 + 0.5 * rng.random())
            a[y0 + shelf - h:y0 + shelf, x:x + w - 1] = c
            x += w
    return rgb(a)


def fretwork() -> Image.Image:
    """The verandah's fretted frieze: white-painted wood, cut in arches and roundels."""
    w, h = 512, 256
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    paint = (226, 220, 204, 255)
    d.rectangle([0, 0, w, 26], fill=paint)
    d.arc([10, -60, w - 10, h - 30], 0, 180, fill=paint, width=22)
    for i in range(9):
        x = 30 + i * 56
        d.ellipse([x - 16, 40, x + 16, 72], outline=paint, width=6)
        d.line([x, 26, x, 40], fill=paint, width=5)
    for i in range(16):
        x = i * 32 + 16
        d.polygon([(x - 8, 26), (x + 8, 26), (x, 40)], fill=paint)
    d.rectangle([0, 0, 18, h], fill=paint)
    d.rectangle([w - 18, 0, w, h], fill=paint)
    return img


def all_textures(seed: int = 41) -> dict[str, Image.Image]:
    rng = np.random.default_rng(seed)
    return {
        "whitewash": whitewash(rng),
        "whitewash-grey": whitewash(rng, base=(178, 172, 158)),
        "tiles": tiles(rng),
        "flags": flags(rng, base=(196, 172, 128)),  # warm sandstone, as the comic paints the floors
        "flags-court": flags(rng, base=(214, 178, 118)),  # the "wonderfully sunlit courtyard" (comic b1-p004-7)
        "wood": wood(rng),
        "shutter": shutter(rng),
        "iron": iron(rng),
        "gravel": gravel(rng),
        "lawn": lawn(rng),
        "soot": soot(rng),
        "fretwork": fretwork(),
        "books": books(rng),
    }
