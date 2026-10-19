"""The valley's traced contours (design §10.1): where they live and what makes
them well formed. Shared by trace_contours.py, build_terrain.py,
validate_content.py and the tests, so every one of them checks the same rules.

A contours file is
    {version, space: "map.jpg", hills: [{id, name, kind, rings: [{level, points}]}]}
with points normalised 0-1 on images/artifacts/map.jpg, like the places.yaml
rects. Within a hill, level 1 is the outermost ring and each level inside it is
one more; a "basin" steps down to water instead of up to a summit.
"""
import json

import yaml
from shapely.geometry import Point, Polygon

from common import IMAGES_DIR, SITE

CONTENT = SITE / "src" / "content"
HILLS_YAML = CONTENT / "valley" / "hills.yaml"
CONTOURS_JSON = CONTENT / "generated" / "contours.json"
MAP_JPG = IMAGES_DIR / "artifacts" / "map.jpg"
MIN_POINTS = 8
KINDS = {"hill", "basin"}


def load_hills() -> list[dict]:
    return yaml.safe_load(HILLS_YAML.read_text(encoding="utf-8"))["hills"]


def load_contours() -> dict:
    return json.loads(CONTOURS_JSON.read_text(encoding="utf-8"))


def polygon(points: list[list[float]]) -> Polygon:
    return Polygon(points)


def problems(data: dict) -> list[str]:
    """Everything wrong with a contours document, as house-style messages."""
    out = []
    if data.get("space") != "map.jpg":
        out.append(f"contours: space is {data.get('space')!r}, expected 'map.jpg'")
    seen = set()
    for hill in data.get("hills", []):
        hid = hill.get("id")
        where = f"contours/{hid}"
        if hid in seen:
            out.append(f"{where}: hill id is used twice")
        seen.add(hid)
        if hill.get("kind", "hill") not in KINDS:
            out.append(f"{where}: unknown kind {hill.get('kind')!r}")
        rings = hill.get("rings", [])
        if not rings:
            out.append(f"{where}: no rings")
            continue
        levels = sorted(r["level"] for r in rings)
        if levels != list(range(1, len(rings) + 1)):
            out.append(f"{where}: levels {levels} are not contiguous from 1")
        polys = {}
        for ring in rings:
            pts, lv = ring["points"], ring["level"]
            if len(pts) < MIN_POINTS:
                out.append(f"{where} level {lv}: {len(pts)} points, need at least {MIN_POINTS}")
                continue
            if pts[0] == pts[-1]:
                out.append(f"{where} level {lv}: first point repeated at the end (rings are implicitly closed)")
            if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in pts):
                out.append(f"{where} level {lv}: a point lies off the map")
            poly = polygon(pts)
            if not poly.is_valid:
                out.append(f"{where} level {lv}: the ring crosses itself")
                continue
            polys[lv] = poly
        for lv, poly in polys.items():
            outer = polys.get(lv - 1)
            if outer is not None and not outer.contains(poly):
                out.append(f"{where} level {lv}: not inside level {lv - 1}")
    return out


def innermost(hill: dict) -> Polygon:
    ring = max(hill["rings"], key=lambda r: r["level"])
    return polygon(ring["points"])


def contains(hill: dict, level: int, x: float, y: float) -> bool:
    ring = next(r for r in hill["rings"] if r["level"] == level)
    return polygon(ring["points"]).contains(Point(x, y))
