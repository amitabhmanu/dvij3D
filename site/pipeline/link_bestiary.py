"""Phase 6: link the Bestiary to the comic (design §11).

Same idea as link_codex.py, with two differences the creatures force:

- **Exclusions.** "Naga" in this book is a hill and a people, not a serpent;
  "Makara" and "Simha" are zodiac signs. Each entry's `exclude` lists the pages
  where its aliases must not fire, so the roll-call on b1-p018 links and the
  star chart on b3-p025 does not (design §11.5).
- **Drawn but unnamed.** Seven creatures are in the art. `art` crops the card
  image out of the page master; `alsoOn` places a hotspot over a drawing the
  lettering never names, which the alias scan could never find.

Inputs:  src/content/bestiary/*.md, site-assets/data/text.json,
         src/content/manifests/*.json, site-assets/master/*.png
Outputs: src/content/generated/bestiary-links.json  {id: {firstSeen, firstSeenFrom, mentions, art}}
         src/content/hotspots/bestiary.json          [{id, page, rect, targets, terms}]
         site-assets/art/beast-<id>.webp
Usage: python link_bestiary.py [--sheet]   (--sheet also writes a contact sheet)
"""
import json
import re
import sys

import yaml
from PIL import Image

from common import ASSETS, SITE

CONTENT = SITE / "src" / "content"
BESTIARY = CONTENT / "bestiary"
GENERATED = CONTENT / "generated"
HOTSPOTS = CONTENT / "hotspots"


def load_entries() -> dict[str, dict]:
    entries = {}
    for path in sorted(BESTIARY.glob("*.md")):
        entries[path.stem] = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])
    return entries


def page_order(pid: str) -> tuple[int, int]:
    return int(pid[1]), int(pid.split("-p")[1])


