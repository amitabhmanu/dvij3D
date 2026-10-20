"""Step 7.7: lift trees and buildings off the painted map, as cut-outs to stand
up in the walkable valley (design §10.2).

The painting (book/B1.pdf p1) draws its huts, temples and trees as little
pictures on parchment. Each is separated from the parchment by colour: the
parchment's own colour is estimated everywhere by a wide median filter, and a
pixel belongs to the drawing where it is clearly darker or differently
coloured. Buildings come from boxes read off the painting by hand
(src/content/valley/cutouts.yaml). Trees are drawn in clumps and don't come
away cleanly, so they are made from the painting's own leaves instead: see
painted_trees().

Every cut-out is enlarged 3x (the painting draws a hut about 20 px tall) and
packed into one atlas with transparency.

Inputs:  book/B1.pdf, src/content/valley/cutouts.yaml
Output:  site-assets/walk/cutouts.<hash>.webp     (the atlas)
         src/content/generated/cutouts.json        (committed: where each cut-out is in it)
         pipeline/reports/cutouts-sheet.png        (for review)
Usage:   python extract_cutouts.py
"""
import hashlib
import io
import json

import cv2
import numpy as np
import yaml
from PIL import Image

import extract_valley_drape as drape
from common import ASSETS, REPORTS
from valley_contours import CONTENT

CUTOUTS_YAML = CONTENT / "valley" / "cutouts.yaml"
CUTOUTS_JSON = CONTENT / "generated" / "cutouts.json"
OUT = ASSETS / "walk"
ENLARGE = 3
ATLAS_WIDTH = 1024
PAD = 4


