"""Check that companion content is internally consistent (plan Phase 2).

- every Codex `related` id and image exists
- every Bestiary entry's codex links, kin, art pages and exclusions resolve
- every Memory Hall anchor, verse and ring pool is usable
- every hotspot's page exists and every target resolves (codex:<id> for now)
- every firstSeen (override or computed) points at a real page
- manual hotspot removals refer to real automatic hotspots
Exits non-zero on any error, so it can gate the build.
Usage: python validate_content.py
"""
import json
import sys

import yaml

from common import ASSETS, BOOKS, SITE

CONTENT = SITE / "src" / "content"


def main() -> int:
    errors: list[str] = []
    pages = {f"{m['slug']}-p{n:03d}" for m in BOOKS.values() for n in range(1, m["pages"] + 1)}
    art = {p.stem for p in (ASSETS / "art").glob("*.webp")}

    entries = {}
    for path in sorted((CONTENT / "codex").glob("*.md")):
        front = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])
        entries[path.stem] = front
        for field in ("title", "summary", "source"):
            if not front.get(field):
                errors.append(f"codex/{path.name}: missing {field}")

    for eid, e in entries.items():
        for r in e.get("related", []):
            if r not in entries:
                errors.append(f"codex/{eid}: related '{r}' does not exist")
        for img in e.get("images", []):
            if img not in art:
                errors.append(f"codex/{eid}: image '{img}' not in site-assets/art")
        fs = e.get("firstSeen")
        if fs and f"b{fs['book']}-p{fs['page']:03d}" not in pages:
            errors.append(f"codex/{eid}: firstSeen {fs} is not a real page")

    links = json.loads((CONTENT / "generated" / "codex-links.json").read_text())
    for eid in entries:
        if eid not in links:
            errors.append(f"codex/{eid}: not linked yet (run link_codex.py)")
        elif not (entries[eid].get("firstSeen") or links[eid]["firstSeen"]):
            errors.append(f"codex/{eid}: no firstSeen (not mentioned in the lettering and no anchor match)")

    beasts = {}
    for path in sorted((CONTENT / "bestiary").glob("*.md")):
        front = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])
        beasts[path.stem] = front
        for field in ("title", "summary", "appearance", "class", "source"):
            if not front.get(field):
                errors.append(f"bestiary/{path.name}: missing {field}")
        for r in front.get("related", []):
            if r not in entries:
                errors.append(f"bestiary/{path.stem}: related codex '{r}' does not exist")
        for spec in [front.get("art")] + (front.get("alsoOn") or []):
            if spec and spec["page"] not in pages:
                errors.append(f"bestiary/{path.stem}: art page {spec['page']} does not exist")
            if spec and spec.get("box") is None and spec.get("panel") is None:
                errors.append(f"bestiary/{path.stem}: art on {spec['page']} needs a box or a panel index")
        for x in front.get("exclude", []):
            if x not in pages:
                errors.append(f"bestiary/{path.stem}: exclude page '{x}' does not exist")
    for bid, b in beasts.items():
        for k in b.get("kin", []):
            if k not in beasts:
                errors.append(f"bestiary/{bid}: kin '{k}' does not exist")

    beast_links = json.loads((CONTENT / "generated" / "bestiary-links.json").read_text(encoding="utf-8"))
    for bid in beasts:
        if bid not in beast_links:
            errors.append(f"bestiary/{bid}: not linked yet (run link_bestiary.py)")
        elif not beast_links[bid]["firstSeen"]:
            errors.append(f"bestiary/{bid}: no firstSeen (not named in the lettering, no art and no override)")
        elif beast_links[bid]["art"] and beast_links[bid]["art"]["file"].removesuffix(".webp") not in art:
            errors.append(f"bestiary/{bid}: card image not in site-assets/art (run link_bestiary.py)")

    voices = {}
    for path in sorted((CONTENT / "voices").glob("*.md")):
        front = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])
        voices[path.stem] = front
        for c in front.get("codex", []):
            if c not in entries:
                errors.append(f"voices/{path.stem}: codex '{c}' does not exist")
        if front["portrait"]["page"] not in pages:
            errors.append(f"voices/{path.stem}: portrait page {front['portrait']['page']} does not exist")
    voice_links = json.loads((CONTENT / "generated" / "voices.json").read_text(encoding="utf-8"))
    for vid in voices:
        if vid not in voice_links:
            errors.append(f"voices/{vid}: not linked yet (run link_companions.py)")

    rail = json.loads((CONTENT / "generated" / "rail.json").read_text(encoding="utf-8"))
    for node in rail["nodes"]:
        if node.get("at") and node["at"]["pageId"] not in pages:
            errors.append(f"rail {node['id']}: page {node['at']['pageId']} does not exist")
        if node.get("teacher") and node["teacher"]["voice"] not in voices:
            errors.append(f"rail {node['id']}: teacher '{node['teacher']['voice']}' is not a voice")
        if node.get("codex") and node["codex"] not in entries:
            errors.append(f"rail {node['id']}: codex '{node['codex']}' does not exist")

    frags = {f["id"]: f for f in json.loads((CONTENT / "generated" / "fragments.json").read_text(encoding="utf-8"))}
    for fid, f in frags.items():
        if f["page"] not in pages:
            errors.append(f"fragment {fid}: page {f['page']} does not exist")

    memory = json.loads((CONTENT / "generated" / "memory.json").read_text(encoding="utf-8"))
    for name, a in memory["anchors"].items():
        if a["pageId"] not in pages:
            errors.append(f"memory anchor {name}: page {a['pageId']} does not exist")
    seen_verses = set()
    for v in memory["verses"]:
        if v["id"] in seen_verses:
            errors.append(f"memory verse {v['id']}: duplicate id")
        seen_verses.add(v["id"])
        if len(v["words"]) < 3:
            errors.append(f"memory verse {v['id']}: needs at least 3 words for the patterns to differ")
        for w in v["words"]:
            for field in ("deva", "iast", "gloss"):
                if not w.get(field):
                    errors.append(f"memory verse {v['id']}: a word is missing {field}")
        if v.get("codex") and v["codex"] not in entries:
            errors.append(f"memory verse {v['id']}: codex '{v['codex']}' does not exist")
        if v.get("at") and v["at"] not in pages:
            errors.append(f"memory verse {v['id']}: page {v['at']} does not exist")
    if len(memory["ring"]["items"]) < 10:
        errors.append("memory ring: needs at least 10 items for the full ring the book draws")

    memory_hs = json.loads((CONTENT / "hotspots" / "memory.json").read_text(encoding="utf-8"))
    beast_hs = json.loads((CONTENT / "hotspots" / "bestiary.json").read_text(encoding="utf-8"))
    companion_hs = json.loads((CONTENT / "hotspots" / "companions.json").read_text(encoding="utf-8"))
    auto = json.loads((CONTENT / "hotspots" / "auto.json").read_text(encoding="utf-8"))
    puzzle_hs = json.loads((CONTENT / "hotspots" / "puzzles.json").read_text(encoding="utf-8"))
    parchment = json.loads((CONTENT / "generated" / "parchment.json").read_text(encoding="utf-8"))
    puzzle_ids = {p["id"] for p in parchment["puzzles"]} | {"caves"}
    for p in parchment["puzzles"]:
        for key in ("available", "solved"):
            if p[key]["pageId"] not in pages:
                errors.append(f"parchment {p['id']}: {key} page {p[key]['pageId']} does not exist")
        for i, st in enumerate(p["stages"], 1):
            if st["answer"] not in st["choices"]:
                errors.append(f"parchment {p['id']} stage {i}: answer not among choices")
            if st.get("codex") and st["codex"] not in entries:
                errors.append(f"parchment {p['id']} stage {i}: codex '{st['codex']}' does not exist")
        if p["crop"] not in art:
            errors.append(f"parchment {p['id']}: crop '{p['crop']}' not in site-assets/art")
    manual = json.loads((CONTENT / "hotspots" / "manual.json").read_text(encoding="utf-8"))
    auto_ids = {h["id"] for h in auto + puzzle_hs + companion_hs + beast_hs + memory_hs}
    for rid in manual.get("remove", []):
        if rid not in auto_ids:
            errors.append(f"hotspots/manual.json: removes unknown hotspot '{rid}'")
    for h in auto + puzzle_hs + companion_hs + beast_hs + memory_hs + manual.get("add", []):
        if h["page"] not in pages:
            errors.append(f"hotspot {h['id']}: page {h['page']} does not exist")
        x0, y0, x1, y1 = h["rect"]
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            errors.append(f"hotspot {h['id']}: bad rect {h['rect']}")
        for t in h["targets"]:
            kind, _, ref = t.partition(":")
            if kind == "codex" and ref not in entries:
                errors.append(f"hotspot {h['id']}: target {t} does not exist")
            elif kind == "puzzle" and ref not in puzzle_ids:
                errors.append(f"hotspot {h['id']}: target {t} does not exist")
            elif kind == "voice" and ref not in voices:
                errors.append(f"hotspot {h['id']}: target {t} does not exist")
            elif kind == "fragment" and ref not in frags:
                errors.append(f"hotspot {h['id']}: target {t} does not exist")
            elif kind == "beast" and ref not in beasts:
                errors.append(f"hotspot {h['id']}: target {t} does not exist")
            elif kind == "memory" and ref != "avadhana":
                errors.append(f"hotspot {h['id']}: target {t} does not exist")
            elif kind not in ("codex", "puzzle", "voice", "place", "fragment", "beast", "memory"):
                errors.append(f"hotspot {h['id']}: unknown target kind '{kind}'")

    # The valley map and the Real India layer (design §10). Every photograph must
    # have been fetched, must be on disk, and must carry the credit its licence
    # asks for - a missing attribution is a licence breach, not a typo.
    places = json.loads((CONTENT / "generated" / "places.json").read_text(encoding="utf-8"))
    if places["map"]["art"] not in art:
        errors.append(f"places: map art '{places['map']['art']}' not in site-assets/art")
    photos = 0
    for pl in places["places"]:
        for r in pl["rects"] + [f for fic in places["fictional"] for f in fic["rects"]]:
            x0, y0, x1, y1 = r
            if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                errors.append(f"place {pl['id']}: bad map rect {r}")
        for pg in pl["pages"]:
            if pg["id"] not in pages:
                errors.append(f"place {pl['id']}: page {pg['id']} does not exist")
        if not pl["real"]["images"] and not pl["real"]["noPhoto"]:
            errors.append(f"place {pl['id']}: no photograph and no note saying why")
        for pic in pl["real"]["images"]:
            photos += 1
            if pic["file"].removesuffix(".webp") not in art:
                errors.append(f"place {pl['id']}: image {pic['file']} not in site-assets/art")
            if not pic["alt"]:
                errors.append(f"place {pl['id']}: image {pic['id']} has no alt text")
            for field in ("artist", "license", "source"):
                if not pic[field]:
                    errors.append(f"place {pl['id']}: image {pic['id']} has no {field} - it cannot be published")
            if not pic["licenseUrl"] and not pic["license"].upper().startswith(("CC0", "PUBLIC")):
                errors.append(f"place {pl['id']}: image {pic['id']} ({pic['license']}) has no licence URL")

    total = (len(auto) + len(puzzle_hs) + len(companion_hs) + len(beast_hs) + len(memory_hs)
             - len(manual.get("remove", [])) + len(manual.get("add", [])))
    if errors:
        print(f"{len(errors)} problem(s):")
        for e in errors:
            print("  -", e)
        return 1
    print(f"OK: {len(entries)} codex entries, {len(beasts)} creatures, {len(parchment['puzzles'])} puzzles, "
          f"{len(memory['verses'])} memory verses, {len(voices)} voices, {len(rail['nodes'])} rail beats, "
          f"{len(frags)} fragments, {len(places['places'])} places with {photos} credited photographs, "
          f"{total} hotspots, all references resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
