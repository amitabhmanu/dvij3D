"""Step 13.5: resolve the valley map's places (design §10) against the comic and
the downloaded photographs.

Reads the authored places.yaml, finds the pages where each place is named in
the lettering, joins each pairing to the credits that fetch_real_india.py read
off Commons, and fails loudly if a place points at an image that was never
fetched.

Inputs:  src/content/places.yaml, src/content/generated/places-images.json,
         site-assets/data/text.json
Output:  src/content/generated/places.json  (committed)
Usage:   python link_places.py
"""
import json
import re
import sys

import yaml

from common import ASSETS, SITE

CONTENT = SITE / "src" / "content"
GENERATED = CONTENT / "generated"


def page_order(pid: str) -> tuple[int, int]:
    return int(pid[1]), int(pid.split("-p")[1])


def page_ref(pid: str) -> dict:
    return {"id": pid, "book": int(pid[1]), "page": int(pid.split("-p")[1])}


def mentions(terms: list[str], text: dict) -> list[dict]:
    """Pages whose lettering names this place, in reading order."""
    pats = [re.compile(rf"(?<![\w-]){re.escape(t)}(?![\w-])", re.I) for t in terms]
    hits = []
    for pid in sorted(text, key=page_order):
        if any(p.search(u["t"]) for u in text[pid] for p in pats):
            hits.append(page_ref(pid))
    return hits


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    data = yaml.safe_load((CONTENT / "places.yaml").read_text(encoding="utf-8"))
    images = json.loads((GENERATED / "places-images.json").read_text(encoding="utf-8"))
    text = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))

    out_places, missing = [], []
    for place in data["places"]:
        real = place["real"]
        pictures = []
        for spec in real.get("images", []):
            credit = images.get(spec["id"])
            if credit is None:
                missing.append(f"{place['id']} -> {spec['id']}")
                continue
            # the credit facts come from Commons; only the alt text is ours
            pictures.append({
                "id": spec["id"], "alt": " ".join(spec["alt"].split()),
                "file": credit["file"], "w": credit["w"], "h": credit["h"],
                "artist": credit["artist"], "license": credit["license"],
                "licenseUrl": credit["licenseUrl"], "source": credit["source"],
                "commons": credit["commons"],
            })
        pages = mentions(place.get("terms", []), text)
        out_places.append({
            "id": place["id"], "name": place["name"], "fiction": place["fiction"],
            "rects": place.get("rects", []),
            "book": " ".join(place["book"].split()),
            "pages": pages,
            "real": {
                "name": real["name"], "pin": real.get("pin", real["name"]), "region": real["region"],
                "confidence": real["confidence"],
                "why": " ".join(real["why"].split()),
                "lat": real.get("lat"), "lng": real.get("lng"),
                "alsoFrom": real.get("alsoFrom"),
                "noPhoto": " ".join(real["noPhoto"].split()) if real.get("noPhoto") else None,
                "images": pictures,
            },
        })

    if missing:
        raise SystemExit("places.yaml points at images that were never fetched:\n  " + "\n  ".join(missing))

    unused = sorted(set(images) - {p["id"] for pl in out_places for p in pl["real"]["images"]})
    if unused:
        print(f"note: fetched but unused: {', '.join(unused)}")

    out = {
        "map": data["map"],
        "epigraph": {"text": " ".join(data["epigraph"]["text"].split()), "who": data["epigraph"]["who"]},
        "places": out_places,
        "fictional": [
            {**f, "note": " ".join(f["note"].split()) if f.get("note") else None}
            for f in data["fictional"]
        ],
    }
    (GENERATED / "places.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

    photos = sum(len(p["real"]["images"]) for p in out_places)
    located = sum(1 for p in out_places if p["rects"])
    linked = sum(1 for p in out_places if p["pages"])
    print(f"{len(out_places)} places, {located} on the map, {linked} named in the comic, "
          f"{photos} photographs, {len(out['fictional'])} left fictional")
    for p in out_places:
        pages = f"{len(p['pages'])} pages" if p["pages"] else "-"
        pics = len(p["real"]["images"]) or ("no photo" if p["real"]["noPhoto"] else 0)
        print(f"  {p['id']:20s} {p['real']['name'][:40]:42s} {str(pics):8s} {pages}")
    print(f"-> {GENERATED / 'places.json'}")


if __name__ == "__main__":
    main()
