"""Story mode's scene scripts (design §10.4): load, check, and lay out for review.

Each chapter is a YAML script in src/content/story/ (b1-ch01.yaml ...): a list
of beats, each citing where it comes from. This checks every script against the
book itself: novel paragraphs exist, breakdown panels exist, comic pages exist,
speakers are cast, actions are ones the director knows. It also writes
docs/story/review.md, which puts each beat beside the novel's own text, for the
author to read the scripts against the book.

Inputs:  src/content/story/*.yaml, book/The Twice Born.docx, images/**/chapterN_panel_breakdown.md,
         src/content/manifests/*.json
Output:  src/content/generated/story.json (committed), docs/story/review.md
Usage:   python story_scenes.py
"""
import json
import re
import sys

import yaml

from common import IMAGES_DIR, SITE
import lodge_reference

STORY = SITE / "src" / "content" / "story"
REVIEW = SITE / "docs" / "story" / "review.md"
SPEAKERS = {"dvij", "professor", "bhavi", "maharaj", "mahant", "baldev"}
ACT_KINDS = {"press", "look-press", "reach", "use"}
ACTIONS = {"effect", "caption", "wait", "animate", "prop", "sound", "camera", "look", "body", "checkpoint",
           "reflection", "progress", "end", "say", "actor", "chapter", "panels", "panel"}
SOURCE = re.compile(r"^(novel ¶\d+(-\d+)?|breakdown ch\d+ p\d+(-p\d+)?|comic b\d-p\d{3}(-\d+)?|ours)$")


class _Loader(yaml.SafeLoader):
    """YAML 1.2 booleans only: the scripts say `on: stool`, and YAML 1.1 reads that `on` as true."""


_Loader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:bool"] for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_Loader.add_implicit_resolver("tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF"))


def scenes() -> list[tuple[str, dict]]:
    return [(f.name, yaml.load(f.read_text(encoding="utf-8"), Loader=_Loader)) for f in sorted(STORY.glob("b*-ch*.yaml"))]


def breakdown_panels(book: int, chapter: int) -> int:
    hits = list(IMAGES_DIR.glob(f"book {book} - */**/chapter{chapter}_panel_breakdown.md"))
    if not hits:
        return 0
    return len(re.findall(r"^## Panel \d+", hits[0].read_text(encoding="utf-8"), flags=re.M))


def comic_pages() -> set[str]:
    pages = set()
    for f in (SITE / "src" / "content" / "manifests").glob("*.json"):
        pages |= {p["id"] for p in json.loads(f.read_text(encoding="utf-8"))["pages"]}
    return pages


def sources_of(beat: dict) -> list[str]:
    out = list(beat.get("sources", []))
    for step in beat.get("do", []) + beat.get("then", []):
        for v in step.values():
            if isinstance(v, dict):
                out += v.get("sources", [])
    return out


