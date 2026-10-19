"""Step 0.9b: link Codex entries to the comic.

For every lettering unit (caption / balloon) that mentions an entry's alias,
emit an automatic hotspot over that unit. The earliest mention also becomes the
entry's firstSeen (its spoiler position); entries never mentioned in the
lettering fall back to their manuscript anchor via find_page.

Inputs:  src/content/codex/*.md (aliases, manuscriptAnchor), site-assets/data/text.json
Outputs: src/content/generated/codex-links.json   {id: {firstSeen, firstSeenFrom, mentions}}
         src/content/hotspots/auto.json            [{id, page, rect, targets, terms, auto}]
Manual hotspots and removals live in src/content/hotspots/manual.json (dev tool).
Usage: python link_codex.py
"""
import json
import re

import yaml

from common import ASSETS, BOOKS, SITE

CODEX = SITE / "src" / "content" / "codex"
GENERATED = SITE / "src" / "content" / "generated"
HOTSPOTS = SITE / "src" / "content" / "hotspots"


def load_entries() -> dict[str, dict]:
    entries = {}
    for path in sorted(CODEX.glob("*.md")):
        front = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])
        entries[path.stem] = front
    return entries


def alias_patterns(entries: dict) -> list[tuple[str, str, re.Pattern]]:
    """(alias, entry id, regex), longest aliases first so they win overlaps."""
    pats = []
    for eid, e in entries.items():
        for alias in e.get("aliases", []):
            pats.append((alias, eid, re.compile(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", re.I)))
    return sorted(pats, key=lambda p: -len(p[0]))


def find_terms(text: str, pats) -> list[tuple[str, str]]:
    """Non-overlapping (entry id, matched text) pairs in reading order."""
    taken: list[tuple[int, int]] = []
    found = []
    for alias, eid, pat in pats:
        for m in pat.finditer(text):
            if any(m.start() < b and a < m.end() for a, b in taken):
                continue
            taken.append((m.start(), m.end()))
            found.append((m.start(), eid, m.group(0)))
    return [(eid, t) for _, eid, t in sorted(found)]


def page_order(pid: str) -> tuple[int, int]:
    return int(pid[1]), int(pid.split("-p")[1])


def main() -> None:
    entries = load_entries()
    pats = alias_patterns(entries)
    text = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))

    hotspots, mentions = [], {eid: [] for eid in entries}
    for pid in sorted(text, key=page_order):
        for i, unit in enumerate(text[pid]):
            terms = find_terms(unit["t"], pats)
            if not terms:
                continue
            targets = list(dict.fromkeys(f"codex:{eid}" for eid, _ in terms))
            hotspots.append({
                "id": f"auto-{pid}-{i}",
                "page": pid,
                "rect": unit["bbox"],
                "targets": targets,
                "terms": list(dict.fromkeys(t for _, t in terms)),
                "auto": True,
            })
            for eid, _ in terms:
                if pid not in mentions[eid]:
                    mentions[eid].append(pid)

    links = {}
    fallback = []
    for eid, e in entries.items():
        pages = mentions[eid]
        if pages:
            b, p = page_order(pages[0])
            links[eid] = {"firstSeen": {"book": b, "page": p}, "firstSeenFrom": "lettering", "mentions": pages}
        else:
            fallback.append(eid)
            links[eid] = {"firstSeen": None, "firstSeenFrom": None, "mentions": []}

    if fallback:  # slow path: locate the manuscript anchor in the comic
        from find_page import find
        for eid in fallback:
            anchor = entries[eid].get("manuscriptAnchor")
            if anchor:
                r = find(anchor)
                links[eid].update(firstSeen={"book": r["book"], "page": r["page"]}, firstSeenFrom="manuscript")

    GENERATED.mkdir(parents=True, exist_ok=True)
    HOTSPOTS.mkdir(parents=True, exist_ok=True)
    (GENERATED / "codex-links.json").write_text(json.dumps(links, indent=1))
    (HOTSPOTS / "auto.json").write_text(json.dumps(hotspots, indent=1, ensure_ascii=False))
    manual = HOTSPOTS / "manual.json"
    if not manual.exists():
        manual.write_text(json.dumps({"add": [], "remove": []}, indent=1))

    print(f"{len(hotspots)} automatic hotspots on {len({h['page'] for h in hotspots})} pages")
    def first_key(eid: str) -> tuple[int, int]:
        fs = links[eid]["firstSeen"]
        return (fs["book"], fs["page"]) if fs else (99, 0)

    for eid in sorted(links, key=first_key):
        l = links[eid]
        fs = l["firstSeen"]
        where = f"B{fs['book']} p{fs['page']}" if fs else "—"
        print(f"  {eid:24s} first {where:9s} ({l['firstSeenFrom'] or 'none'}), {len(l['mentions'])} pages")


if __name__ == "__main__":
    main()
