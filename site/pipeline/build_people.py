"""The valley's people for story mode (design §10.4, graphics phase 5): each character's body,
rigged, with the moves the scenes need, and their mouths' loudness for every voiced line.

Each body is built in Blender (blender/build_people.py) and given its clips from Quaternius's CC0
Universal Animation Library, which is made for the same skeleton. Until the MakeHuman (MPFB)
bodies are built, everyone is played by Quaternius's CC0 base characters at their own height:
`STANDIN` below. The character sheet is .downloads/graphics-people/characters.md.

Inputs:  site-assets/characters/ual/... (the free Standard pack from https://quaternius.itch.io/universal-animation-library, CC0)
         site-assets/characters/universal-base-characters-standard.zip (https://quaternius.itch.io/universal-base-characters, CC0)
         site-assets/story/voices/*.mp3 (pipeline/story_voices.py)
Output:  site-assets/walk/people-<who>.<hash>.glb, site-assets/walk/voice-mouths.<hash>.json,
         src/content/generated/people.json, and the credits in docs/model-credits.md and
         site-assets/walk/MODEL-CREDITS.md
Usage:   python build_people.py [--who professor,bhavi] [--mouths-only]
"""
import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path

from build_lodge import BLENDER
from common import ASSETS, SITE

CHARS = ASSETS / "characters"
UAL = CHARS / "ual" / "Universal Animation Library[Standard]" / "Unreal-Godot" / "UAL1_Standard.glb"
UBC = CHARS / "universal-base-characters-standard.zip"
UBC_BASE = "Universal Base Characters[Standard]/Base Characters/Godot - UE/"
VOICES = ASSETS / "story" / "voices"
BUILD = SITE / "pipeline" / ".build" / "people"
OUT = ASSETS / "walk"
GENERATED = SITE / "src" / "content" / "generated" / "people.json"

# The clips every body carries (the cast's poses and gestures, src/lib/story/cast.ts).
CLIPS = ["Idle_Loop", "Idle_Talking_Loop", "Walk_Loop", "Walk_Formal_Loop", "Sitting_Idle_Loop", "Sitting_Talking_Loop",
         "Sitting_Enter", "Sitting_Exit", "Crouch_Idle_Loop", "Fixing_Kneeling", "Interact", "PickUp_Table", "Jump_Land"]

# Who, how tall (characters.md), and which stand-in body plays them for now.
STANDIN = {
    "professor": ("male", 1.68), "bhavi": ("female", 1.62), "maharaj": ("male", 1.65), "mahant": ("male", 1.80),
    "baldev": ("male", 1.86), "vaidji": ("male", 1.63), "attendant": ("male", 1.68), "henchman": ("male", 1.72),
    "villager": ("male", 1.66),
}

def ffmpeg() -> str:
    """An ffmpeg that decodes mp3: $FFMPEG, or imageio-ffmpeg's (pip install imageio-ffmpeg)."""
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


CREDITS = [
    "| Universal Base Characters (Standard): Superhero Male | Quaternius | https://quaternius.com/packs/universalbasecharacters.html (https://quaternius.itch.io/universal-base-characters) | CC0 1.0 | Dvij's first-person arms (arms.*.glb), cut down and dressed by pipeline/build_arms.py; the story's people until their own bodies are built (people-*.glb) |",
    "| Universal Base Characters (Standard): Superhero Female | Quaternius | https://quaternius.itch.io/universal-base-characters | CC0 1.0 | Bhavi, until her own body is built (people-bhavi.*.glb, pipeline/build_people.py) |",
    "| Universal Animation Library (Standard) | Quaternius | https://quaternius.com/packs/universalanimationlibrary.html (https://quaternius.itch.io/universal-animation-library) | CC0 1.0 | The story's people's walks, idles, sitting, kneeling, crouching, reaching and picking up (people-*.glb, pipeline/build_people.py) |",
]
HEADER = "# Model credits\n\n| Model | Author | Source | Licence | Used for |\n|---|---|---|---|---|\n"


