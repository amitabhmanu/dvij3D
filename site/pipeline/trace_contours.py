"""Step 7.5: trace the valley's contour rings off the book's map (design §10.1).

The map (images/artifacts/map.jpg) is a hand-drawn contour map: rings around
each hill, a grid over it, labels, huts and roads. The rings are drawn
freehand, so they have gaps, and some run into the next ring like a spiral.
Finding closed curves directly fails on exactly those, so each ring is traced
as the cheapest closed path around the hill's summit instead:

  1. The ink is the dark line work (the grid is drawn lighter and drops out),
     minus anything too short to be a contour line (letters, hut outlines).
  2. Around each summit in hills.yaml the distance-to-ink is unrolled into
     polar coordinates, one column per degree.
  3. Ring k is the minimum-cost closed path through that image that stays
     strictly outside ring k-1 and no further out than about two ring
     spacings, so it can bridge a gap but cannot skip a ring. Where the drawing
     has a gap the path runs straight across it; everywhere else it sits on
     the ink.
  4. Rings are star-shaped about the summit and nested by construction, then
     simplified and normalised to 0-1 map coordinates like the places.yaml
     rects.

A ring is only kept if at least 60% of it lies on ink; the tracer stops at the
first ring that doesn't.

Inputs:  images/artifacts/map.jpg, src/content/valley/hills.yaml
Output:  src/content/generated/contours.json  (committed)
         pipeline/reports/contours-overlay.png (for review; not committed)
Usage:   python trace_contours.py
"""
import json

import cv2
import numpy as np
from scipy.ndimage import uniform_filter1d

from common import REPORTS
from valley_contours import CONTOURS_JSON, MAP_JPG, load_hills, problems

SCALE = 3  # trace at 3x, so a ring can sit between the map's own pixels
INK = 155  # contour lines are darker than this; the grid lines are lighter
MIN_LINE = 60  # px at 3x: shorter ink is lettering or huts, not contour
STEPS = 360  # rays around each summit
MIN_GAP = 8  # px at 3x between a ring and the next one out
CAP = 6.0  # distance-to-ink cost is capped, so a gap costs no more than this
ON_INK = 1.5  # px at 3x: this close counts as on the line
KEEP = 0.6  # fraction of a ring that must lie on ink


