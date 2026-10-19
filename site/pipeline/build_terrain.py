"""Step 16.5: build the valley's heightmap from its traced contours (design §10.1).

Every ring in generated/contours.json becomes a height: within a hill, ring k
stands one interval above ring k-1, and between two rings the land rises
evenly with distance from one to the other, so each ring is exactly where that
height is crossed (the "base" terrain). A hill's top is a low dome above its
innermost ring; below its first ring it eases down to the valley floor. Hills
standing on another hill's slope start from the height of the ring they stand
in; a basin steps down instead, to a flat lake.

Detail is then laid on top, and only on top: Dronagiri's south-east face gets
cliff bands and ridged roughness (B4 ch52), seeded fractal noise roughens the
slopes, and none of it may move the land by more than `noise.cap` of one ring
interval, so the rings stay where the book drew them. Past the map's edge the
land climbs into a rim, so the world has no cliff where the drawing stops.

Every number comes from src/content/valley/terrain.yaml, and the same inputs
always give the same files.

Inputs:  src/content/generated/contours.json, src/content/generated/drape.json,
         src/content/valley/terrain.yaml, src/content/places.yaml,
         site-assets/terrain/valley-drape.<hash>.webp
Output:  site-assets/terrain/valley-height.<hash>.png  (8-bit grayscale heights)
         site-assets/terrain/valley-poster.<hash>.webp (hillshaded drape, shown before 3D loads)
         src/content/generated/terrain.json            (committed)
         pipeline/reports/terrain-preview.png          (for review)
Usage:   python build_terrain.py
"""
import hashlib
import io
import json
from dataclasses import dataclass

import cv2
import numpy as np
import yaml
from PIL import Image

from common import ASSETS, REPORTS
from valley_contours import CONTENT, load_contours

TERRAIN_YAML = CONTENT / "valley" / "terrain.yaml"
TERRAIN_JSON = CONTENT / "generated" / "terrain.json"
DRAPE_JSON = CONTENT / "generated" / "drape.json"
PLACES_YAML = CONTENT / "places.yaml"
OUT = ASSETS / "terrain"
MAP_ASPECT = 465 / 686  # map.jpg's height over its width
POSTER_WIDTH = 1200


def knobs() -> dict:
    return yaml.safe_load(TERRAIN_YAML.read_text(encoding="utf-8"))