def drawing_mask(bgr: np.ndarray) -> np.ndarray:
    """Where the painting has a drawing on it, rather than bare parchment."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    paper = cv2.cvtColor(cv2.medianBlur(bgr, 31), cv2.COLOR_BGR2LAB).astype(np.float32)
    diff = np.linalg.norm(lab - paper, axis=2)
    darker = paper[..., 0] - lab[..., 0]
    mask = ((diff > 20) & (darker > 6)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def leaf_share(bgr: np.ndarray, m: np.ndarray) -> float:
    """Share of a drawing's pixels that are leaf-green. The painting's greens are
    olive, close to the parchment in hue, so this reads LAB's green-red axis:
    leaves sit a few steps greener (a* <= 131) than parchment or roofs (134+)."""
    a = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[..., 1][m]
    return float((a <= 131).mean()) if m.any() else 0.0


def solid(mask: np.ndarray) -> np.ndarray:
    """Fill the holes inside each drawn shape, so windows and doors stay opaque."""
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(mask)
    cv2.drawContours(out, cs, -1, 255, -1)
    return out


def cut(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """An RGBA cut-out, enlarged, with a soft one-pixel edge."""
    big = cv2.resize(bgr, None, fx=ENLARGE, fy=ENLARGE, interpolation=cv2.INTER_CUBIC)
    sharp = cv2.addWeighted(big, 1.4, cv2.GaussianBlur(big, (0, 0), 1.2), -0.4, 0)
    a = cv2.resize(mask, None, fx=ENLARGE, fy=ENLARGE, interpolation=cv2.INTER_LINEAR)
    a = cv2.GaussianBlur(a, (0, 0), 0.8)
    a = np.clip((a.astype(np.float32) - 64) * 1.6, 0, 255).astype(np.uint8)
    return np.dstack([sharp, a])


def grab(img: np.ndarray, box: list[int], hint: np.ndarray | None = None) -> np.ndarray:
    """Separate one drawing from its parchment inside a box, with GrabCut: it
    learns the parchment's colours from the box's edge and the drawing's from
    its middle, so pale walls and olive leaves come away whole."""
    x0, y0, x1, y1 = box
    m = 3  # GrabCut needs some parchment around the drawing to learn from
    X0, Y0 = max(0, x0 - m), max(0, y0 - m)
    X1, Y1 = min(img.shape[1], x1 + m), min(img.shape[0], y1 + m)
    patch = np.ascontiguousarray(img[Y0:Y1, X0:X1])
    mask = np.full(patch.shape[:2], cv2.GC_BGD, np.uint8)
    mask[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = cv2.GC_PR_FGD
    if hint is not None:  # pixels the colour test is sure of
        h = hint[Y0:Y1, X0:X1] > 0
        mask[h & (mask == cv2.GC_PR_FGD)] = cv2.GC_FGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.setRNGSeed(7)  # GrabCut seeds its colour models randomly; fix it so reruns match
    cv2.grabCut(patch, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    fg = np.isin(mask, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n <= 1:
        raise SystemExit(f"cutouts: nothing drawn in box {box}")
    keep = 1 + int(np.argmax(stats[1:, 4]))  # the drawing itself, not stray specks
    fg = solid(((labels == keep) * 255).astype(np.uint8))
    return cut(patch, fg)


def building(img: np.ndarray, mask: np.ndarray, box: list[int]) -> np.ndarray:
    return grab(img, box, mask)


def trees(img: np.ndarray, mask: np.ndarray, cfg: dict) -> list[np.ndarray]:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    lo, hi = cfg["size"]
    found = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (lo <= w <= hi and lo <= h <= hi and 0.6 <= w / h <= 1.6 and area > 0.35 * w * h):
            continue
        comp = labels[y:y + h, x:x + w] == i
        if leaf_share(img[y:y + h, x:x + w], comp) < cfg["green"]:
            continue
        if not tree_shape_ok(leaf_mask(img, [x, y, x + w, y + h])[1]):
            continue
        found.append((area, x, y, w, h, comp))
    if len(found) < cfg["count"]:
        raise SystemExit(f"cutouts: only {len(found)} clear tree drawings, {cfg['count']} wanted")
    found.sort(key=lambda f: f[0])
    pick = [found[round(k * (len(found) - 1) / (cfg["count"] - 1))] for k in range(cfg["count"])]
    return [leafy(img, [x, y, x + w, y + h]) for _, x, y, w, h, _ in pick]


def leaf_mask(img: np.ndarray, box: list[int]):
    """A tree's own outline: its leaves (greener than the parchment) and its dark
    trunk and shading, closed up and filled, so the parchment between the
    leaves goes but the crown stays whole."""
    x0, y0, x1, y1 = box
    m = 2
    X0, Y0 = max(0, x0 - m), max(0, y0 - m)
    X1, Y1 = min(img.shape[1], x1 + m), min(img.shape[0], y1 + m)
    patch = np.ascontiguousarray(img[Y0:Y1, X0:X1])
    lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).astype(np.int16)
    paper = np.percentile(lab[..., 1], 85), np.percentile(lab[..., 0], 90)
    leaf = (lab[..., 1] <= paper[0] - 5) | (lab[..., 0] < paper[1] - 35)
    fg = cv2.morphologyEx(leaf.astype(np.uint8) * 255, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n <= 1:
        return patch, None
    keep = 1 + int(np.argmax(stats[1:, 4]))
    return patch, solid(((labels == keep) * 255).astype(np.uint8))


def tree_shape_ok(mask: np.ndarray) -> bool:
    """A crown, not a block of parchment: rounded, not filling its box, not cut by it."""
    if mask is None:
        return False
    on = mask > 0
    fill = on.mean()
    edge = np.r_[on[0], on[-1], on[:, 0], on[:, -1]].mean()
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.contourArea(cv2.convexHull(max(cs, key=cv2.contourArea)))
    solidity = on.sum() / max(hull, 1)
    return 0.25 < fill < 0.85 and edge < 0.45 and solidity > 0.62


def leafy(img: np.ndarray, box: list[int]) -> np.ndarray:
    patch, mask = leaf_mask(img, box)
    return cut(patch, mask)


def leaf_tones(img: np.ndarray) -> np.ndarray:
    """The painting's leaf colours, dark to light: the pixels a few steps greener
    than the parchment around them (see leaf_share), in four quantiles."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    paper_a = cv2.medianBlur(lab[..., 1].astype(np.uint8), 41).astype(np.float32)
    paper_l = cv2.medianBlur(lab[..., 0].astype(np.uint8), 41).astype(np.float32)
    leaf = (lab[..., 1] <= paper_a - 5) & (lab[..., 0] <= paper_l - 25)
    px, a = img[leaf].astype(np.float32), lab[..., 1][leaf]
    px = px[a <= np.percentile(a, 30)]  # the greenest third: leaves, not their brown shadows
    order = np.argsort(px.sum(1))
    tones = np.array([px[order[int(q * (len(order) - 1))]] for q in (0.15, 0.45, 0.7, 0.92)])
    hsv = cv2.cvtColor(tones[None].astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.minimum(255, hsv[..., 1] * 1.15)  # a touch more colour, as in daylight
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)[0].astype(np.float32)


