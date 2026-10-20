"""Step 16.6: the data for walking the valley (design §10.2).

The flyover's 8-bit heightmap is fine from the air but at eye level its 3.7 m
steps would show as terraces, so walking gets its own heights: the same terrain
(build_terrain.build, same contours, same knobs) raised at WIDTH samples across,
about 4 m apart, stored to a decimetre.

The file is a gzip of int16 residuals: each height minus the planar prediction
from its left, upper and upper-left neighbours (as PNG's filters do), which is
near zero on smooth land and compresses well. The browser reverses it with
DecompressionStream; see src/lib/walk/heights.ts.

It also places what stands on the land at walking scale (src/content/valley/
walk.yaml): real-size boulders, scattered as the book says, thickest round the
fort, never in the lake.

Inputs:  generated/contours.json, valley/terrain.yaml, valley/walk.yaml, places.yaml
Output:  site-assets/walk/height.<hash>.bin  (gzip, int16 residuals in decimetres)
         site-assets/walk/ground.<hash>.webp (the painting's colours without its labels and icons)
         site-assets/walk/world.<hash>.json  (what stands on the land)
         src/content/generated/walk.json     (committed: file names, sizes, spawn, water)
Usage:   python build_walk.py
"""
import copy
import gzip
import io
import hashlib
import json

import cv2
import numpy as np
import yaml
from PIL import Image

import build_terrain as bt
from common import ASSETS
from valley_contours import CONTENT, load_contours

WALK_YAML = CONTENT / "valley" / "walk.yaml"
WALK_JSON = CONTENT / "generated" / "walk.json"
OUT = ASSETS / "walk"
SCALE = 0.1  # metres per stored unit


def encode(heights: np.ndarray) -> bytes:
    q = np.round(heights / SCALE).astype(np.int32)
    pred = np.zeros_like(q)
    pred[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    pred[0, 1:] = q[0, :-1]
    pred[1:, 0] = q[:-1, 0]
    res = q - pred
    if res.min() < -32768 or res.max() > 32767:
        raise SystemExit("walk heights: a residual does not fit in int16; lower the resolution")
    return gzip.compress(res.astype("<i2").tobytes(), compresslevel=9, mtime=0)


def decode(data: bytes, w: int, h: int) -> np.ndarray:
    """The inverse of encode, as the browser does it (used by the tests)."""
    res = np.frombuffer(gzip.decompress(data), "<i2").astype(np.int64).reshape(h, w)
    q = np.cumsum(np.cumsum(res, axis=0), axis=1)  # a planar predictor inverts to a 2D prefix sum
    return q * SCALE


def ground_colours(drape_file: str, erase: list[dict]) -> bytes:
    """The painting's colours with its lettering and little drawn trees smoothed
    away: from eye level, painted words on a hillside would read as graffiti, and
    the trees arrive as cut-outs instead (design §10.2)."""
    img = cv2.imread(str(bt.OUT / drape_file))
    if img is None:
        raise SystemExit(f"Missing {drape_file}: run extract_valley_drape.py first")
    mask = np.zeros(img.shape[:2], np.uint8)
    for e in erase:
        cx, cy = e["at"][0] * img.shape[1], e["at"][1] * img.shape[0]
        cv2.circle(mask, (round(cx), round(cy)), round(e["r"] * img.shape[1]), 255, -1)
    if erase:
        img = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)
    soft = cv2.medianBlur(img, 15)  # about 80 m: wider than any letter or tree
    soft = cv2.medianBlur(soft, 9)
    soft = cv2.resize(soft, (1024, round(1024 * img.shape[0] / img.shape[1])), interpolation=cv2.INTER_AREA)
    soft = cv2.GaussianBlur(soft, (0, 0), 1.5)
    buf = io.BytesIO()
    Image.fromarray(soft[:, :, ::-1]).save(buf, "WEBP", quality=80, method=6)
    return buf.getvalue()


def write_hashed(stem: str, ext: str, data: bytes) -> str:
    name = f"{stem}.{hashlib.sha256(data).hexdigest()[:10]}.{ext}"
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob(f"{stem}.*.{ext}"):
        if old.name != name:
            old.unlink()
    (OUT / name).write_bytes(data)
    return name


def main() -> None:
    cfg = copy.deepcopy(bt.knobs())
    walk = yaml.safe_load(WALK_YAML.read_text(encoding="utf-8"))
    cfg["raster"]["width"] = walk["heights"]["width"]
    contours = load_contours()
    grid, _, final, _, _, _, water, _ = bt.build(cfg, contours)
    height_name = write_hashed("height", "bin", encode(final))
    drape = json.loads((CONTENT / "generated" / "drape.json").read_text(encoding="utf-8"))
    ground_name = write_hashed("ground", "webp", ground_colours(drape["file"], walk.get("erase", [])))

    places = yaml.safe_load(bt.PLACES_YAML.read_text(encoding="utf-8"))["places"]
    fort = next(p for p in places if p["id"] == "fort-ruins")["rects"][0]
    rocks_cfg = copy.deepcopy(cfg)
    rocks_cfg["boulders"] = walk["boulders"]
    stones = bt.boulders(rocks_cfg, grid, final, water, ((fort[0] + fort[2]) / 2, (fort[1] + fort[3]) / 2))
    world = {"version": 1, "boulders": stones}
    world_name = write_hashed("world", "json", json.dumps(world, separators=(",", ":")).encode())

    ww = cfg["worldWidth"]
    wd = ww * bt.MAP_ASPECT
    sx, sz = walk["spawn"]["at"]
    data = {
        "version": 1,
        "height": {"file": height_name, "w": grid.width, "h": grid.height, "scale": SCALE},
        "world": world_name,
        "ground": ground_name,
        "margin": grid.margin,
        "worldWidth": ww,
        "worldDepth": round(wd, 1),
        "spawn": {"x": round((sx - 0.5) * ww, 1), "z": round((sz - 0.5) * wd, 1),
                  "heading": walk["spawn"]["heading"]},
        "water": [{"id": w["id"], "level": w["level"],
                   "points": [[round((x - 0.5) * ww, 1), round((y - 0.5) * wd, 1)] for x, y in w["points"]]} for w in water],
        "player": walk["player"],
        # exact samples for the browser's decoder to be checked against (tests)
        "check": [{"i": i, "j": j, "h": round(float(final[j, i]), 2)}
                  for i, j in ((0, 0), (grid.width - 1, grid.height - 1), (grid.width // 2, grid.height // 3), (1234, 987))],
    }
    WALK_JSON.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    size = (OUT / height_name).stat().st_size
    print(f"Walk heights {height_name} ({size // 1024} KB, {grid.width}x{grid.height}, "
          f"{ww / grid.ppu:.1f} m apart), {len(stones)} boulders in {world_name}")


if __name__ == "__main__":
    main()
