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
