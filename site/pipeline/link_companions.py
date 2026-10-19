"""Phase 4: link the Journey rail, Council of Voices and Charvaka fragments to the comic.

- rail.yaml nodes: `quote` -> comic page (find_page.py)
- voices/*.md: `quote` -> firstSeen; `portrait` {page, match} -> the panel
  holding that line, cropped as the card image. `box` overrides the panel;
  `from` takes the crop from a different page, for figures whose quoted line
  is spoken about them rather than by them. The hotspot always stays on `page`.
  holding that lettering is cropped from the page master into
  site-assets/art/voice-<id>.webp, and a `voice:` hotspot is placed over the line
- fragments.yaml: {page, match} -> a `fragment:` hotspot over that lettering
  (or a small corner mark when the page has none)

Outputs: src/content/generated/{rail,voices,fragments}.json,
         src/content/hotspots/companions.json, site-assets/art/voice-*.webp
Usage: python link_companions.py [--sheet]   (--sheet also writes a portrait contact sheet)
"""
import json
import sys

import yaml
from PIL import Image

from common import ASSETS, SITE
from find_page import find

CONTENT = SITE / "src" / "content"
FRAGMENT_CORNER = [0.015, 0.94, 0.07, 0.985]  # bottom-left corner mark


def text_units() -> dict:
    return json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))


def manifest_panels(page_id: str) -> list[list[float]]:
    book = page_id.split("-")[0]
    m = json.loads((CONTENT / "manifests" / f"{book}.json").read_text(encoding="utf-8"))
    n = int(page_id.split("-p")[1])
    page = next(p for p in m["pages"] if p["n"] == n)
    return [p["box"] for p in page["panels"]]


def unit_matching(units: list[dict], match: str) -> dict | None:
    if not match:
        return None
    return next((u for u in units if match.lower() in u["t"].lower()), None)


def panel_for(box: list[float], panels: list[list[float]]) -> list[float] | None:
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    inside = [p for p in panels if p[0] <= cx <= p[2] and p[1] <= cy <= p[3]]
    return min(inside, key=lambda p: (p[2] - p[0]) * (p[3] - p[1])) if inside else None


def crop_portrait(page_id: str, box: list[float], out_name: str) -> dict:
    img = Image.open(ASSETS / "master" / f"{page_id}.png")
    W, H = img.size
    crop = img.crop((round(box[0] * W), round(box[1] * H), round(box[2] * W), round(box[3] * H)))
    if crop.width > 640:
        crop = crop.resize((640, round(crop.height * 640 / crop.width)), Image.LANCZOS)
    path = ASSETS / "art" / f"{out_name}.webp"
    crop.convert("RGB").save(path, "WEBP", quality=85, method=6)
    return {"file": path.name, "w": crop.width, "h": crop.height}


def main() -> None:
    text = text_units()
    hotspots = []

    # ---- rail ----
    rail = yaml.safe_load((CONTENT / "rail.yaml").read_text(encoding="utf-8"))
    for node in rail["nodes"]:
        if node.get("page"):  # reviewed against the art; the quote is narration the art never lettered
            pid = node.pop("page")
            node["at"] = {"book": int(pid[1]), "page": int(pid.split("-p")[1]), "pageId": pid,
                          "confidence": "reviewed"}
        elif node.get("quote"):
            r = find(node["quote"])
            node["at"] = {"book": r["book"], "page": r["page"], "pageId": r["pageId"], "confidence": r["confidence"]}
    lit = [n for n in rail["nodes"] if n.get("at")]
    rail["range"] = {"from": lit[0]["at"], "to": {"book": 5, "page": 29}}
    (CONTENT / "generated" / "rail.json").write_text(json.dumps(rail, indent=1, ensure_ascii=False), encoding="utf-8")
    print("rail:", ", ".join(f"{n['id']}@B{n['at']['book']}p{n['at']['page']}" for n in lit))

    # ---- voices ----
    voices = {}
    for path in sorted((CONTENT / "voices").glob("*.md")):
        front = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])
        vid = path.stem
        if front.get("firstSeen"):  # explicit override
            first = {**front["firstSeen"]}
        else:
            first = find(front.get("firstQuote") or front["quote"])
        pid = front["portrait"]["page"]                       # where the hotspot goes
        src = front["portrait"].get("from") or pid            # where the crop comes from
        unit = unit_matching(text.get(pid, []), front["portrait"].get("match", ""))
        box = front["portrait"].get("box")
        if not box:
            panels = manifest_panels(src)
            box = (panel_for(unit["bbox"], panels) if unit and src == pid else None) or max(
                panels, key=lambda p: (p[2] - p[0]) * (p[3] - p[1]))
        portrait = crop_portrait(src, box, f"voice-{vid}")
        voices[vid] = {"firstSeen": {"book": first["book"], "page": first["page"]},
                       "portrait": {**portrait, "page": src, "fromLettering": bool(unit)}}
        if unit:
            hotspots.append({"id": f"voice-{vid}", "page": pid, "rect": unit["bbox"],
                             "targets": [f"voice:{vid}"], "label": front["name"]})
        how = ("explicit box" if front["portrait"].get("box") else
               "panel of the line" if unit else "largest panel: no lettering match")
        print(f"voice {vid:18s} first B{first['book']} p{first['page']:<3} portrait {src} "
              f"({how}{', note on ' + pid if src != pid else ''})")
    (CONTENT / "generated" / "voices.json").write_text(json.dumps(voices, indent=1), encoding="utf-8")

    # ---- fragments ----
    frags = yaml.safe_load((CONTENT / "fragments.yaml").read_text(encoding="utf-8"))["fragments"]
    for i, f in enumerate(frags, 1):
        unit = unit_matching(text.get(f["page"], []), f["match"])
        hotspots.append({"id": f"fragment-{f['id']}", "page": f["page"],
                         "rect": unit["bbox"] if unit else FRAGMENT_CORNER,
                         "targets": [f"fragment:{f['id']}"], "label": f["title"], "subtle": True})
        print(f"fragment {i} {f['id']:14s} {f['page']} {'lettering' if unit else 'corner mark'}")

    (CONTENT / "generated" / "fragments.json").write_text(json.dumps(frags, indent=1, ensure_ascii=False), encoding="utf-8")
    (CONTENT / "hotspots" / "companions.json").write_text(json.dumps(hotspots, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(hotspots)} companion hotspots")

    if "--sheet" in sys.argv:
        tiles = [Image.open(ASSETS / "art" / f"voice-{v}.webp").convert("RGB") for v in voices]
        h = 260
        tiles = [t.resize((round(t.width * h / t.height), h)) for t in tiles]
        sheet = Image.new("RGB", (sum(t.width for t in tiles) + 10 * len(tiles), h), "white")
        x = 0
        for t in tiles:
            sheet.paste(t, (x, 0))
            x += t.width + 10
        sheet.save(ASSETS / "data" / "voice-portraits.png")
        print("contact sheet:", ASSETS / "data" / "voice-portraits.png", "order:", ", ".join(voices))


if __name__ == "__main__":
    main()
