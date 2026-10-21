"""Build the temple site as a 3D model (design §10.3): Mahant's pandaal, the fire altar and the
dug-over field, where Chapter 9 happens.

1. Check the plan (src/content/valley/temple-site.yaml): every piece has a source.
2. Make its textures (site_textures.py), and the verse that hangs in the tent from the comic's
   own lettering of it (b1-p014 panel 5).
3. Run Blender headless on site/blender/build_site.py, which builds it with a collision copy and
   the named points the game reads, renders it from the comic's own viewpoints, and exports a glTF.
4. Compress it (meshopt geometry, WebP textures) and publish it under its hash.
5. Put each render beside the comic panel it answers, for review.

Inputs:  src/content/valley/temple-site.yaml, site-assets/master/b1-p014.png
Output:  site-assets/walk/temple-site.<hash>.glb, src/content/generated/temple-site.json (committed),
         pipeline/reports/site-*.png and site-compare.png (for review)
Usage:   python build_site.py [--no-render]
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml
from PIL import Image, ImageDraw

import site_textures
from common import ASSETS, REPORTS, SITE

BLENDER = Path(os.environ.get("BLENDER", r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"))
PLAN = SITE / "src" / "content" / "valley" / "temple-site.yaml"
BUILD = SITE / "pipeline" / ".build" / "temple-site"
OUT = ASSETS / "walk"
SITE_JSON = SITE / "src" / "content" / "generated" / "temple-site.json"
COMPARE = [("field", "b1-p011-4"), ("inside", "b1-p014-1"), ("altar", "b1-p015-1"), ("plain", "b1-p015-10")]
SOURCE = re.compile(r"^(novel ¶\d+(-\d+)?|comic b\d-p\d{3}(-\d+)?|ours)$")
BUDGET_MB = 1.5


def problems(plan: dict) -> list[str]:
    out = []
    for group in ("where", "ground", "tent"):
        if not plan[group].get("sources"):
            out.append(f"{group}: no sources")
    for group in ("inside", "outside"):
        for it in plan[group]:
            srcs = it.get("sources") or []
            if not srcs:
                out.append(f"{group} {it['id']}: no sources")
            out += [f"{group} {it['id']}: source {s!r} is not novel ¶n, comic bN-pNNN-n or ours" for s in srcs if not SOURCE.match(s)]
    return out


def page_panel(page: str, n: int) -> Image.Image:
    img = Image.open(ASSETS / "master" / f"{page}.png").convert("RGB")
    book = json.loads((SITE / "src" / "content" / "manifests" / f"{page.split('-')[0]}.json").read_text(encoding="utf-8"))
    x0, y0, x1, y1 = next(p for p in book["pages"] if p["id"] == page)["panels"][n - 1]["box"]
    w, h = img.size
    return img.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))


def verse(dest: Path) -> None:
    """The Mahamrityunjaya verse as the comic letters it on the tent wall (b1-p014 panel 5)."""
    p = page_panel("b1-p014", 5)
    pw, ph = p.size
    p.crop((round(pw * 0.26), round(ph * 0.07), round(pw * 0.52), round(ph * 0.29))).resize((512, 320)).save(dest)


def compare_sheet() -> None:
    rows = []
    for view, ref in COMPARE:
        r = REPORTS / f"site-{view}.png"
        page, n = ref.rsplit("-", 1)
        if r.exists():
            rows.append((page_panel(page, int(n)), Image.open(r).convert("RGB"), view, ref))
    if not rows:
        return
    W, Hh = 560, 315
    sheet = Image.new("RGB", (2 * W + 30, len(rows) * (Hh + 30) + 10), (250, 247, 240))
    d = ImageDraw.Draw(sheet)
    for i, (panel, render, view, ref) in enumerate(rows):
        y = 10 + i * (Hh + 30)
        for k, img in enumerate((panel, render)):
            img = img.copy()
            img.thumbnail((W, Hh))
            sheet.paste(img, (10 + k * (W + 10), y + 18))
        d.text((10, y), f"comic {ref}", fill=(60, 50, 40))
        d.text((20 + W, y), f"model: {view}", fill=(60, 50, 40))
    sheet.save(REPORTS / "site-compare.png")


def main() -> None:
    plan = yaml.safe_load(PLAN.read_text(encoding="utf-8"))
    bad = problems(plan)
    if bad:
        raise SystemExit("temple-site.yaml has problems:\n  " + "\n  ".join(bad))
    if not BLENDER.exists():
        raise SystemExit(f"Blender not found at {BLENDER}; set BLENDER to its blender.exe")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    tex = BUILD / "textures"
    tex.mkdir(parents=True)
    for name, img in site_textures.all_textures().items():
        img.save(tex / f"{name}.png")
    verse(tex / "verse.png")
    spec = BUILD / "site.json"
    spec.write_text(json.dumps(plan), encoding="utf-8")
    raw = BUILD / "temple-site.glb"
    REPORTS.mkdir(parents=True, exist_ok=True)
    renders = "-" if "--no-render" in sys.argv else str(REPORTS)
    run = subprocess.run([str(BLENDER), "--background", "--factory-startup", "--python",
                          str(SITE / "blender" / "build_site.py"), "--", str(spec), str(tex), str(raw), renders],
                         capture_output=True, text=True)
    if "SITE OK" not in run.stdout:
        print(run.stdout[-4000:], run.stderr[-4000:])
        raise SystemExit("Blender did not build the temple site")
    small = BUILD / "temple-site.small.glb"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "gltf-transform", "optimize", str(raw), str(small), "--compress", "meshopt",
                    "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false",
                    "--join", "false", "--flatten", "false", "--instance", "false", "--palette", "false"],
                   check=True, cwd=SITE, capture_output=True)
    data = small.read_bytes()
    if len(data) > BUDGET_MB * 1024 * 1024:
        raise SystemExit(f"temple-site.glb is {len(data) / 1024 / 1024:.1f} MB, over its {BUDGET_MB} MB budget")
    name = f"temple-site.{hashlib.sha256(data).hexdigest()[:10]}.glb"
    for old in OUT.glob("temple-site.*.glb"):
        if old.name != name:
            old.unlink()
    (OUT / name).write_bytes(data)
    markers = json.loads(Path(str(raw) + ".markers.json").read_text(encoding="utf-8"))
    W, D = (v / 2 for v in plan["tent"]["size"])
    SITE_JSON.write_text(json.dumps({
        "version": 1, "file": name, "bytes": len(data),
        # in the model's own frame: metres, x east, y up, z south, origin at the middle of the tent's floor
        "where": plan["where"]["map"], "tent": [-W, -D, W, D], "grounds": plan["ground"]["pad"],
        "markers": markers,
    }, indent=1) + "\n", encoding="utf-8")
    compare_sheet()
    print(f"Temple site {name} ({len(data) // 1024} KB); review {REPORTS / 'site-compare.png'}")


if __name__ == "__main__":
    main()
