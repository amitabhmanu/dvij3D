import copy

import lodge_reference
import story_scenes as ss

PARAS = len(lodge_reference.novel_paragraphs())
PAGES = ss.comic_pages()
SCENES = dict(ss.scenes())


def test_every_scene_script_checks_out_against_the_book():
    for name, sc in SCENES.items():
        assert ss.problems(name, sc, PARAS, PAGES) == [], name


def test_the_slice_runs_from_waking_to_the_temple_site_in_page_order():
    # only scenes Dvij is in are played: the story is seen through his eyes
    order = [SCENES[n] for n in sorted(SCENES) if not SCENES[n].get("skip")]
    assert [sc["scene"] for sc in order] == ["b1-ch01", "b1-ch03", "b1-ch04", "b1-ch05", "b1-ch07", "b1-ch08", "b1-ch09"]
    assert {n for n, sc in SCENES.items() if sc.get("skip")} == {"b1-ch02.yaml", "b1-ch06.yaml"}
    pages = [p for sc in order for p in sc["pages"]]
    assert pages == sorted(pages) and pages[0] == 4
    for a, b in zip(order, order[1:]):
        last = a["beats"][-1]
        assert last["then" if "then" in last else "do"][-1]["end"]["next"] == b["scene"]


def test_bad_scripts_are_caught():
    sc = copy.deepcopy(SCENES["b1-ch03.yaml"])
    sc["beats"][0]["sources"] = ["novel ¶999999"]
    sc["beats"][1]["then"].append({"say": {"who": "mahant", "line": "x"}})
    sc["beats"][2]["do"].append({"teleport": {}})
    got = " | ".join(ss.problems("x", sc, PARAS, PAGES))
    assert "past the end of the novel" in got
    assert "'mahant' speaks but is not in the scene's cast" in got
    assert "unknown action" in got