def painted_trees(img: np.ndarray, cfg: dict) -> list[np.ndarray]:
    """Trees with clean outlines, in the painting's own leaf colours.

    The painted trees stand in clumps on textured parchment and don't come away
    cleanly (they carried blocks of parchment with them). So each tree here is
    a crown of a few overlapping rounds, dabbed in the painting's leaf colours
    (leaf_tones), darker underneath, inked round its edge like the book, on a
    trunk in the painting's trunk brown. The shapes are ours; the colours are
    the painting's."""
    rng = np.random.default_rng(cfg["seed"])
    tones = leaf_tones(img)
    trunk_bgr = np.array(cfg["trunk"][::-1], np.float32)
    out = []
    for _ in range(cfg["count"]):
        w, h = int(rng.integers(90, 130)), int(rng.integers(120, 170))
        crown_h = int(h * rng.uniform(0.68, 0.8))
        mask = np.zeros((h, w), np.uint8)
        for _k in range(int(rng.integers(5, 9))):
            r = int(rng.uniform(0.22, 0.34) * w)
            cx = int(rng.uniform(0.32, 0.68) * w)
            cy = int(rng.uniform(0.3, 0.62) * crown_h)
            cv2.circle(mask, (cx, cy), r, 255, -1)
        mask[crown_h:] = 0
        tw = max(6, w // 10)
        trunk = np.zeros_like(mask)
        cv2.rectangle(trunk, (w // 2 - tw // 2, int(crown_h * 0.7)), (w // 2 + tw // 2, h - 2), 255, -1)
        # leaves: mid tone, then dabs of dark, light and shadow, like brush strokes
        pic = np.zeros((h, w, 3), np.float32)
        pic[:] = tones[1]
        for tone, n, rr in ((tones[0], 26, (4, 9)), (tones[2], 30, (3, 8)), (tones[3], 14, (2, 5))):
            for _d in range(n):
                cy = int(rng.uniform(0, crown_h))
                if tone is tones[3]:
                    cy = int(rng.uniform(0, crown_h * 0.55))  # highlights toward the top
                cv2.circle(pic, (int(rng.uniform(0, w)), cy), int(rng.integers(*rr)), tone.tolist(), -1)
        pic = cv2.GaussianBlur(pic, (0, 0), 0.8)
        pic *= np.linspace(1.08, 0.72, h)[:, None, None]  # light from above, shade beneath
        pic = np.where(trunk[..., None] > 0, trunk_bgr * (0.85 + 0.3 * rng.random((h, w, 1))), pic)
        pic = np.where(mask[..., None] > 0, pic * np.linspace(1.08, 0.72, h)[:, None, None] / np.linspace(1.08, 0.72, h)[:, None, None], pic)
        shape = cv2.bitwise_or(mask, trunk)
        ink = cv2.morphologyEx(shape, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
        pic[ink] = (22, 30, 34)
        a = cv2.GaussianBlur(shape, (0, 0), 0.7)
        out.append(np.dstack([np.clip(pic, 0, 255).astype(np.uint8), a]))
    return out


def pack(sprites: list[np.ndarray]) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """Shelf-pack the sprites, tallest first, into an atlas ATLAS_WIDTH wide."""
    order = sorted(range(len(sprites)), key=lambda i: -sprites[i].shape[0])
    places = [None] * len(sprites)
    x = y = shelf = 0
    for i in order:
        h, w = sprites[i].shape[:2]
        if w + PAD > ATLAS_WIDTH:
            raise SystemExit(f"cutouts: a sprite {w} px wide doesn't fit the atlas")
        if x + w + PAD > ATLAS_WIDTH:
            x, y, shelf = 0, y + shelf + PAD, 0
        places[i] = (x, y)
        x += w + PAD
        shelf = max(shelf, h)
    atlas = np.zeros((y + shelf, ATLAS_WIDTH, 4), np.uint8)
    for (px, py), s in zip(places, sprites):
        atlas[py:py + s.shape[0], px:px + s.shape[1]] = s
    return atlas, places


def main() -> None:
    cfg = yaml.safe_load(CUTOUTS_YAML.read_text(encoding="utf-8"))
    img = drape.extract()[:, :, ::-1].copy()  # BGR
    mask = drawing_mask(img)
    builds = [building(img, mask, b["box"]) for b in cfg["buildings"]]
    leaves = painted_trees(img, cfg["trees"])
    atlas, places = pack(builds + leaves)

    buf = io.BytesIO()
    Image.fromarray(cv2.cvtColor(atlas, cv2.COLOR_BGRA2RGBA)).save(buf, "WEBP", quality=85, alpha_quality=90, method=6)
    data = buf.getvalue()
    name = f"cutouts.{hashlib.sha256(data).hexdigest()[:10]}.webp"
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("cutouts.*.webp"):
        if old.name != name:
            old.unlink()
    (OUT / name).write_bytes(data)

    sprites = []
    for b, s, (x, y) in zip(cfg["buildings"], builds, places[:len(builds)]):
        sprites.append({"id": b["id"], "kind": b["kind"], "x": x, "y": y, "w": s.shape[1], "h": s.shape[0], "height": b["height"]})
    for k, (s, (x, y)) in enumerate(zip(leaves, places[len(builds):])):
        sprites.append({"id": f"tree-{k + 1}", "kind": "tree", "x": x, "y": y, "w": s.shape[1], "h": s.shape[0]})
    CUTOUTS_JSON.write_text(json.dumps({
        "version": 1, "atlas": name, "w": ATLAS_WIDTH, "h": atlas.shape[0],
        "treeHeight": cfg["trees"]["height"], "sprites": sprites,
    }, indent=1) + "\n", encoding="utf-8")

    # review: the atlas on a checkerboard, so the transparency shows
    check = ((np.indices(atlas.shape[:2]).sum(0) // 12) % 2 * 60 + 150).astype(np.uint8)
    a = atlas[..., 3:4].astype(np.float32) / 255
    sheet = (atlas[..., :3] * a + np.dstack([check] * 3) * (1 - a)).astype(np.uint8)
    REPORTS.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(REPORTS / "cutouts-sheet.png"), sheet)
    print(f"{len(builds)} buildings and {len(leaves)} trees -> {name} ({len(data) // 1024} KB, "
          f"{ATLAS_WIDTH}x{atlas.shape[0]}); review {REPORTS / 'cutouts-sheet.png'}")


if __name__ == "__main__":
    main()
