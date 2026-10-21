"""Dvij's first-person arms (design §10.4): Quaternius's CC0 Universal Base Characters, cut down to
the arms in Blender (blender/build_arms.py), in his gown's sleeves and his plaster cast.

Inputs:  site-assets/characters/universal-base-characters-standard.zip (git-ignored; the free
         Standard pack from https://quaternius.itch.io/universal-base-characters, CC0)
Output:  site-assets/walk/arms.<hash>.glb, src/content/generated/arms.json, and the model's
         credit in docs/model-credits.md and site-assets/walk/MODEL-CREDITS.md
Usage:   python build_arms.py
"""
import hashlib
import json
import os
import subprocess
import zipfile

from build_lodge import BLENDER
from common import ASSETS, SITE

PACK = ASSETS / "characters" / "universal-base-characters-standard.zip"
BASE = "Universal Base Characters[Standard]/Base Characters/Godot - UE/"
BUILD = SITE / "pipeline" / ".build" / "arms"
OUT = ASSETS / "walk"
CREDIT = """# Model credits

| Model | Author | Source | Licence | Used for |
|---|---|---|---|---|
| Universal Base Characters (Standard): Superhero Male | Quaternius | https://quaternius.com/packs/universalbasecharacters.html (https://quaternius.itch.io/universal-base-characters) | CC0 1.0 | Dvij's first-person arms (arms.*.glb), cut down and dressed by pipeline/build_arms.py |
"""


def main() -> None:
    if not PACK.exists():
        raise SystemExit(f"{PACK} is missing: download the free Standard pack from https://quaternius.itch.io/universal-base-characters")
    BUILD.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(PACK) as z:
        for f in z.namelist():
            if f.startswith(BASE) and ("Superhero_Male" in f or "T_Superhero_Male" in f):
                (BUILD / f.rsplit("/", 1)[1]).write_bytes(z.read(f))
    raw = BUILD / "arms.glb"
    run = subprocess.run([str(BLENDER), "--background", "--factory-startup", "--python", str(SITE / "blender" / "build_arms.py"),
                          "--", str(BUILD / "Superhero_Male_FullBody.gltf"), str(raw)], capture_output=True, text=True)
    if "ARMS OK" not in run.stdout:
        print(run.stdout[-4000:], run.stderr[-4000:])
        raise SystemExit("Blender did not build the arms")
    print(next(l for l in run.stdout.splitlines() if l.startswith("ARMS OK")))
    small = BUILD / "arms.small.glb"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "gltf-transform", "optimize", str(raw), str(small), "--compress", "meshopt",
                    "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false",
                    "--join", "false", "--flatten", "false", "--instance", "false", "--palette", "false", "--prune", "false"],
                   check=True, cwd=SITE, capture_output=True)
    data = small.read_bytes()
    name = f"arms.{hashlib.sha256(data).hexdigest()[:10]}.glb"
    for old in OUT.glob("arms.*.glb"):
        if old.name != name:
            old.unlink()
    (OUT / name).write_bytes(data)
    (SITE / "src" / "content" / "generated" / "arms.json").write_text(json.dumps({"file": name, "bytes": len(data)}, indent=1) + "\n", encoding="utf-8")
    for dest in (SITE / "docs" / "model-credits.md", OUT / "MODEL-CREDITS.md"):
        dest.write_text(CREDIT, encoding="utf-8")
    print(f"Arms {name} ({len(data) // 1024} KB)")


if __name__ == "__main__":
    main()
