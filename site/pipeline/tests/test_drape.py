import hashlib
import json

import numpy as np
import pytest
import yaml
from PIL import Image

import extract_valley_drape as ev
from valley_contours import CONTENT

DRAPE = json.loads(ev.DRAPE_JSON.read_text(encoding="utf-8"))
POINTS = yaml.safe_load(ev.POINTS.read_text(encoding="utf-8"))["points"]


def test_the_painted_map_is_extracted_and_not_the_black_image():
    rgb = ev.extract()
    assert rgb.shape[:2] == (1104, 1425)
    assert rgb.mean() > 50


def test_the_drape_is_published_under_its_hash_and_budget():
    f = ev.TERRAIN / DRAPE["file"]
    data = f.read_bytes()
    assert DRAPE["file"] == f"valley-drape.{hashlib.sha256(data).hexdigest()[:10]}.webp"
    assert len(data) < 500 * 1024
    assert Image.open(f).size == (DRAPE["w"], DRAPE["h"])
    assert abs(DRAPE["w"] / DRAPE["h"] - 686 / 465) < 0.01  # map.jpg's frame
    assert [p.name for p in ev.TERRAIN.glob("valley-drape.*.webp")] == [DRAPE["file"]]  # no stale copies


def test_the_registration_lands_every_matching_point():
    warp, method, rms, resid = ev.fit(POINTS, 686, 465)
    m = np.array([p["map"] for p in POINTS])
    p = np.array([p["painted"] for p in POINTS])
    err = np.hypot(*((warp(m) - p) * [1425, 1104]).T)  # painting px
    assert method == DRAPE["method"]
    assert err.max() < 6, POINTS[int(err.argmax())]["name"]


def test_every_labelled_place_falls_on_the_painting():
    warp, *_ = ev.fit(POINTS, 686, 465)
    places = yaml.safe_load((CONTENT / "places.yaml").read_text(encoding="utf-8"))["places"]
    centres = np.array([[(r[0] + r[2]) / 2, (r[1] + r[3]) / 2] for pl in places for r in pl.get("rects", [])])
    on = warp(centres)
    assert ((on > 0) & (on < 1)).all()


@pytest.mark.parametrize("bad", [[], POINTS[:5]])
def test_too_few_points_are_refused(bad, monkeypatch, tmp_path):
    f = tmp_path / "points.yaml"
    f.write_text(yaml.safe_dump({"points": bad}))
    monkeypatch.setattr(ev, "POINTS", f)
    with pytest.raises(SystemExit):
        ev.main()