def load_ink() -> np.ndarray:
    gray = cv2.imread(str(MAP_JPG), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise SystemExit(f"Cannot read {MAP_JPG}")
    big = cv2.resize(gray, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
    ink = (big < INK).astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    short = np.where(np.maximum(stats[:, 2], stats[:, 3]) < MIN_LINE)[0]
    ink[np.isin(labels, short)] = 0
    return ink


def unroll(dist: np.ndarray, cx: float, cy: float, radius: int):
    """Distance-to-ink around (cx, cy), one row per ray; and where each ray leaves the map."""
    h, w = dist.shape
    theta = np.radians(np.arange(STEPS) * 360 / STEPS)
    r = np.arange(radius, dtype=np.float32)
    xs = (cx + np.outer(np.cos(theta), r)).astype(np.float32)
    ys = (cy - np.outer(np.sin(theta), r)).astype(np.float32)
    inside = (xs >= 0) & (xs < w - 1) & (ys >= 0) & (ys < h - 1)
    cost = np.minimum(cv2.remap(dist, xs, ys, cv2.INTER_LINEAR), CAP)
    cost = np.where(inside, cost, 50.0)
    edge = np.array([np.argmin(row) if not row.all() else radius for row in inside])
    return cost, edge, theta


def cheapest_ring(cost: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    """Minimum-cost closed path, one radius per ray, with lo <= r <= hi."""
    rays, radius = cost.shape
    big = 1e9
    radii = np.arange(radius)

    def walk(r0: int):
        acc = np.full(radius, big)
        acc[r0] = cost[0, r0]
        back = np.zeros((rays + 1, radius), np.int32)
        for t in range(1, rays + 1):
            tt = t % rays
            best, arg = acc.copy(), radii.copy()
            for d in (1, 2, 3):  # a ray may step at most 3 px in or out
                for shifted, src in ((np.r_[acc[d:], [big] * d], radii + d), (np.r_[[big] * d, acc[:-d]], radii - d)):
                    shifted = shifted + 0.15 * d
                    better = shifted < best
                    best, arg = np.where(better, shifted, best), np.where(better, src, arg)
            allowed = (radii >= lo[tt]) & (radii <= hi[tt])
            acc = np.where(allowed, best + cost[tt], big)
            back[t] = arg
        return acc[r0], back

    lo0, hi0 = int(lo[0]), int(min(hi[0], radius - 1))
    starts = [r for r in range(lo0, hi0 + 1) if cost[0, r] < ON_INK][::2][:12] or [(lo0 + hi0) // 2]
    best = min((walk(r0) + (r0,) for r0 in starts), key=lambda x: x[0])
    _, back, r0 = best
    path = np.zeros(rays, int)
    r = int(back[rays][r0])
    for t in range(rays - 1, 0, -1):
        path[t] = r
        r = int(back[t][r])
    path[0] = r0
    return path.astype(float)


def ring_from_inked_ray(cost: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    """cheapest_ring, started on the ray where the ring is drawn most clearly:
    the path is closed by returning to its starting radius, so starting in a gap
    would pin the whole ring to a guess."""
    rays = len(lo)
    clear = [cost[t, lo[t]:max(hi[t], lo[t]) + 1].min() for t in range(rays)]
    t0 = int(np.argmin(clear))
    path = cheapest_ring(np.roll(cost, -t0, 0), np.roll(lo, -t0), np.roll(hi, -t0))
    return np.roll(path, t0)


def trace_hill(hill: dict, dist: np.ndarray) -> list[np.ndarray]:
    h, w = dist.shape
    cx, cy = hill["summit"][0] * w, hill["summit"][1] * h
    radius = int(0.4 * w)
    cost, edge, theta = unroll(dist, cx, cy, radius)
    prev = np.full(STEPS, 2.0)
    rings = []
    for k in range(hill["rings"]):
        gaps = []
        for t in range(0, STEPS, 6):
            hits = np.where(cost[t, int(prev[t]) + MIN_GAP:] < 1.0)[0]
            if len(hits):
                gaps.append(hits[0] + MIN_GAP)
        spacing = float(np.median(gaps)) if gaps else 40.0
        lo = (prev + MIN_GAP).astype(int)
        hi = np.minimum(prev + max(40.0, 1.7 * spacing), edge - 4).astype(int)
        if (hi < lo).any():
            print(f"  {hill['id']}: ring {k + 1} would leave the map; stopping at {k}")
            break
        path = ring_from_inked_ray(cost, lo, hi)
        on = float((cost[np.arange(STEPS), path.astype(int)] < ON_INK).mean())
        if on < KEEP:
            print(f"  {hill['id']}: ring {k + 1} is only {on:.0%} on ink; stopping at {k}")
            break
        path = uniform_filter1d(path, 3, mode="wrap")
        rings.append(np.stack([cx + path * np.cos(theta), cy - path * np.sin(theta)], 1))
        prev = path
    return rings


def to_points(ring: np.ndarray, w: int, h: int) -> list[list[float]]:
    simple = cv2.approxPolyDP(ring.astype(np.float32).reshape(-1, 1, 2), 1.0, True).reshape(-1, 2)
    return [[round(float(x) / w, 5), round(float(y) / h, 5)] for x, y in simple]


def overlay(hills: list[dict], ink_shape) -> None:
    gray = cv2.imread(str(MAP_JPG), cv2.IMREAD_GRAYSCALE)
    big = cv2.resize(gray, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
    img = cv2.cvtColor(big, cv2.COLOR_GRAY2BGR) // 2 + 127
    h, w = ink_shape
    colours = [(40, 40, 220), (30, 150, 30), (210, 70, 20), (0, 130, 240), (180, 0, 180), (0, 160, 160), (110, 60, 0)]
    for i, hill in enumerate(hills):
        c = colours[i % len(colours)]
        for ring in hill["rings"]:
            pts = (np.array(ring["points"]) * [w, h]).astype(np.int32)
            cv2.polylines(img, [pts], True, c, 3)
            x, y = pts[pts[:, 1].argmin()]
            cv2.putText(img, str(ring["level"]), (int(x) - 8, int(y) + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.8, c, 2)
    REPORTS.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(REPORTS / "contours-overlay.png"), img)


def main() -> None:
    ink = load_ink()
    dist = cv2.distanceTransform(1 - ink, cv2.DIST_L2, 3).astype(np.float32)
    h, w = ink.shape
    out = []
    for hill in load_hills():
        rings = trace_hill(hill, dist)
        n = len(rings)
        # traced inside-out; level 1 is the outermost ring
        out.append({
            "id": hill["id"],
            "name": hill["name"],
            "kind": hill.get("kind", "hill"),
            "summit": hill["summit"],
            "rings": [{"level": n - i, "points": to_points(r, w, h)} for i, r in enumerate(rings)][::-1],
        })
        if n < hill["rings"]:
            print(f"  {hill['id']}: traced {n} of the {hill['rings']} rings hills.yaml asks for")
    data = {"version": 1, "space": "map.jpg", "source": "images/artifacts/map.jpg", "hills": out}
    bad = problems(data)
    if bad:
        raise SystemExit("Traced contours are malformed:\n  " + "\n  ".join(bad))
    CONTOURS_JSON.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    overlay(out, ink.shape)
    rings = sum(len(hl["rings"]) for hl in out)
    print(f"Traced {rings} rings on {len(out)} hills -> {CONTOURS_JSON.name}; review {REPORTS / 'contours-overlay.png'}")


if __name__ == "__main__":
    main()