def standin_bodies() -> dict[str, Path]:
    BUILD.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(UBC) as z:
        for f in z.namelist():
            if f.startswith(UBC_BASE) and not f.endswith("/"):
                (BUILD / f.rsplit("/", 1)[1]).write_bytes(z.read(f))
    return {"male": BUILD / "Superhero_Male_FullBody.gltf", "female": BUILD / "Superhero_Female_FullBody.gltf"}


def build(who: str, body: Path, height: float) -> str:
    raw = BUILD / f"{who}.glb"
    spec = BUILD / f"{who}.json"
    spec.write_text(json.dumps({"body": str(body), "ual": str(UAL), "clips": CLIPS, "out": str(raw), "height": height}), encoding="utf-8")
    run = subprocess.run([str(BLENDER), "--background", "--factory-startup", "--python", str(SITE / "blender" / "build_people.py"), "--", str(spec)],
                         capture_output=True, text=True)
    if "PEOPLE OK" not in run.stdout:
        print(run.stdout[-4000:], run.stderr[-4000:])
        raise SystemExit(f"Blender did not build {who}")
    small = BUILD / f"{who}.small.glb"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "gltf-transform", "optimize", str(raw), str(small), "--compress", "meshopt",
                    "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false",
                    "--join", "false", "--flatten", "false", "--instance", "false", "--palette", "false", "--prune", "false"],
                   check=True, cwd=SITE, capture_output=True)
    return publish(f"people-{who}", ".glb", small.read_bytes())


def publish(stem: str, ext: str, data: bytes) -> str:
    name = f"{stem}.{hashlib.sha256(data).hexdigest()[:10]}{ext}"
    for old in OUT.glob(f"{stem}.*{ext}"):
        if old.name != name and old.name.count(".") == 2:
            old.unlink()
    (OUT / name).write_bytes(data)
    return name


def mouths() -> str:
    """Each voiced line's loudness, 25 times a second, as one digit (0 shut .. 9 wide): a mouth to follow."""
    import numpy as np

    out = {}
    for mp3 in sorted(VOICES.glob("*.mp3")):
        pcm = subprocess.run([ffmpeg(), "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                             capture_output=True, check=True).stdout
        x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        hop = 320  # 40 ms at 8 kHz
        n = len(x) // hop
        rms = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-9)
        db = 20 * np.log10(rms)
        top = np.percentile(db, 95)
        level = np.clip((db - (top - 30)) / 30, 0, 1)  # the loudest syllables wide, 30 dB down shut
        level[level < 0.15] = 0
        out[mp3.name] = "".join(str(int(round(v * 9))) for v in level)
    return publish("voice-mouths", ".json", json.dumps(out, separators=(",", ":")).encode())


def credit() -> None:
    for dest in (SITE / "docs" / "model-credits.md", OUT / "MODEL-CREDITS.md"):
        text = dest.read_text(encoding="utf-8") if dest.exists() else HEADER
        rows = [l for l in text.splitlines() if l.startswith("| ") and not l.startswith("| Model") and "Superhero Male" not in l]
        for r in CREDITS:
            if r not in rows:
                rows.append(r)
        rows.sort(key=lambda r: ("Superhero Male" not in r, r))
        dest.write_text(HEADER + "\n".join(rows) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--who", help="only these, comma separated")
    ap.add_argument("--mouths-only", action="store_true")
    args = ap.parse_args()
    for need in (UAL, UBC):
        if not need.exists():
            raise SystemExit(f"{need} is missing (see this script's docstring for where it comes from)")
    info = json.loads(GENERATED.read_text(encoding="utf-8")) if GENERATED.exists() else {"people": {}}
    if not args.mouths_only:
        bodies = standin_bodies()
        for who, (kind, height) in STANDIN.items():
            if args.who and who not in args.who.split(","):
                continue
            name = build(who, bodies[kind], height)
            info["people"][who] = {"file": name, "height": height, "body": f"standin-{kind}"}
            print(f"{who}: {name} ({(OUT / name).stat().st_size // 1024} KB)")
        info["people"]["default"] = info["people"].get("villager", info["people"].get("professor"))
    info["mouths"] = mouths()
    GENERATED.write_text(json.dumps(info, indent=1) + "\n", encoding="utf-8")
    credit()
    print(f"people.json: {len(info['people'])} people, mouths {info['mouths']}")


if __name__ == "__main__":
    main()
