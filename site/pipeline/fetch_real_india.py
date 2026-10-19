"""Step 0.9: fetch the Real India layer's photographs from Wikimedia Commons
(design §10) and record their credits.

Only freely licensed files are used, and the credit facts - photographer,
licence, licence URL, file page - are read from Commons itself rather than
typed here, so the attribution on the page cannot drift from the source.
Candidates and the reasoning behind each pick: docs/real-india-images.md.

Output: site-assets/art/real-*.webp
        src/content/generated/places-images.json  (committed)
Usage:  python fetch_real_india.py [--force]
"""
import argparse
import io
import json
import re
import subprocess
import sys
import time
import urllib.parse

from PIL import Image

from common import ASSETS, SITE

CONTENT = SITE / "src" / "content"

API = "https://commons.wikimedia.org/w/api.php"
UA = "TwiceBornSite/1.0 (https://github.com/amitabhmanu/dvij) image fetch for a comic's companion site"
MAX_EDGE = 1400
QUALITY = 82

# place id -> file on Commons. The pairing each one illustrates is in
# content/places.yaml; the reasoning is in docs/real-india-pairings.md.
PICKS = {
    "fort-ruins": "Andheri or Dark Passage located inside Daulatabad Fort or Deogiri Fort, Daulatabad, Maharashtra 01.jpg",
    "fort-turret": "Harihar - Rock cut steps (11253864766).jpg",
    "pushkarini": "Pushkarani step wells at Hampi.jpg",
    "pushkarini-platform": "Vandiyur Mariamman Teppakulam bij Madurai, RP-F-00-5347-78.jpg",
    "stepwell": "Chand Baori 2019 (3).jpg",
    "bhoodara-paintings": "Rock Shelter 8, Bhimbetka 02.jpg",
    "bhoodara-labyrinth": "The Main Caves, Belum, Andhra Pradesh.jpg",
    "kaal-bhairava": "Kal Bhairav Ujjain - entrance.jpg",
    "kaal-bhairava-stone": "Hoysaleswara Temple at Halebidu.jpg",
    "mahavidya-temples": "Kamakhya temple.jpg",
    "mukteshwar-temple": "Mukteshvara Temple, Bhubaneswar.jpg",
    "gaumukh-hill": "Anegundi - Anjaneya Hill - Hanuman Temple - 2.jpg",
    "kamal-taal": "Pampa Sarovar from the hill.jpg",
    "forest-temple": "Chausathi jogini temple.jpg",
    "forest-temple-alt": "0121621 Chausath Yogini and Shiva Temple, Mitaoli Madhya Pradesh.jpg",
    "vidgati-harihara": "578 CE Harihara panel Badami Cave 3.jpg",
    "vidgati-jain": "7th to 8th century Digambara Jain cave entrance, Badami cave 4, Karnataka.jpg",
    "vidgati-caves": "Exterior of Sootar Ki Jhonpri, Ellora.jpg",
    "dolmen-field": "Overview of Hirebenakal megalithic site.jpg",
    "vedic-altar": "ചിതിയുടെയും-ഉപകരണങ്ങളുടെയും മാതൃക.jpg",
    "mount-dronagiri": "Dunagiri from Kuari Pass.jpg",
    "white-flowers": "Valley of flowers national park, Uttarakhand, India 03 (edit).jpg",
    "sheetal-lake": "Varanasi Munshi Ghat3.jpg",
    "sheetal-lake-science": "Enterobacteria phage T2 transmission electron micrograph.jpg",
    "vaitarna": "Vaitarna River.jpg",
}

# Free licences only. A file whose licence is not on this list is refused rather
# than published, whatever the search that found it said.
FREE = re.compile(r"^(cc0|cc[ -]by([ -]sa)?[ -]\d|public domain|pd-)", re.I)


def curl(url: str) -> bytes:
    for attempt in range(4):
        p = subprocess.run(["curl", "-sS", "-m", "90", "-A", UA, url], capture_output=True)
        if p.returncode == 0 and p.stdout:
            return p.stdout
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"download failed: {url}")


def api(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode(dict(params, format="json", formatversion="2"))
    d = json.loads(curl(url))
    time.sleep(1)
    return d


def text(html: str) -> str:
    """Commons returns the artist and licence as HTML fragments."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def fetch(title: str) -> dict:
    d = api({"action": "query", "titles": f"File:{title}", "prop": "imageinfo",
             "iiprop": "url|size|extmetadata", "iiurlwidth": MAX_EDGE})
    page = d["query"]["pages"][0]
    if "missing" in page:
        raise SystemExit(f"not on Commons any more: {title}")
    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})

    def field(key):
        return text((meta.get(key) or {}).get("value", ""))

    license_name = field("LicenseShortName")
    if not FREE.match(license_name):
        raise SystemExit(f"refusing {title}: licence is {license_name!r}")
    return {
        "thumb": info["thumburl"],
        "artist": field("Artist"),
        "license": license_name,
        "licenseUrl": field("LicenseUrl"),
        "source": info["descriptionurl"],
        "commons": title,
        "description": field("ImageDescription")[:300],
    }


def save(data: bytes, name: str) -> dict:
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    if max(img.size) > MAX_EDGE:
        scale = MAX_EDGE / max(img.size)
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    out = ASSETS / "art" / f"{name}.webp"
    img.save(out, "WEBP", quality=QUALITY, method=6)
    return {"file": out.name, "w": img.width, "h": img.height, "bytes": out.stat().st_size}


def main() -> None:
    # photographer names are not all Latin-1; a Windows console must not stop the run
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download files already present")
    args = ap.parse_args()

    (ASSETS / "art").mkdir(parents=True, exist_ok=True)
    out_path = CONTENT / "generated" / "places-images.json"
    known = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}

    images, kept, fetched = {}, 0, 0
    for place_id, title in PICKS.items():
        name = f"real-{place_id}"
        on_disk = ASSETS / "art" / f"{name}.webp"
        if on_disk.exists() and place_id in known and not args.force:
            images[place_id] = known[place_id]
            kept += 1
            continue
        meta = fetch(title)
        images[place_id] = {**meta, **save(curl(meta["thumb"]), name)}
        images[place_id].pop("thumb", None)
        fetched += 1
        m = images[place_id]
        print(f"  {place_id:22s} {m['w']}x{m['h']:<5} {m['bytes'] // 1024:4d} KB  {m['license']:13s} {m['artist'][:34]}")

    out_path.write_text(json.dumps(images, indent=1, ensure_ascii=False), encoding="utf-8")
    total = sum(m["bytes"] for m in images.values())
    print(f"\n{len(images)} images ({fetched} fetched, {kept} already had), {total / 1e6:.1f} MB -> {ASSETS / 'art'}")
    print(f"credits -> {out_path}")


if __name__ == "__main__":
    main()
