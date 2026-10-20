import copy

import lodge_reference
import story_scenes as ss

PARAS = len(lodge_reference.novel_paragraphs())
PAGES = ss.comic_pages()
SCENES = dict(ss.scenes())


def test_every_scene_script_checks_out_against_the_book():
    for name, sc in SCENES.items():
        assert ss.problems(name, sc, PARAS, PAGES) == [], name


def test_the_slice_runs_from_waking_to_the_kitchen_in_page_order():
    order = [SCENES[n] for n in sorted(SCENES)]
    assert [sc["scene"] for sc in order] == ["b1-ch01", "b1-ch02", "b1-ch03", "b1-ch04", "b1-ch05"]
    pages = [p for sc in order for p in sc["pages"]]
    assert pages == sorted(pages) and pages[0] == 4
    for a, b in zip(order, order[1:]):
        assert a["beats"][-1]["do" if "do" in a["beats"][-1] else "then"][-1]["end"]["next"] == b["scene"]


def test_bad_scripts_are_caught():
    sc = copy.deepcopy(SCENES["b1-ch03.yaml"])
    sc["beats"][0]["sources"] = ["novel ¶999999"]
    sc["beats"][1]["then"].append({"say": {"who": "mahant", "line": "x"}})
    sc["beats"][2]["do"].append({"teleport": {}})
    got = " | ".join(ss.problems("x", sc, PARAS, PAGES))
    assert "past the end of the novel" in got
    assert "'mahant' speaks but is not in the scene's cast" in got
    assert "unknown action" in got
