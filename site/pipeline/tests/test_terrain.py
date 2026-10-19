import hashlib
import json

import cv2
import numpy as np
import pytest
from PIL import Image
from shapely.geometry import LineString, Point, Polygon

import build_terrain as bt
from valley_contours import load_contours

CFG = bt.knobs()
CONTOURS = load_contours()
HILLS = {h["id"]: h for h in CONTOURS["hills"]}
TERRAIN = json.loads(bt.TERRAIN_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built():
    grid, base, final, fields, intervals, bases, water, interval_map = bt.build(CFG, CONTOURS)
    return {"grid": grid, "base": base, "final": final, "fields": fields, "intervals": intervals,
            "bases": bases, "water": water, "interval_map": interval_map}


def map_px(grid, pts):
    """Grid pixels -> map.jpg pixels (686 wide), the unit the rings were drawn in."""
    uv = grid.to_uv(pts)
    return uv * [686, 465]


def test_each_ring_is_where_its_height_is_crossed(built):
    """The key fidelity test: in every hill's base terrain, the line where the land
    crosses a ring's height lies on that ring, within 3 px of the book's map."""
    grid = built["grid"]
    for hid, hill in HILLS.items():
        f, iv, b0 = built["fields"][hid], built["intervals"][hid], built["bases"][hid]
        for ring in hill["rings"]:
            level = b0 + ring["level"] * iv
            above = (np.nan_to_num(f, nan=-1e9) >= level) if iv > 0 else (np.nan_to_num(f, nan=1e9) <= level)
            cs, _ = cv2.findContours(above.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            summit = grid.to_px([hill["summit"]])[0]
            mine = [c for c in cs if cv2.pointPolygonTest(c, (float(summit[0]), float(summit[1])), False) >= 0]
            assert mine, f"{hid} level {ring['level']}: no iso-line around the summit"
            iso = map_px(grid, mine[0].reshape(-1, 2) + 0.5)
            drawn = np.asarray(ring["points"]) * [686, 465]
            d = LineString(np.r_[iso, iso[:1]]).hausdorff_distance(LineString(np.r_[drawn, drawn[:1]]))
            assert d < 3, f"{hid} level {ring['level']}: iso-line is {d:.1f} px from the drawn ring"


def test_detail_never_moves_the_land_more_than_its_cap(built):
    diff = np.abs(built["final"] - built["base"])
    assert (diff <= CFG["noise"]["cap"] * built["interval_map"] + 1e-6).all()


def test_inside_a_ring_the_land_stays_at_or_above_its_height(built):
    grid, final = built["grid"], built["final"]
    for hid, hill in HILLS.items():
        if hill["kind"] != "hill":
            continue
        iv, b0 = built["intervals"][hid], built["bases"][hid]
        for ring in hill["rings"]:
            m = grid.mask(ring["points"]).astype(bool)
            m = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)  # away from the blurred edge
            floor = b0 + ring["level"] * iv - CFG["noise"]["cap"] * iv
            assert final[m].min() >= floor - 1e-6, f"{hid} level {ring['level']}"


def test_dronagiri_is_the_highest_point_on_the_map(built):
    grid, final = built["grid"], built["final"]
    x0, y0 = grid.to_px([[0, 0]])[0].astype(int)
    x1, y1 = grid.to_px([[1, 1]])[0].astype(int)
    on_map = final[y0:y1, x0:x1]
    top = np.unravel_index(on_map.argmax(), on_map.shape)
    u, v = grid.to_uv([[top[1] + x0, top[0] + y0]])[0]
    dron = Polygon(HILLS["dronagiri"]["rings"][0]["points"])
    assert dron.contains(Point(u, v))
    assert TERRAIN["summits"]["dronagiri"][1] == max(s[1] for s in TERRAIN["summits"].values())


def test_dronagiri_is_craggier_to_the_south_east_than_the_north_west(built):
    grid, final = built["grid"], built["final"]
    gy, gx = np.gradient(final)
    slope = np.hypot(gx, gy)
    region = ~np.isnan(built["fields"]["dronagiri"])
    se = bt.sector_weight(grid, HILLS["dronagiri"]["summit"], 135) > 0.7
    nw = bt.sector_weight(grid, HILLS["dronagiri"]["summit"], 315) > 0.7
    steep_se = np.percentile(slope[region & se], 90)
    steep_nw = np.percentile(slope[region & nw], 90)
    assert steep_se > 1.3 * steep_nw


def test_sheetal_lake_is_flat_and_below_its_shore(built):
    grid, final = built["grid"], built["final"]
    (lake,) = built["water"]
    inside = grid.mask(lake["points"]).astype(bool)
    shore = cv2.dilate(inside.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~inside
    assert lake["level"] < final[shore].min()  # it cannot spill
    m = cv2.erode(inside.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    assert np.percentile(final[m], 50) < lake["level"]  # the bed is under water


def test_the_heightmap_is_whole_and_uses_its_range(built):
    assert not np.isnan(built["final"]).any()
    f = bt.OUT / TERRAIN["height"]["file"]
    q = np.asarray(Image.open(f))
    assert q.min() == 0 and q.max() == 255
    assert q.shape == (TERRAIN["height"]["h"], TERRAIN["height"]["w"])


def test_the_same_inputs_give_the_same_terrain(built):
    again = bt.build(CFG, CONTOURS)[2]
    assert np.array_equal(again, built["final"])
    png, *_ = bt.encode_height(built["final"])
    assert TERRAIN["height"]["file"] == f"valley-height.{hashlib.sha256(png).hexdigest()[:10]}.png"


def test_terrain_files_are_hashed_single_and_within_budget():
    for key, budget in (("height", 400), ("poster", 150)):
        name = TERRAIN[key]["file"] if key == "height" else TERRAIN[key]
        data = (bt.OUT / name).read_bytes()
        assert name.split(".")[1] == hashlib.sha256(data).hexdigest()[:10]
        assert len(data) < budget * 1024, f"{name} is {len(data) // 1024} KB"
        stem = name.split(".")[0]
        assert [p.name for p in bt.OUT.glob(f"{stem}.*")] == [name]


def test_no_boulder_sits_in_the_lake():
    lake = Polygon(TERRAIN["water"][0]["points"])
    assert TERRAIN["boulders"]
    assert not any(lake.contains(Point(b[0], b[2])) for b in TERRAIN["boulders"])


def test_boulders_crowd_around_the_fort():
    fx, _, fz = TERRAIN["anchors"]["fort-ruins"]
    r = CFG["boulders"]["fortRadius"]
    near = sum(np.hypot(b[0] - fx, b[2] - fz) < r for b in TERRAIN["boulders"])
    area_share = np.pi * r * r / (TERRAIN["worldWidth"] * TERRAIN["worldDepth"])
    assert near > 3 * area_share * len(TERRAIN["boulders"])


def test_every_labelled_place_has_an_anchor():
    import yaml
    places = yaml.safe_load(bt.PLACES_YAML.read_text(encoding="utf-8"))["places"]
    located = [p["id"] for p in places if p.get("rects")]
    assert sorted(TERRAIN["anchors"]) == sorted(located)
    assert len(located) == 8