def problems(name: str, sc: dict, paras: int, pages: set[str]) -> list[str]:
    out = []
    where = f"story/{name}"
    for key in ("scene", "book", "pages", "title", "beats"):
        if key not in sc:
            out.append(f"{where}: missing {key}")
    for p in sc.get("pages", []):
        if f"b{sc.get('book')}-p{p:03d}" not in pages:
            out.append(f"{where}: page {p} is not a page of book {sc.get('book')}")
    cast = {c["who"] for c in sc.get("cast", [])} | {"dvij"}
    for item in sc.get("props", []) + sc.get("cast", []):
        for s in item.get("sources", []):
            if not SOURCE.match(s):
                out.append(f"{where}: {item.get('id') or item.get('who')} cites {s!r}, not a source")
    ids = set()
    ended = False
    for beat in sc.get("beats", []):
        bid = beat.get("id")
        if bid in ids:
            out.append(f"{where}: beat id {bid} is used twice")
        ids.add(bid)
        if not beat.get("sources"):
            out.append(f"{where} {bid}: no sources")
        for s in sources_of(beat):
            for part in re.split(r",\s*", s):
                if not SOURCE.match(part.strip()):
                    out.append(f"{where} {bid}: source {part!r} is not novel ¶n, breakdown chN pK, comic bN-pNNN or ours")
                    continue
                m = re.match(r"novel ¶(\d+)(?:-(\d+))?", part)
                if m and int(m.group(2) or m.group(1)) >= paras:
                    out.append(f"{where} {bid}: novel ¶{m.group(2) or m.group(1)} is past the end of the novel")
                m = re.match(r"breakdown ch(\d+) p(\d+)(?:-p(\d+))?", part)
                if m and int(m.group(3) or m.group(2)) > breakdown_panels(sc["book"], int(m.group(1))):
                    out.append(f"{where} {bid}: breakdown ch{m.group(1)} has no panel {m.group(3) or m.group(2)}")
                m = re.match(r"comic (b\d-p\d{3})", part)
                if m and m.group(1) not in pages:
                    out.append(f"{where} {bid}: comic page {m.group(1)} does not exist")
        if "act" in beat:
            if beat["act"].get("kind") not in ACT_KINDS:
                out.append(f"{where} {bid}: act kind {beat['act'].get('kind')!r} is not one of {sorted(ACT_KINDS)}")
            if not beat["act"].get("objective"):
                out.append(f"{where} {bid}: an act needs an objective to show the player")
        for step in beat.get("do", []) + beat.get("then", []):
            (verb, arg), = step.items() if len(step) == 1 else [(None, None)]
            if verb not in ACTIONS:
                out.append(f"{where} {bid}: unknown action {list(step)}")
                continue
            if verb == "say":
                if arg.get("who") not in SPEAKERS or arg.get("who") not in cast:
                    out.append(f"{where} {bid}: {arg.get('who')!r} speaks but is not in the scene's cast")
                if not arg.get("line"):
                    out.append(f"{where} {bid}: a say with no line")
            if verb == "actor" and arg.get("who") not in cast:
                out.append(f"{where} {bid}: actor {arg.get('who')!r} is not in the scene's cast")
            if verb == "end":
                ended = True
    if not ended:
        out.append(f"{where}: no beat ends the scene")
    return out


def review(paras: list[str]) -> str:
    lines = ["# Story mode: the scene scripts beside the book", "",
             "Generated by `pipeline/story_scenes.py` from `src/content/story/`. Each beat is shown with what it does "
             "and the novel's own paragraphs it cites, so the scripts can be read against the book.", ""]
    for name, sc in scenes():
        lines += [f"## {sc['title']} (Book {sc['book']}, pages {', '.join(map(str, sc['pages']))})", ""]
        for beat in sc["beats"]:
            lines += [f"### {beat['id']}", ""]
            if "act" in beat:
                lines += [f"**You:** {beat['act']['objective']}", ""]
            for step in beat.get("do", []) + beat.get("then", []):
                (verb, arg), = step.items()
                if verb == "say":
                    lines.append(f"- **{arg['who'].title()}:** “{arg['line']}”")
                elif verb == "caption":
                    lines.append(f"- *Caption:* {arg}")
                elif verb in ("actor", "camera", "effect", "prop", "panels", "reflection", "panel"):
                    lines.append(f"- *{verb}:* `{json.dumps(arg, ensure_ascii=False)}`")
            cited = sorted({int(n) for s in sources_of(beat) for n in re.findall(r"novel ¶(\d+)", s)})
            if cited:
                lines += ["", "<details><summary>The novel</summary>", ""]
                for n in cited:
                    lines += [f"> **¶{n}** {paras[n]}", ">"]
                lines += ["</details>"]
            lines += ["", f"<sub>sources: {', '.join(beat['sources'])}</sub>", ""]
    return "\n".join(lines)


def main() -> None:
    paras = lodge_reference.novel_paragraphs()
    pages = comic_pages()
    bad = [p for name, sc in scenes() for p in problems(name, sc, len(paras), pages)]
    if bad:
        print("\n".join(bad))
        sys.exit(1)
    # what the game reads: every scene, in order
    out = SITE / "src" / "content" / "generated" / "story.json"
    # A scene marked `skip` (one Dvij is not in) stays as a script but is not played.
    out.write_text(json.dumps({"version": 1, "scenes": [sc for _, sc in scenes() if not sc.get("skip")]}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    REVIEW.write_text(review(paras), encoding="utf-8")
    n = sum(len(sc["beats"]) for _, sc in scenes())
    print(f"{len(scenes())} scenes, {n} beats, all sources resolve -> docs/story/review.md")


if __name__ == "__main__":
    main()
