"""Step 0.8: publish the allow-listed working images (design §4.7) and the
five parchment puzzle crops. Nothing else from images/ is ever copied.

Output: site-assets/art/  (WebP, plus art.json listing every file)
Usage: python prepare_art.py
"""
import json

from PIL import Image

from common import ASSETS, IMAGES_DIR

ARTIFACTS = IMAGES_DIR / "artifacts"

# source file -> published name. Additions here are deliberate publishing decisions.
ALLOW = {
    "map.jpg": "valley-map",
    "parchment.png": "parchment-lineart",
    "parchment - 1.png": "parchment",
    "vaastu mandala.jpg": "codex-vaastu-mandala",
    "tattvas.jpg": "codex-tattvas",
    "nakshatra.jpg": "codex-nakshatra",
    "gnomon.jpg": "codex-gnomon",
    "lakshmis symbol.jpg": "codex-lakshmi-symbol",
    "directions.jpg": "codex-directions",
    "hierarchy.jpg": "codex-hierarchy",
    "leaf.jpg": "codex-leaf",
}

# Puzzle boxes (x, y, w, h; 0-1) measured on "parchment - mapped.png", which
# overlays parchment.png. Box 5 touches the image edge and is estimated.
PUZZLE_BOXES = {
    1: (0.034, 0.016, 0.318, 0.311),
    2: (0.358, 0.044, 0.617, 0.295),
    3: (0.026, 0.343, 0.555, 0.335),
    4: (0.659, 0.421, 0.240, 0.198),
    5: (0.23, 0.68, 0.53, 0.31),
}


def save_webp(img: Image.Image, name: str, out_dir, quality: int = 88) -> dict:
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    path = out_dir / f"{name}.webp"
    img.save(path, "WEBP", quality=quality, method=6)
    return {"file": path.name, "w": img.width, "h": img.height}


def main() -> None:
    out_dir = ASSETS / "art"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for src, name in ALLOW.items():
        manifest[name] = save_webp(Image.open(ARTIFACTS / src), name, out_dir)

    line_art = Image.open(ARTIFACTS / "parchment.png").convert("RGB")
    W, H = line_art.size
    for n, (x, y, w, h) in PUZZLE_BOXES.items():
        box = (round(x * W), round(y * H), min(W, round((x + w) * W)), min(H, round((y + h) * H)))
        crop = line_art.crop(box)
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)  # small source; 2x for retina
        manifest[f"puzzle-{n}"] = save_webp(crop, f"puzzle-{n}", out_dir)

    (out_dir / "art.json").write_text(json.dumps(manifest, indent=1))
    print(f"{len(manifest)} files -> {out_dir}")
    for k, v in manifest.items():
        print(f"  {k:24s} {v['w']}x{v['h']}")


if __name__ == "__main__":
    main()
