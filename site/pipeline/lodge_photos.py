"""Photo-scanned materials for the lodge and the close-up ground (design §10.3).

CC0 sets from Poly Haven (https://polyhaven.com): colour, normal (OpenGL) and
roughness at 1K. Each colour map is graded to the mean colour of the texture
lodge_textures.py generates for that surface, so the house keeps the comic's
palette (cream whitewash, red tiles, green shutters, dark sal wood); the photo
brings the surface, not the colour.

    python lodge_photos.py fetch    download the sets into site-assets/textures/ (git-ignored) and
                                    write their credits (docs/texture-credits.md, site-assets/walk/TEXTURE-CREDITS.md)
    python lodge_photos.py ground   make the walk's close-up ground textures

build_lodge.py calls lodge_maps() for the model's textures; build_ground() makes the
walk's close-up ground textures (site-assets/walk/ground-*.webp, listed in
src/content/generated/ground-detail.json).
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from common import ASSETS, SITE

LIBRARY = ASSETS / "textures"
API = "https://api.polyhaven.com"
MAPS = {"color": "Diffuse", "normal": "nor_gl", "rough": "Rough"}
HEADERS = {"User-Agent": "twice-born-site pipeline (lodge_photos.py)"}  # Poly Haven refuses Python's default


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)).read()

# lodge material -> (Poly Haven set, its pixels in the model: 1024 where you stand close, 512 elsewhere)
LODGE = {
    "whitewash": ("painted_plaster_wall", 1024),
    "whitewash-grey": ("cracked_concrete_wall", 1024),  # the "staid grey" back wall (novel ¶1446)
    "soot": ("painted_plaster_wall", 512),  # the same plaster, smoke-black (novel ¶195)
    "tiles": ("clay_roof_tiles_02", 512),  # seen from below and afar
    "flags": ("large_grey_tiles", 1024),  # laid smaller than scanned (see SCALE)
    "flags-court": ("precast_stone_paving", 1024),
    "wood": ("weathered_brown_planks", 512),
    "shutter": ("green_rough_planks", 512),
    "iron": ("rust_coarse_01", 512),
    "gravel": ("gravel_floor", 512),
    "lawn": ("withered_grass", 512),
}
# metres one repeat covers, where it isn't the scan's own size: the rooms' floor tiles
# about 40 cm, as an old colonial house would have them, not the scan's 1 m slabs
SCALE = {"flags": 1.2, "whitewash-grey": 2.0}
# how much of the photo's own light and dark to keep: the cracked concrete is far busier
# than a stained lime wall (novel ¶1446)
CONTRAST = {"whitewash-grey": 0.5}
# the walk's close-up ground (ground.ts): the shader's earth, grass and rock
GROUND = {"earth": "dry_ground_rocks", "grass": "withered_grass", "rock": "rock_face_04"}
GROUND_COLOUR = {"earth": (166, 137, 97), "grass": (112, 124, 69), "rock": (149, 142, 133)}  # ground.ts's flat colours, in sRGB


def fetch() -> None:
    """Download every set this file names (1K JPG maps) and record where each came from."""
    LIBRARY.mkdir(parents=True, exist_ok=True)
    rows = []
    for asset in sorted({a for a, _ in LODGE.values()} | set(GROUND.values())):
        files = json.loads(get(f"{API}/files/{asset}"))
        info = json.loads(get(f"{API}/info/{asset}"))
        folder = LIBRARY / asset
        folder.mkdir(exist_ok=True)
        for ours, theirs in MAPS.items():
            url = files[theirs]["1k"]["jpg"]["url"]
            dest = folder / f"{ours}.jpg"
            if not dest.exists():
                dest.write_bytes(get(url))
            print(asset, ours, dest.stat().st_size // 1024, "KB")
        size = info.get("dimensions") or [2000, 2000]  # millimetres the texture covers
        (folder / "info.json").write_text(json.dumps({"metres": size[0] / 1000, "name": info["name"],
                                                     "authors": list(info.get("authors", {})),
                                                     "page": f"https://polyhaven.com/a/{asset}"}), encoding="utf-8")
        rows.append(f"| {info['name']} | {', '.join(info.get('authors', {}))} | https://polyhaven.com/a/{asset} | CC0 |")
    credits = ("# Texture credits\n\nPhoto-scanned materials used for the lodge (lodge.*.glb) and the walk's "
               "close-up ground (ground-*.webp), fetched and graded by pipeline/lodge_photos.py. All from Poly Haven "
               "under CC0 (public domain); credited anyway.\n\n"
               "| Material | Author | Source | Licence |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")
    for dest in (LIBRARY / "CREDITS.md", ASSETS / "walk" / "TEXTURE-CREDITS.md", SITE / "docs" / "texture-credits.md"):
        dest.write_text(credits, encoding="utf-8")


def have(asset: str) -> bool:
    return all((LIBRARY / asset / f"{m}.jpg").exists() for m in MAPS)


def graded(photo: Image.Image, target, contrast: float = 1.0) -> Image.Image:
    """The photo's own light and shade, moved to the target's mean colour."""
    a = np.asarray(photo.convert("RGB"), float)
    out = (a - a.reshape(-1, 3).mean(0)) * contrast + np.asarray(target, float)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def lodge_maps(generated: dict) -> dict:
    """{material: {"color", "normal", "rough": Image, "metres": float}} for every lodge material
    whose set is on this machine (the rest keep their generated texture)."""
    out = {}
    for name, (asset, px) in LODGE.items():
        if not have(asset) or name not in generated:
            continue
        folder = LIBRARY / asset
        target = np.asarray(generated[name].convert("RGB"), float).reshape(-1, 3).mean(0)
        def load(m):
            return Image.open(folder / f"{m}.jpg").resize((px, px), Image.LANCZOS)
        out[name] = {"color": graded(load("color"), target, CONTRAST.get(name, 1.0)), "normal": load("normal").convert("RGB"),
                     "rough": load("rough").convert("L"),
                     "metres": SCALE.get(name) or json.loads((folder / "info.json").read_text(encoding="utf-8"))["metres"]}
    return out


def build_ground() -> dict:
    """The close-up ground's textures for the walk: colour (graded to ground.ts's own colours)
    and normal for earth, grass and rock, as WebP under their hash."""
    walk = ASSETS / "walk"
    listed = {}
    for kind, asset in GROUND.items():
        if not have(asset):
            continue
        folder = LIBRARY / asset
        entry = {"metres": json.loads((folder / "info.json").read_text(encoding="utf-8"))["metres"]}
        for m in ("color", "normal"):
            px = 1024 if m == "color" else 512  # (the relief shows only near you, and normals compress badly)
            img = Image.open(folder / f"{m}.jpg").convert("RGB").resize((px, px), Image.LANCZOS)
            if m == "color":
                img = graded(img, GROUND_COLOUR[kind])
            buf = SITE / "pipeline" / ".build" / f"ground-{kind}-{m}.webp"
            buf.parent.mkdir(parents=True, exist_ok=True)
            img.save(buf, "WEBP", quality=78, method=6)
            data = buf.read_bytes()
            name = f"ground-{kind}-{m}.{hashlib.sha256(data).hexdigest()[:10]}.webp"
            for old in walk.glob(f"ground-{kind}-{m}.*.webp"):
                if old.name != name:
                    old.unlink()
            (walk / name).write_bytes(data)
            entry[m] = name
        listed[kind] = entry
    (SITE / "src" / "content" / "generated" / "ground-detail.json").write_text(json.dumps(listed, indent=1) + "\n", encoding="utf-8")
    return listed


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        fetch()
    elif sys.argv[1:] == ["ground"]:
        print(json.dumps(build_ground(), indent=1))
    else:
        raise SystemExit(__doc__)
