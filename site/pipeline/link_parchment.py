"""Phase 3: resolve the parchment puzzles' story positions to comic pages.

Reads src/content/parchment.yaml. For each puzzle, the page where the
characters start it (`available`) and the page where they solve it (`solved`)
come from find_page.py. A `puzzle:` hotspot is added over the lettering where
each puzzle is introduced, so readers can jump from the comic to try it.

Outputs: src/content/generated/parchment.json  (the YAML plus resolved pages)
         src/content/hotspots/puzzles.json      (puzzle hotspots)
Usage: python link_parchment.py
"""
import json

import yaml
from rapidfuzz import fuzz

from common import ASSETS, SITE
from find_page import find

CONTENT = SITE / "src" / "content"
CORNER_BADGE = [0.9, 0.012, 0.985, 0.06]  # top-right corner of the page


def page_ref(r: dict, override: str | None = None) -> dict:
    """Resolved page, or an explicit pageId where the art abridges the quote away."""
    if override:
        book = int(override[1])
        return {"book": book, "page": int(override.split("-p")[1]), "pageId": override,
                "confidence": "reviewed"}
    return {"book": r["book"], "page": r["page"], "pageId": r["pageId"], "confidence": r["confidence"]}


def unit_for(quote: str, page_id: str, text: dict) -> list | None:
    """bbox of the lettering unit on page_id that best matches the quote."""
    best, rect = 0, None
    for u in text.get(page_id, []):
        s = fuzz.partial_ratio(quote.lower(), u["t"].lower())
        if s > best:
            best, rect = s, u["bbox"]
    return rect if best >= 70 else None


def main() -> None:
    data = yaml.safe_load((CONTENT / "parchment.yaml").read_text(encoding="utf-8"))
    text = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))
    hotspots, report = [], []

    data["intro"]["page"] = page_ref(find(data["intro"]["quote"]))
    data["intro"]["kalashaPage"] = page_ref(find(data["intro"]["kalashaQuote"]))
    for p in data["puzzles"]:
        avail = page_ref(find(p["availableQuote"]), p.get("availablePage"))
        solved = page_ref(find(p["solvedQuote"]), p.get("solvedPage"))
        p["available"], p["solved"] = avail, solved
        report.append(f"  {p['id']}: available B{avail['book']} p{avail['page']} ({avail['confidence']}), "
                      f"solved B{solved['book']} p{solved['page']} ({solved['confidence']})")
        # Over the matching lettering if the comic quotes it; otherwise a corner badge.
        rect = unit_for(p["availableQuote"], avail["pageId"], text) or CORNER_BADGE
        hotspots.append({"id": f"puzzle-{p['id']}", "page": avail["pageId"], "rect": rect,
                         "targets": [f"puzzle:{p['id']}"], "label": f"Puzzle {p['row']}: {p['title']}"})
    caves = find(data["caves"]["availableQuote"])
    data["caves"]["available"] = page_ref(caves)
    hotspots.append({"id": "puzzle-caves", "page": caves["pageId"], "rect": CORNER_BADGE,
                     "targets": ["puzzle:caves"], "label": "The Bhoodara caves puzzle"})
    report.append(f"  caves: B{caves['book']} p{caves['page']} ({caves['confidence']})")

    (CONTENT / "generated" / "parchment.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    (CONTENT / "hotspots" / "puzzles.json").write_text(json.dumps(hotspots, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"parchment intro B{data['intro']['page']['book']} p{data['intro']['page']['page']}, "
          f"kalasha B{data['intro']['kalashaPage']['book']} p{data['intro']['kalashaPage']['page']}")
    print("\n".join(report))
    print(f"{len(hotspots)} puzzle hotspots")


if __name__ == "__main__":
    main()
