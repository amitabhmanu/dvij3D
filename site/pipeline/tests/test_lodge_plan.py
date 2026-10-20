import copy

import lodge_plan as lp

PLAN = lp.load()


def test_the_lodge_plan_is_sound():
    assert lp.problems(PLAN) == []


def test_every_feature_names_its_source():
    assert PLAN["character"]["sources"]
    for r in PLAN["rooms"]:
        assert r["sources"], r["id"]
    for key, g in PLAN["grounds"].items():
        assert g.get("sources"), key


def test_the_study_must_stay_in_the_north_west_corner():
    moved = copy.deepcopy(PLAN)
    study = next(r for r in moved["rooms"] if r["id"] == "study")
    study["rect"] = [5, -16, 16, -10.5]
    assert any("north-west" in p for p in lp.problems(moved))


def test_a_room_without_a_door_is_caught():
    shut = copy.deepcopy(PLAN)
    next(r for r in shut["rooms"] if r["id"] == "store")["doors"] = []
    assert any("store can't be reached" in p for p in lp.problems(shut))


def test_every_disagreement_is_a_question_for_the_author():
    asks = {r.get("ask") for r in PLAN["rooms"]} | {PLAN["house"]["court_cover"].get("ask")}
    assert asks - {None} <= set(PLAN["questions"])


def test_every_look_has_a_source_and_real_comic_pages():
    import json
    pages = set()
    for f in (lp.SITE / "src" / "content" / "manifests").glob("*.json"):
        pages |= {p["id"] for p in json.loads(f.read_text(encoding="utf-8"))["pages"]}
    assert len(PLAN["looks"]) >= 6
    for look in PLAN["looks"]:
        assert look["sources"] and look["text"], look["id"]
        assert look["pages"] and set(look["pages"]) <= pages, look["id"]
    assert PLAN["back_wall_patch"]["page"] in pages
