"""Step 16.7: build the Professor's lodge as a 3D model (design §10.3).

1. Check the plan (src/content/valley/lodge.yaml, lodge_plan.problems).
2. Make its textures (lodge_textures.py), and the kitchen's god-print wall from
   the comic's own drawing of it (b4-p001 panel 2).
3. Run Blender headless on site/blender/build_lodge.py, which builds the house,
   its furniture, its grounds, a collision copy and the named points the game
   reads, renders it from the comic's own viewpoints, and exports a glTF.
4. Compress it (meshopt geometry, WebP textures at most 1024 px) and publish it
   under its hash.
5. Put each render beside the comic panel it answers, for review.

Inputs:  src/content/valley/lodge.yaml, site-assets/master/b4-p001.png, the comic panels
Output:  site-assets/walk/lodge.<hash>.glb, src/content/generated/lodge.json (committed),
         pipeline/reports/lodge-*.png and lodge-compare.png (for review)
Usage:   python build_lodge.py [--no-render]
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import lodge_plan
import lodge_textures
from common import ASSETS, REPORTS, SITE

BLENDER = Path(os.environ.get("BLENDER", r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"))
BUILD = SITE / "pipeline" / ".build" / "lodge"
OUT = ASSETS / "walk"
LODGE_JSON = SITE / "src" / "content" / "generated" / "lodge.json"
# Each render beside the panel it answers.
COMPARE = [("gate", "b1-p008-2"), ("aerial", "b3-p031-1"), ("courtyard", "b1-p004-7"),
           ("verandah", "b1-p012-2"), ("study", "b2-p027-9"), ("kitchen", "b1-p010-2")]
BUDGET_MB = 3.0


def gods_wall(dest: Path) -> None:
    """The kitchen's god-prints, cropped from the comic's own drawing of that wall."""
    page = Image.open(ASSETS / "master" / "b4-p001.png").convert("RGB")
    plan = json.loads(next((SITE / "src" / "content" / "manifests").glob("*4*.json")).read_text(encoding="utf-8"))
    box = next(p for p in plan["pages"] if p["id"] == "b4-p001")["panels"][1]["box"]
    w, h = page.size
    x0, y0, x1, y1 = box
    panel = page.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
    pw, ph = panel.size
    wall = panel.crop((round(pw * 0.45), 0, pw, round(ph * 0.62)))  # the prints, above the shelf
    wall.resize((512, 256)).save(dest)


def compare_sheet() -> None:
    panels = SITE / "docs" / "lodge" / "panels"
    rows = []
    for view, panel in COMPARE:
        r = REPORTS / f"lodge-{view}.png"
        p = panels / f"{panel}.jpg"
        if r.exists() and p.exists():
            rows.append((Image.open(p).convert("RGB"), Image.open(r).convert("RGB"), view, panel))
    if not rows:
        return
    W, Hh = 560, 315
    sheet = Image.new("RGB", (2 * W + 30, len(rows) * (Hh + 30) + 10), (250, 247, 240))
    d = ImageDraw.Draw(sheet)
    for i, (panel, render, view, pid) in enumerate(rows):
        y = 10 + i * (Hh + 30)
        for k, img in enumerate((panel, render)):
            img = img.copy()
            img.thumbnail((W, Hh))
            sheet.paste(img, (10 + k * (W + 10), y + 18))
        d.text((10, y), f"comic {pid}", fill=(60, 50, 40))
        d.text((20 + W, y), f"model: {view}", fill=(60, 50, 40))
    sheet.save(REPORTS / "lodge-compare.png")


def main() -> None:
    plan = lodge_plan.load()
    bad = lodge_plan.problems(plan)
    if bad:
        raise SystemExit("lodge.yaml has problems:\n  " + "\n  ".join(bad))
    if not BLENDER.exists():
        raise SystemExit(f"Blender not found at {BLENDER}; set BLENDER to its blender.exe")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    tex = BUILD / "textures"
    tex.mkdir(parents=True)
    for name, img in lodge_textures.all_textures().items():
        img.save(tex / f"{name}.png")
    gods_wall(tex / "gods.png")
    spec = BUILD / "lodge.json"
    spec.write_text(json.dumps(plan), encoding="utf-8")
    raw = BUILD / "lodge.glb"
    REPORTS.mkdir(parents=True, exist_ok=True)
    renders = "-" if "--no-render" in sys.argv else str(REPORTS)
    run = subprocess.run([str(BLENDER), "--background", "--factory-startup", "--python",
                          str(SITE / "blender" / "build_lodge.py"), "--", str(spec), str(tex), str(raw), renders],
                         capture_output=True, text=True)
    if "LODGE OK" not in run.stdout:
        print(run.stdout[-4000:], run.stderr[-4000:])
        raise SystemExit("Blender did not build the lodge")
    small = BUILD / "lodge.small.glb"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "gltf-transform", "optimize", str(raw), str(small), "--compress", "meshopt",
                    "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false",
                    "--join", "false", "--flatten", "false", "--instance", "false", "--palette", "false"],
                   check=True, cwd=SITE, capture_output=True)
    data = small.read_bytes()
    if len(data) > BUDGET_MB * 1024 * 1024:
        raise SystemExit(f"lodge.glb is {len(data) / 1024 / 1024:.1f} MB, over its {BUDGET_MB} MB budget")
    name = f"lodge.{hashlib.sha256(data).hexdigest()[:10]}.glb"
    for old in OUT.glob("lodge.*.glb"):
        if old.name != name:
            old.unlink()
    (OUT / name).write_bytes(data)
    markers = json.loads(Path(str(raw) + ".markers.json").read_text(encoding="utf-8"))
    LODGE_JSON.write_text(json.dumps({
        "version": 1, "file": name, "bytes": len(data),
        # in the model's own frame: metres, x east, y up, z south, origin at the courtyard's centre
        "half": plan["house"]["outer"] / 2, "floor": plan["house"]["plinth"],
        "grounds": plan["grounds"]["boundary"]["rect"],
        "markers": markers,
    }, indent=1) + "\n", encoding="utf-8")
    compare_sheet()
    print(f"Lodge {name} ({len(data) // 1024} KB, {len(raw.read_bytes()) // 1024} KB before compression); "
          f"review {REPORTS / 'lodge-compare.png'}")


if __name__ == "__main__":
    main()
