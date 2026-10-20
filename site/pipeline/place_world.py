"""What stands on the walkable valley (design §10.2), placed for build_walk.py.

- Buildings stand where the painting draws them: each cut-out's box on the
  painting is carried into map.jpg's frame by the inverse of the drape's
  registration (extract_valley_drape.py), then into the world.
- Trees grow where the painting is green: its leaves sit a few steps greener on
  LAB's green-red axis than the parchment around them. A jittered grid is
  thinned by that greenness, kept off water, cliffs and buildings, and each
  tree takes one of the painted tree cut-outs.

Everything is seeded, so the same inputs plant the same valley.
"""
import gzip

import cv2
import numpy as np
import yaml

import build_terrain as bt
import extract_valley_drape as drape

PAINTING = (1425, 1104)


def painted_to_map():
    """The inverse of the drape's registration: painting (0-1) -> map.jpg (0-1)."""
    pts = yaml.safe_load(drape.POINTS.read_text(encoding="utf-8"))["points"]
    swapped = [{"name": p["name"], "map": p["painted"], "painted": p["map"]} for p in pts]
    warp, *_ = drape.fit(swapped, *PAINTING)
    return warp


def buildings(cut: dict, cfg: dict, world_of, ground) -> list[dict]:
    warp = painted_to_map()
    by_id = {s["id"]: s for s in cut["sprites"]}
    out = []
    for b in cfg["buildings"]:
        x0, y0, x1, y1 = b["box"]
        # where it meets the ground: the middle of the drawing's bottom edge
        u, v = warp(np.array([[(x0 + x1) / 2 / PAINTING[0], (y1 - 2) / PAINTING[1]]]))[0]
        x, z = world_of(u, v)
        s = by_id[b["id"]]
        width = b["height"] * s["w"] / s["h"]
        out.append({
            "id": b["id"], "kind": b["kind"], "sprite": b["id"],
            "x": round(x, 1), "y": round(ground(x, z), 2), "z": round(z, 1),
            "height": b["height"], "width": round(width, 1),
            "r": round(max(1.5, 0.42 * width), 1),  # footprint you can't walk through
            "place": b.get("place"),
            "door": None, "interior": None,  # for later: entering buildings (design §10.2)
        })
    return out


def leaf_density(drape_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(drape_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    paper_a = cv2.medianBlur(lab[..., 1].astype(np.uint8), 41).astype(np.float32)
    paper_l = cv2.medianBlur(lab[..., 0].astype(np.uint8), 41).astype(np.float32)
    leafy = ((lab[..., 1] <= paper_a - 3) & (lab[..., 0] <= paper_l - 8)).astype(np.float32)
    return cv2.GaussianBlur(leafy, (0, 0), 1.5)


def trees(cfg: dict, cut: dict, drape_bgr: np.ndarray, world_size, ground, slope, water, houses) -> np.ndarray:
    """Rows of (x, z, sprite, height): seeded, thinned by the painting's green."""
    t = cfg["trees"]
    rng = np.random.default_rng(t["seed"])
    density = leaf_density(drape_bgr)
    dh, dw = density.shape
    ww, wd = world_size
    sprites = [i for i, s in enumerate(cut["sprites"]) if s["kind"] == "tree"]
    lo, hi = cut["treeHeight"]
    sp = t["spacing"]
    xs = np.arange(-ww / 2 + sp / 2, ww / 2, sp)
    zs = np.arange(-wd / 2 + sp / 2, wd / 2, sp)
    gx, gz = np.meshgrid(xs, zs)
    gx = (gx + rng.uniform(-0.45, 0.45, gx.shape) * sp).ravel()
    gz = (gz + rng.uniform(-0.45, 0.45, gz.shape) * sp).ravel()
    u, v = gx / ww + 0.5, gz / wd + 0.5
    d = density[np.clip((v * dh).astype(int), 0, dh - 1), np.clip((u * dw).astype(int), 0, dw - 1)]
    keep = rng.uniform(0, 1, d.shape) < np.clip(d * t["thickness"], 0, 0.95)
    rows = []
    for x, z in zip(gx[keep], gz[keep]):
        if slope(x, z) > t["maxSlope"] or water(x, z) or houses(x, z):
            continue
        rows.append((x, z))
    rows = np.array(rows)
    kinds = rng.choice(sprites, len(rows))
    heights = rng.uniform(lo, hi, len(rows))
    return np.c_[rows, kinds, heights]


def encode_trees(rows: np.ndarray) -> bytes:
    """6 bytes a tree: int16 x and z in quarter metres, uint8 sprite, uint8 height in decimetres."""
    rec = np.zeros(len(rows), dtype=[("x", "<i2"), ("z", "<i2"), ("s", "u1"), ("h", "u1")])
    rec["x"] = np.round(rows[:, 0] * 4)
    rec["z"] = np.round(rows[:, 1] * 4)
    rec["s"] = rows[:, 2]
    rec["h"] = np.clip(np.round(rows[:, 3] * 10), 0, 255)
    return gzip.compress(rec.tobytes(), compresslevel=9, mtime=0)


def decode_trees(data: bytes) -> np.ndarray:
    rec = np.frombuffer(gzip.decompress(data), dtype=[("x", "<i2"), ("z", "<i2"), ("s", "u1"), ("h", "u1")])
    return np.c_[rec["x"] / 4, rec["z"] / 4, rec["s"], rec["h"] / 10]
