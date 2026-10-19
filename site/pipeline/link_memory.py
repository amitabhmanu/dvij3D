"""Phase 7: pin the Memory Hall to the comic (design §12).

The Hall's anchors are comic *lettering*, not manuscript prose — the Professor's
balloons on b2-p008 are the art's own wording — so find_page.py (which searches
the manuscript) is the wrong tool. Each anchor names its page and a fragment of
the line, and this resolves the fragment to that line's bounding box.

Also places one `memory:` hotspot over "Techniques of memorization!", so a
reader meeting the technique in the comic can go and try it.

Inputs:  src/content/memory.yaml, site-assets/data/text.json
Outputs: src/content/generated/memory.json  (the YAML plus resolved pages)
         src/content/hotspots/memory.json    (the badge hotspot)
Usage: python link_memory.py
"""
import json

import yaml
from rapidfuzz import fuzz

from common import ASSETS, SITE

CONTENT = SITE / "src" / "content"


def resolve(anchor: dict, text: dict) -> dict:
    """The lettering unit on `page` that best matches `match`."""
    pid = anchor["page"]
    units = text.get(pid, [])
    if not units:
        raise SystemExit(f"memory: page {pid} has no lettering")
    best = max(units, key=lambda u: fuzz.partial_ratio(anchor["match"].lower(), u["t"].lower()))
    score = fuzz.partial_ratio(anchor["match"].lower(), best["t"].lower())
    if score < 80:
        raise SystemExit(f"memory: '{anchor['match']}' does not match anything on {pid} (best {score})")
    book, page = int(pid[1]), int(pid.split("-p")[1])
    return {"book": book, "page": page, "pageId": pid, "rect": best["bbox"], "text": best["t"], "score": score}


def main() -> None:
    data = yaml.safe_load((CONTENT / "memory.yaml").read_text(encoding="utf-8"))
    text = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))

    for name, anchor in data["anchors"].items():
        data["anchors"][name] = {**anchor, **resolve(anchor, text)}

    teaches = data["anchors"]["teaches"]
    hotspots = [{
        "id": "memory-avadhana",
        "page": teaches["pageId"],
        "rect": teaches["rect"],
        "targets": ["memory:avadhana"],
        "label": "The memory technique",
    }]

    (CONTENT / "generated" / "memory.json").write_text(
        json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    (CONTENT / "hotspots" / "memory.json").write_text(
        json.dumps(hotspots, indent=1, ensure_ascii=False), encoding="utf-8")

    for name, a in data["anchors"].items():
        print(f"  {name:8s} B{a['book']} p{a['page']:<3} ({a['score']}%) {a['text'][:60]}…")
    words = {v["id"]: len(v["words"]) for v in data["verses"]}
    print(f"{len(data['verses'])} verses ({', '.join(f'{k}: {n} words' for k, n in words.items())}), "
          f"{len(data['ring']['items'])} ring items, {len(hotspots)} hotspot")


if __name__ == "__main__":
    main()
