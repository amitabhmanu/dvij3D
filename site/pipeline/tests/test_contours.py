import math

import cv2
import numpy as np
import pytest
from shapely.geometry import Point

import trace_contours as tc
from valley_contours import load_contours, polygon, problems


def circle(cx, cy, r, n=24):
    return [[round(cx + r * math.cos(2 * math.pi * i / n), 5), round(cy + r * math.sin(2 * math.pi * i / n), 5)] for i in range(n)]


def doc(*rings, kind="hill"):
    return {"version": 1, "space": "map.jpg", "hills": [{"id": "h", "name": "H", "kind": kind, "rings": list(rings)}]}


GOOD = doc({"level": 1, "points": circle(0.5, 0.5, 0.2)}, {"level": 2, "points": circle(0.5, 0.5, 0.1)})


def test_well_formed_contours_pass():
    assert problems(GOOD) == []


@pytest.mark.parametrize("bad, message", [
    (doc({"level": 1, "points": [[0.1, 0.1], [0.3, 0.3], [0.3, 0.1], [0.1, 0.3]] * 2}), "crosses itself"),
    (doc({"level": 1, "points": circle(0.5, 0.5, 0.2)}, {"level": 3, "points": circle(0.5, 0.5, 0.1)}), "not contiguous"),
    (doc({"level": 1, "points": circle(0.3, 0.5, 0.1)}, {"level": 2, "points": circle(0.7, 0.5, 0.1)}), "not inside level 1"),
    (doc({"level": 1, "points": circle(0.5, 0.5, 0.2) + [circle(0.5, 0.5, 0.2)[0]]}), "repeated at the end"),
    (doc({"level": 1, "points": circle(0.5, 0.5, 0.2, n=5)}), "need at least 8"),
    (doc({"level": 1, "points": circle(0.5, 0.5, 0.2)}, kind="volcano"), "unknown kind"),
])
def test_malformed_contours_are_named(bad, message):
    assert any(message in p for p in problems(bad))


def test_the_tracer_follows_gappy_rings_and_ignores_the_grid():
    """Concentric rings with gaps cut in them, under a lighter grid: the tracer
    must find each ring in order, inside-out, and bridge the gaps."""
    h, w = 600, 800
    img = np.full((h, w), 255, np.uint8)
    for x in range(0, w, 60):
        img[:, x] = 175  # grid: lighter than the ink threshold
    for y in range(0, h, 60):
        img[y, :] = 175
    radii = [40, 90, 140, 190]
    for r in radii:
        cv2.circle(img, (400, 300), r, 0, 2)
        cv2.line(img, (400 + r - 6, 300), (400 + r + 6, 300), 255, 8)  # a gap on the east side
    ink = (img < tc.INK).astype(np.uint8)
    dist = cv2.distanceTransform(1 - ink, cv2.DIST_L2, 3).astype(np.float32)
    rings = tc.trace_hill({"id": "test", "summit": [0.5, 0.5], "rings": 4}, dist)
    assert len(rings) == 4
    for ring, r in zip(rings, radii):
        found = np.hypot(ring[:, 0] - 400, ring[:, 1] - 300)
        assert abs(np.median(found) - r) < 2
        assert found.max() - found.min() < 8  # the gap is bridged, not wandered around


def test_the_traced_valley_is_well_formed():
    data = load_contours()
    assert problems(data) == []
    assert {h["id"] for h in data["hills"]} == {"gaumukh", "dronagiri", "nagadwara", "south", "southeast", "southwest", "sheetal"}


def test_every_summit_lies_inside_its_innermost_ring():
    for hill in load_contours()["hills"]:
        top = max(hill["rings"], key=lambda r: r["level"])
        assert polygon(top["points"]).contains(Point(*hill["summit"])), hill["id"]


def test_the_drawn_ring_counts_are_traced():
    rings = {h["id"]: len(h["rings"]) for h in load_contours()["hills"]}
    # Gaumukh is drawn with one more ring than Dronagiri, though the book makes
    # Dronagiri the tallest peak; terrain.yaml settles heights, not ring counts.
    assert rings == {"gaumukh": 6, "dronagiri": 5, "nagadwara": 2, "south": 4, "southeast": 4, "southwest": 2, "sheetal": 3}