def alias_patterns(entries: dict) -> list[tuple[str, str, re.Pattern]]:
    """(alias, entry id, regex), longest first so 'pichhal peri' beats 'peri'."""
    pats = []
    for eid, e in entries.items():
        for alias in e.get("aliases", []):
            pats.append((alias, eid, re.compile(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", re.I)))
    return sorted(pats, key=lambda p: -len(p[0]))


def panel_box(page_id: str, index: int) -> list[float]:
    book = page_id.split("-")[0]
    m = json.loads((CONTENT / "manifests" / f"{book}.json").read_text(encoding="utf-8"))
    n = int(page_id.split("-p")[1])
    page = next(p for p in m["pages"] if p["n"] == n)
    return page["panels"][index]["box"]


def resolve_box(spec: dict) -> list[float]:
    if spec.get("box"):
        return spec["box"]
    if spec.get("panel") is None:
        raise SystemExit(f"bestiary: art on {spec['page']} needs a box or a panel index")
    return panel_box(spec["page"], spec["panel"])


def crop(page_id: str, box: list[float], out_name: str) -> dict:
    img = Image.open(ASSETS / "master" / f"{page_id}.png")
    W, H = img.size
    cut = img.crop((round(box[0] * W), round(box[1] * H), round(box[2] * W), round(box[3] * H)))
    if cut.width > 640:
        cut = cut.resize((640, round(cut.height * 640 / cut.width)), Image.LANCZOS)
    path = ASSETS / "art" / f"{out_name}.webp"
    cut.convert("RGB").save(path, "WEBP", quality=85, method=6)
    return {"file": path.name, "w": cut.width, "h": cut.height, "page": page_id}


def main() -> None:
    entries = load_entries()
    pats = alias_patterns(entries)
    text = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))

    # 1. alias scan over the lettering, minus each entry's exclusions
    hotspots: list[dict] = []
    mentions: dict[str, list[str]] = {eid: [] for eid in entries}
    for pid in sorted(text, key=page_order):
        for i, unit in enumerate(text[pid]):
            found: list[tuple[int, str, str]] = []
            taken: list[tuple[int, int]] = []
            for alias, eid, pat in pats:
                if pid in entries[eid].get("exclude", []):
                    continue
                for m in pat.finditer(unit["t"]):
                    if any(m.start() < b and a < m.end() for a, b in taken):
                        continue
                    taken.append((m.start(), m.end()))
                    found.append((m.start(), eid, m.group(0)))
            if not found:
                continue
            found.sort()
            hotspots.append({
                "id": f"beast-{pid}-{i}",
                "page": pid,
                "rect": unit["bbox"],
                "targets": list(dict.fromkeys(f"beast:{eid}" for _, eid, _ in found)),
                "terms": list(dict.fromkeys(t for _, _, t in found)),
                "auto": True,
            })
            for _, eid, _ in found:
                if pid not in mentions[eid]:
                    mentions[eid].append(pid)

    # 2. drawn-but-unnamed marks, and the cropped card images
    links: dict[str, dict] = {}
    for eid, e in entries.items():
        for j, spec in enumerate(e.get("alsoOn") or []):
            box = resolve_box(spec)
            hotspots.append({
                "id": f"beast-drawn-{eid}-{j}",
                "page": spec["page"],
                "rect": [round(v, 4) for v in box],
                "targets": [f"beast:{eid}"],
                "label": e["title"],
            })

        pages = mentions[eid]
        if pages:
            b, p = page_order(pages[0])
            first, how = {"book": b, "page": p}, "lettering"
        elif e.get("firstSeen"):
            first, how = e["firstSeen"], "override"
        elif e.get("art"):
            b, p = page_order(e["art"]["page"])
            first, how = {"book": b, "page": p}, "art"
        else:
            first, how = None, None

        art = None
        if e.get("art"):
            spec = e["art"]
            box = resolve_box(spec)
            art = crop(spec["page"], box, f"beast-{eid}")
            # the card image is also a place the creature is drawn: mark it,
            # unless the lettering on that page already carries a hotspot.
            if spec["page"] not in pages:
                hotspots.append({
                    "id": f"beast-art-{eid}",
                    "page": spec["page"],
                    "rect": [round(v, 4) for v in box],
                    "targets": [f"beast:{eid}"],
                    "label": e["title"],
                })
        links[eid] = {"firstSeen": first, "firstSeenFrom": how, "mentions": pages, "art": art}

    GENERATED.mkdir(parents=True, exist_ok=True)
    (GENERATED / "bestiary-links.json").write_text(json.dumps(links, indent=1))
    (HOTSPOTS / "bestiary.json").write_text(json.dumps(hotspots, indent=1, ensure_ascii=False))

    named = sum(1 for l in links.values() if l["mentions"])
    drawn = sum(1 for l in links.values() if l["art"])
    print(f"{len(entries)} creatures: {named} named in the lettering, {drawn} with art, "
          f"{len(hotspots)} hotspots on {len({h['page'] for h in hotspots})} pages")
    for eid in sorted(links, key=lambda e: (links[e]["firstSeen"] or {"book": 9, "page": 0})["book"] * 1000
                      + (links[e]["firstSeen"] or {"book": 9, "page": 0})["page"]):
        l = links[eid]
        fs = l["firstSeen"]
        where = f"B{fs['book']} p{fs['page']}" if fs else "—"
        print(f"  {eid:14s} first {where:8s} ({l['firstSeenFrom'] or 'none'}), "
              f"{len(l['mentions'])} page(s){', art' if l['art'] else ''}")

    if "--sheet" in sys.argv:
        tiles = [(eid, Image.open(ASSETS / "art" / links[eid]["art"]["file"]).convert("RGB"))
                 for eid in sorted(links) if links[eid]["art"]]
        cols, cell = 5, 320
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * cell), "white")
        for i, (_, t) in enumerate(tiles):
            t.thumbnail((cell, cell))
            sheet.paste(t, ((i % cols) * cell, (i // cols) * cell))
        out = ASSETS / "data" / "bestiary-cards.png"
        sheet.save(out)
        print("contact sheet:", out, "order:", ", ".join(e for e, _ in tiles))


if __name__ == "__main__":
    main()
