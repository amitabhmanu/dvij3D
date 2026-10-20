import hashlib
import json

import numpy as np
import yaml
from shapely.geometry import Point, Polygon

import build_walk as bw
import extract_cutouts as ec
import place_world as pw

WALK = json.loads(bw.WALK_JSON.read_text(encoding="utf-8"))
CUT = json.loads(ec.CUTOUTS_JSON.read_text(encoding="utf-8"))
CFG = yaml.safe_load(ec.CUTOUTS_YAML.read_text(encoding="utf-8"))
WORLD = json.loads((bw.OUT / WALK["world"]).read_text(encoding="utf-8"))
TREES = pw.decode_trees((bw.OUT / WALK["trees"]).read_bytes())
LAKE = Polygon(WALK["water"][0]["points"])


def test_the_atlas_is_hashed_within_budget_and_holds_every_cut_out():
    data = (bw.OUT / CUT["atlas"]).read_bytes()
    assert CUT["atlas"] == f"cutouts.{hashlib.sha256(data).hexdigest()[:10]}.webp"
    assert len(data) < 300 * 1024
    ids = [s["id"] for s in CUT["sprites"]]
    assert ids[:len(CFG["buildings"])] == [b["id"] for b in CFG["buildings"]]
    assert sum(s["kind"] == "tree" for s in CUT["sprites"]) == CFG["trees"]["count"]
    for s in CUT["sprites"]:  # every rectangle lies inside the atlas
        assert 0 <= s["x"] and s["x"] + s["w"] <= CUT["w"] and 0 <= s["y"] and s["y"] + s["h"] <= CUT["h"]


def test_every_building_stands_on_the_map_and_on_dry_land():
    assert len(WORLD["buildings"]) == len(CFG["buildings"])
    half_w, half_d = WALK["worldWidth"] / 2, WALK["worldDepth"] / 2
    for b in WORLD["buildings"]:
        assert abs(b["x"]) < half_w and abs(b["z"]) < half_d, b["id"]
        assert not LAKE.contains(Point(b["x"], b["z"])), b["id"]
        assert b["door"] is None and b["interior"] is None  # ready for interiors, none yet


def test_named_buildings_stand_where_their_labels_are():
    """The painting and map.jpg label the same places, though not in quite the
    same spots (map.jpg writes Bhoothnath's name well to the east of the temple);
    each named building should stand within 700 m of its label."""
    places = yaml.safe_load((ec.CONTENT / "places.yaml").read_text(encoding="utf-8"))
    rects = {p["id"]: p["rects"][0] for p in places["places"] + places["fictional"] if p.get("rects")}
    ww, wd = WALK["worldWidth"], WALK["worldDepth"]
    named = [b for b in WORLD["buildings"] if b["place"]]
    assert len(named) == 6
    for b in named:
        x0, y0, x1, y1 = rects[b["place"]]
        lx, lz = ((x0 + x1) / 2 - 0.5) * ww, ((y0 + y1) / 2 - 0.5) * wd
        assert np.hypot(b["x"] - lx, b["z"] - lz) < 700, b["id"]


def test_trees_grow_on_dry_land_clear_of_buildings():
    assert len(TREES) > 20000
    assert not any(LAKE.contains(Point(x, z)) for x, z, *_ in TREES[::7])
    for b in WORLD["buildings"]:
        d = np.hypot(TREES[:, 0] - b["x"], TREES[:, 1] - b["z"])
        assert d.min() > b["r"] + 3, b["id"]
    lo, hi = CUT["treeHeight"]
    assert TREES[:, 3].min() >= lo - 0.05 and TREES[:, 3].max() <= hi + 0.05


def test_trees_follow_the_painting_green():
    """Madangi Van (east) is painted as forest; the ground north of Sheetal Lake
    and the plain round the Mahavidya temples are painted mostly bare."""
    def count(x0, z0, x1, z1):
        m = (TREES[:, 0] > x0) & (TREES[:, 0] < x1) & (TREES[:, 1] > z0) & (TREES[:, 1] < z1)
        return int(m.sum())
    forest = count(2600, 200, 3600, 800)
    assert forest > 3 * count(-500, -1600, 500, -1000)
    assert forest > 2.5 * count(0, -1500, 1000, -900)


def test_tree_rows_round_trip():
    rows = np.array([[12.25, -3400.5, 3, 7.4], [-4999.75, 3388.0, 0, 14.0]])
    back = pw.decode_trees(pw.encode_trees(rows))
    assert np.allclose(back, rows, atol=0.13)