@dataclass
class Grid:
    """The raster: the map (u, v in 0-1) plus a rim of `margin` map-widths on every side."""
    width: int
    margin: float

    @property
    def ppu(self) -> float:  # pixels per map width
        return self.width / (1 + 2 * self.margin)

    @property
    def height(self) -> int:
        return round((MAP_ASPECT + 2 * self.margin) * self.ppu)

    def to_px(self, pts) -> np.ndarray:
        pts = np.asarray(pts, float)
        return np.c_[(pts[:, 0] + self.margin) * self.ppu, (pts[:, 1] * MAP_ASPECT + self.margin) * self.ppu]

    def to_uv(self, px) -> np.ndarray:
        px = np.asarray(px, float)
        return np.c_[px[:, 0] / self.ppu - self.margin, (px[:, 1] / self.ppu - self.margin) / MAP_ASPECT]

    def mask(self, pts) -> np.ndarray:
        m = np.zeros((self.height, self.width), np.uint8)
        cv2.fillPoly(m, [np.round(self.to_px(pts) * 16).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
        return m

    def uv_planes(self):
        x = (np.arange(self.width) + 0.5) / self.ppu - self.margin
        y = ((np.arange(self.height) + 0.5) / self.ppu - self.margin) / MAP_ASPECT
        return np.meshgrid(x, y)


def inside(mask: np.ndarray) -> np.ndarray:
    """Distance (px) from each pixel inside the mask to its edge; 0 outside."""
    return cv2.distanceTransform(mask, cv2.DIST_L2, 5)


def outside(mask: np.ndarray) -> np.ndarray:
    return cv2.distanceTransform(1 - mask, cv2.DIST_L2, 5)


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def cliff_profile(t, c):
    """Monotone 0->1 across a band, steepest in the middle: c=1 is an even slope."""
    if c <= 1:
        return t
    k = 2 * (c - 1) + 1e-6
    return 0.5 + 0.5 * np.tanh(k * (t - 0.5)) / np.tanh(k / 2)


def interval_for(hill: dict, cfg: dict) -> float:
    own = cfg["hills"].get(hill["id"]) or {}
    if hill["kind"] == "basin":
        return -float(own.get("depthPerLevel", 6))
    n = len(hill["rings"])
    if "peak" in own:
        return float(own["peak"]) / (n + cfg["domeFraction"])
    return float(cfg["metresPerLevel"])


def hill_field(hill: dict, grid: Grid, base: float, interval: float, cfg: dict, profile=None):
    """Base heights for one hill (NaN where it doesn't reach), and its interval map."""
    rings = sorted(hill["rings"], key=lambda r: r["level"])
    masks = [grid.mask(r["points"]) for r in rings]
    n = len(masks)
    count = np.sum(masks, axis=0)
    h = np.full(count.shape, np.nan)
    foot_px = cfg["floor"]["foot"] / cfg["worldWidth"] * grid.ppu
    d1 = outside(masks[0])
    near = (count == 0) & (d1 < foot_px)
    h[near] = base + interval * (1 - smoothstep(d1[near] / foot_px))
    for k in range(1, n):
        band = count == k
        d_out = inside(masks[k - 1])[band]
        d_in = outside(masks[k])[band]
        t = d_out / np.maximum(d_out + d_in, 1e-6)
        if profile is not None:
            t = profile(t, band)
        h[band] = base + k * interval + t * interval
    top = count == n
    di = inside(masks[-1])
    s = di[top] / max(float(di.max()), 1e-6)
    if hill["kind"] == "basin":
        own = cfg["hills"].get(hill["id"]) or {}
        h[top] = base + n * interval - own.get("lakeDepth", 8) * smoothstep(s * 4)
    else:
        h[top] = base + n * interval + cfg["domeFraction"] * interval * (1 - (1 - s) ** 2)
    return h, masks


def value_noise(shape, seed: int, octaves: int = 5, base_cells: int = 6) -> np.ndarray:
    """Seeded fractal value noise in about [-1, 1]."""
    rng = np.random.default_rng(seed)
    out = np.zeros(shape)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cells = base_cells * 2 ** o
        lattice = rng.uniform(-1, 1, (cells + 1, cells + 1)).astype(np.float32)
        out += amp * cv2.resize(lattice, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC)
        total += amp
        amp *= 0.5
    return out / total


def sector_weight(grid: Grid, summit, towards_deg: float) -> np.ndarray:
    """1 on the bearing `towards_deg` (clockwise from north) from the summit, 0 a right angle away."""
    u, v = grid.uv_planes()
    dx = u - summit[0]
    dy = (v - summit[1]) * MAP_ASPECT
    bearing = np.degrees(np.arctan2(dx, -dy))
    diff = np.radians(bearing - towards_deg)
    return np.clip(np.cos(diff), 0, 1) ** 1.5


def build(cfg: dict, contours: dict):
    grid = Grid(cfg["raster"]["width"], cfg["floor"]["margin"])
    shape = (grid.height, grid.width)
    hills = contours["hills"]
    # The bowl: the floor eases up toward the map's edges (the valley is a bowl
    # with one steep road out, B1), then climbs on into the rim beyond them.
    u, v = grid.uv_planes()
    edges = np.stack([u, 1 - u, v * MAP_ASPECT, (1 - v) * MAP_ASPECT])
    k = 0.03  # a soft minimum, so the bowl has no creases running into its corners
    to_edge = -k * np.log(np.exp(-np.clip(edges, -0.5, None) / k).sum(0))
    bowl = cfg["floor"]["bowl"] * smoothstep(1 - np.clip(to_edge, 0, None) / cfg["floor"]["bowlWidth"])
    base = bowl.copy()
    interval_map = np.full(shape, float(cfg["metresPerLevel"]))
    fields, intervals, bases = {}, {}, {}

    # Hills first, in an order where a hill's host is built before it: a hill
    # standing inside another hill's ring starts from that ring's height.
    order = sorted((h for h in hills if h["kind"] == "hill"), key=lambda h: -len(h["rings"]))
    built = []
    for hill in order:
        x, y = grid.to_px([hill["summit"]])[0].astype(int)
        start = float(bowl[y, x])  # a hill stands on the floor beneath it
        for other in built:
            if np.isnan(fields[other["id"]][y, x]):
                continue
            # the highest ring of `other` that contains this summit
            levels = [r["level"] for r, m in zip(sorted(other["rings"], key=lambda r: r["level"]),
                                                 grid_masks(other, grid)) if m[y, x]]
            if levels and len(levels) < len(other["rings"]):
                start = max(start, bases[other["id"]] + max(levels) * intervals[other["id"]])
        iv = interval_for(hill, cfg)
        own = cfg["hills"].get(hill["id"]) or {}
        profile = None
        if "rough" in own:
            w = sector_weight(grid, hill["summit"], own["rough"]["towards"])
            c = own["rough"]["cliff"]
            profile = lambda t, band, w=w, c=c: (1 - w[band]) * t + w[band] * cliff_profile(t, c)
        h, _ = hill_field(hill, grid, start, iv, cfg, profile)
        fields[hill["id"]], intervals[hill["id"]], bases[hill["id"]] = h, iv, start
        built.append(hill)
        higher = ~np.isnan(h) & (h > base)
        base[higher] = h[higher]
        interval_map[higher] = abs(iv)

    for hill in (h for h in hills if h["kind"] == "basin"):
        iv = interval_for(hill, cfg)
        h, masks = hill_field(hill, grid, 0.0, iv, cfg)
        fields[hill["id"]], intervals[hill["id"]], bases[hill["id"]] = h, iv, 0.0
        lower = ~np.isnan(h) & (h < base)
        base[lower] = h[lower]
        interval_map[lower] = abs(iv)

    # The rim beyond the map's edges.
    out_u = np.maximum(np.maximum(-u, u - 1), 0)
    out_v = np.maximum(np.maximum(-v, v - 1), 0) * MAP_ASPECT
    beyond = np.hypot(out_u, out_v) / cfg["floor"]["margin"]
    rim = cfg["floor"]["bowl"] + (cfg["floor"]["rim"] - cfg["floor"]["bowl"]) * smoothstep(beyond) ** 1.2
    base = np.where(beyond > 0, np.maximum(base, rim), base)

    # Detail, bounded by the cap.
    nz = cfg["noise"]
    gy, gx = np.gradient(base)
    slope = np.hypot(gx, gy)
    slope_n = slope / max(np.percentile(slope, 99), 1e-6)
    detail = nz["amplitude"] * interval_map * value_noise(shape, nz["seed"]) * np.clip(slope_n, 0, 1)
    for hill in hills:
        own = cfg["hills"].get(hill["id"]) or {}
        if "rough" not in own:
            continue
        w = sector_weight(grid, hill["summit"], own["rough"]["towards"])
        nw = sector_weight(grid, hill["summit"], (own["rough"]["towards"] + 180) % 360)
        region = ~np.isnan(fields[hill["id"]])
        ridged = (1 - np.abs(value_noise(shape, nz["seed"] + 1, octaves=6, base_cells=10))) ** 2 * 2 - 1
        detail = np.where(region, detail * (1 - nw) + w * own["rough"]["noise"] * intervals[hill["id"]] * ridged, detail)
    # The blur irons out the creases where the distance fields meet, except on a
    # rough face, which keeps its edges.
    crisp = base + detail
    final = cv2.GaussianBlur(crisp.astype(np.float32), (0, 0), 2.5).astype(float)
    for hill in hills:
        own = cfg["hills"].get(hill["id"]) or {}
        if "rough" in own:
            w = sector_weight(grid, hill["summit"], own["rough"]["towards"]) * ~np.isnan(fields[hill["id"]])
            final += w * (crisp - final)
    cap = nz["cap"] * interval_map
    final = base + np.clip(final - base, -cap, cap)

    # Lakes are flat: water sits on the basin's shore ring.
    water = []
    for hill in (h for h in hills if h["kind"] == "basin"):
        shore = max(hill["rings"], key=lambda r: r["level"])
        m = grid.mask(shore["points"]).astype(bool)
        final[m] = np.minimum(final[m], base[m])  # no noise under the water
        # The water stands just below the lowest point of the land around it.
        rim_px = cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~m
        level = float(final[rim_px].min()) - 0.5
        water.append({"id": hill["id"], "level": round(level, 2), "points": shore["points"]})
    return grid, base, final, fields, intervals, bases, water, interval_map


_mask_cache: dict = {}


def grid_masks(hill: dict, grid: Grid) -> list[np.ndarray]:
    key = (hill["id"], grid.width, grid.margin)
    if key not in _mask_cache:
        _mask_cache[key] = [grid.mask(r["points"]) for r in sorted(hill["rings"], key=lambda r: r["level"])]
    return _mask_cache[key]


def boulders(cfg: dict, grid: Grid, final: np.ndarray, water: list[dict], fort_uv) -> list[list[float]]:
    """Seeded Poisson-disc scatter over the map, thicker near the fort, never in water."""
    b = cfg["boulders"]
    rng = np.random.default_rng(b["seed"])
    ww = cfg["worldWidth"]
    wd = ww * MAP_ASPECT
    wet = np.zeros(final.shape, bool)
    for lake in water:
        wet |= grid.mask(lake["points"]).astype(bool)
    fx, fz = (fort_uv[0] - 0.5) * ww, (fort_uv[1] - 0.5) * wd
    cell = b["spacing"] * b["nearFort"] / np.sqrt(2)
    buckets: dict = {}
    placed = []
    for _ in range(int(ww * wd / (b["spacing"] * b["nearFort"]) ** 2)):
        x, z = rng.uniform(-ww / 2, ww / 2), rng.uniform(-wd / 2, wd / 2)
        near = np.hypot(x - fx, z - fz) < b["fortRadius"]
        r = b["spacing"] * (b["nearFort"] if near else 1.0)
        ci, cj = int((x + ww / 2) // cell), int((z + wd / 2) // cell)
        reach = int(np.ceil(r / cell))
        clash = any(np.hypot(x - px, z - pz) < r
                    for i in range(ci - reach, ci + reach + 1) for j in range(cj - reach, cj + reach + 1)
                    for px, pz in buckets.get((i, j), ()))
        if clash:
            continue
        u, v = x / ww + 0.5, z / wd + 0.5
        px, py = grid.to_px([[u, v]])[0].astype(int)
        if wet[py, px]:
            continue
        buckets.setdefault((ci, cj), []).append((x, z))
        size = rng.uniform(*b["size"])
        placed.append([round(x, 1), round(float(final[py, px]), 1), round(z, 1), round(size, 1), round(rng.uniform(0, 6.283), 2)])
    return placed


def encode_height(final: np.ndarray):
    lo, hi = float(final.min()), float(final.max())
    q = np.round((final - lo) / (hi - lo) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(q, "L").save(buf, "PNG", optimize=True)
    return buf.getvalue(), lo, hi, q


def hillshade(h: np.ndarray, metres_per_px: float, azimuth=100.0, altitude=35.0) -> np.ndarray:
    gy, gx = np.gradient(h, metres_per_px)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(azimuth), np.radians(altitude)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


def write_hashed(stem: str, ext: str, data: bytes) -> str:
    name = f"{stem}.{hashlib.sha256(data).hexdigest()[:10]}.{ext}"
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob(f"{stem}.*.{ext}"):
        if old.name != name:
            old.unlink()
    (OUT / name).write_bytes(data)
    return name


def main() -> None:
    cfg = knobs()
    contours = load_contours()
    drape = json.loads(DRAPE_JSON.read_text(encoding="utf-8"))
    places = yaml.safe_load(PLACES_YAML.read_text(encoding="utf-8"))["places"]
    grid, base, final, fields, intervals, bases, water, _ = build(cfg, contours)

    png, lo, hi, q = encode_height(final)
    height_name = write_hashed("valley-height", "png", png)

    # Poster: the drape over the map, hillshaded, rim in plain paper.
    metres_per_px = cfg["worldWidth"] / grid.ppu
    shade = hillshade(final, metres_per_px)
    drape_img = cv2.imread(str(OUT / drape["file"]))
    if drape_img is None:
        raise SystemExit(f"Missing {drape['file']}: run extract_valley_drape.py first")
    canvas = np.empty((grid.height, grid.width, 3), np.uint8)
    canvas[:] = np.median(drape_img.reshape(-1, 3), axis=0)
    x0, y0 = grid.to_px([[0, 0]])[0].round().astype(int)
    x1, y1 = grid.to_px([[1, 1]])[0].round().astype(int)
    canvas[y0:y1, x0:x1] = cv2.resize(drape_img, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    lit = (canvas * (0.45 + 0.75 * shade[:, :, None])).clip(0, 255).astype(np.uint8)
    lit = lit[y0:y1, x0:x1]  # the poster shows the map itself, not the rim
    poster = cv2.resize(lit, (POSTER_WIDTH, round(POSTER_WIDTH * MAP_ASPECT)), interpolation=cv2.INTER_AREA)
    buf = io.BytesIO()
    Image.fromarray(poster[:, :, ::-1]).save(buf, "WEBP", quality=64, method=6)
    poster_name = write_hashed("valley-poster", "webp", buf.getvalue())

    ww = cfg["worldWidth"]
    wd = ww * MAP_ASPECT

    def world(u, v):
        px, py = grid.to_px([[u, v]])[0].astype(int)
        return [round((u - 0.5) * ww, 1), round(float(final[py, px]), 1), round((v - 0.5) * wd, 1)]

    anchors = {}
    for pl in places:
        if pl.get("rects"):
            x0r, y0r, x1r, y1r = pl["rects"][0]
            anchors[pl["id"]] = world((x0r + x1r) / 2, (y0r + y1r) / 2)
    fort = next(p for p in places if p["id"] == "fort-ruins")["rects"][0]
    stones = boulders(cfg, grid, final, water, ((fort[0] + fort[2]) / 2, (fort[1] + fort[3]) / 2))

    data = {
        "version": 1,
        "height": {"file": height_name, "w": grid.width, "h": grid.height, "min": round(lo, 2), "max": round(hi, 2)},
        "drape": drape["file"],
        "poster": poster_name,
        "margin": grid.margin,
        "worldWidth": ww,
        "worldDepth": round(wd, 1),
        "verticalExaggeration": cfg["verticalExaggeration"],
        "levels": {h["id"]: [round(bases[h["id"]] + k * intervals[h["id"]], 1) for k in range(1, len(h["rings"]) + 1)]
                   for h in contours["hills"]},
        "summits": {h["id"]: world(*h["summit"]) for h in contours["hills"]},
        "water": [{"id": w["id"], "level": w["level"], "points": [[round((x - 0.5) * ww, 1), round((y - 0.5) * wd, 1)] for x, y in w["points"]]} for w in water],
        "boulders": stones,
        "anchors": anchors,
    }
    TERRAIN_JSON.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")

    # Review: hillshade, the traced rings (blue) and the base terrain's own
    # iso-lines at each ring's height (red), which should sit on top of them.
    prev = (np.dstack([shade] * 3) * 200 + 40).astype(np.uint8)
    for hill in contours["hills"]:
        f = np.nan_to_num(fields[hill["id"]], nan=-1e9 if intervals[hill["id"]] > 0 else 1e9)
        for r in hill["rings"]:
            lv = bases[hill["id"]] + r["level"] * intervals[hill["id"]]
            iso = ((f >= lv) if intervals[hill["id"]] > 0 else (f <= lv)).astype(np.uint8)
            cs, _ = cv2.findContours(iso, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
            cv2.drawContours(prev, cs, -1, (40, 40, 220), 1)
            cv2.polylines(prev, [grid.to_px(r["points"]).astype(np.int32)], True, (220, 120, 30), 1)
    REPORTS.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(REPORTS / "terrain-preview.png"), prev)

    top = max(data["summits"].items(), key=lambda kv: kv[1][1])
    print(f"Heightmap {height_name} ({len(png) // 1024} KB, {grid.width}x{grid.height}, {lo:.0f} to {hi:.0f} m), "
          f"poster {poster_name} ({len(buf.getvalue()) // 1024} KB), {len(stones)} boulders, "
          f"{len(anchors)} anchors; highest summit {top[0]} at {top[1][1]:.0f} m")


if __name__ == "__main__":
    main()
