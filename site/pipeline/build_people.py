"""The valley's people for story mode (design §10.4, graphics phase 5): each character's body, face,
hair and clothes, rigged, with the moves the scenes need, and their mouths' loudness for every
voiced line.

Each person is made with MakeHuman's Blender add-on (MPFB) from the specs in PEOPLE below (the
character sheet is .downloads/graphics-people/characters.md; the author's answers, 21 Oct), dressed
in clothes cut from the body itself (blender/build_human.py), and given Quaternius's CC0 clips,
retargeted onto MakeHuman's skeleton.

Inputs:  site-assets/characters/mpfb/add-on-mpfb-v2.0.18.zip (https://extensions.blender.org/add-ons/mpfb/, GPL;
           what it makes is CC0)
         site-assets/characters/mh-system/makehuman_system_assets_cc0.zip
           (https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html, CC0)
         site-assets/characters/ual/... (https://quaternius.itch.io/universal-animation-library, CC0)
         site-assets/story/voices/*.mp3 (pipeline/story_voices.py)
Output:  site-assets/walk/people-<model>.<hash>.glb, site-assets/walk/voice-mouths.<hash>.json,
         src/content/generated/people.json, and the credits in docs/model-credits.md and
         site-assets/walk/MODEL-CREDITS.md
Usage:   python build_people.py [--who professor,bhavi] [--mouths-only]

Blender runs with a user folder of its own (pipeline/.build/blender-user) where MPFB is unpacked, so
the Blender on this machine is left as it was.
"""
import argparse
import hashlib
import json
import os
import subprocess
import zipfile

from build_lodge import BLENDER
from common import ASSETS, SITE

CHARS = ASSETS / "characters"
UAL = CHARS / "ual" / "Universal Animation Library[Standard]" / "Unreal-Godot" / "UAL1_Standard.glb"
MPFB_ZIP = CHARS / "mpfb" / "add-on-mpfb-v2.0.18.zip"
MH_ZIP = CHARS / "mh-system" / "makehuman_system_assets_cc0.zip"
MH = CHARS / "mh-system" / "data"
VOICES = ASSETS / "story" / "voices"
BUILD = SITE / "pipeline" / ".build" / "people"
BLENDER_USER = SITE / "pipeline" / ".build" / "blender-user"
MPFB_DIR = BLENDER_USER / "extensions" / "user_default" / "mpfb"
OUT = ASSETS / "walk"
GENERATED = SITE / "src" / "content" / "generated" / "people.json"

# The clips every body carries (the cast's poses and gestures, src/lib/story/cast.ts).
CLIPS = ["Idle_Loop", "Idle_Talking_Loop", "Walk_Loop", "Walk_Formal_Loop", "Sitting_Idle_Loop", "Sitting_Talking_Loop",
         "Sitting_Enter", "Sitting_Exit", "Crouch_Idle_Loop", "Fixing_Kneeling", "Interact", "PickUp_Table", "Jump_Land"]


def age(years: float) -> float:
    """MakeHuman's age slider: 0.5 is 25 years, 1.0 is 90."""
    return 0.5 + (years - 25) / 65 * 0.5 if years >= 25 else 0.1875 + (years - 1) / 24 * 0.3125


def south_asian(african: float = 0.3, asian: float = 0.1) -> dict:
    return {"african": african, "asian": asian, "caucasian": 1 - african - asian}


WHITE, CREAM, BLACK_HAIR = [0.94, 0.93, 0.89], [0.9, 0.86, 0.76], [0.045, 0.038, 0.032]
# Each person: their body (MakeHuman's sliders), face, skin, hair and what they wear. Colours as written (sRGB).
PEOPLE = {
    # Dr Vidyasagar Parthasarathi, 60s-70s (¶133, ¶136; breakdowns ch2, ch3; comic b1-p006-7, b1-p007-2, b1-p012-4)
    "professor": dict(
        height=1.68, macro=dict(gender=1.0, age=age(68), muscle=0.45, weight=0.3, height=0.45, race=south_asian(0.25, 0.15)),
        targets={"nose/nose-scale-horiz-incr": 0.5, "nose/nose-scale-vert-incr": 0.5, "nose/nose-point-width-incr": 0.3, "ears/l-ear-scale-incr": 0.8, "ears/r-ear-scale-incr": 0.8, "eyebrows/eyebrows-trans-down": 0.5, "eyes/l-eye-scale-incr": 0.55, "eyes/r-eye-scale-incr": 0.55, "mouth/mouth-angles-up": 0.6, "forehead/forehead-scale-vert-incr": 0.3}, face=dict(smile=0.25),
        skin=dict(texture="old_caucasian_male", tone=[0.66, 0.48, 0.36]), hair="short02", hair_color=[0.87, 0.86, 0.83],
        brow_color=[0.84, 0.82, 0.78], eyebrows="eyebrow010",
        garments=[dict(kind="top", name="shirt", color=[0.8, 0.74, 0.58], sleeve=0.55, loose=0.16, smooth=24),
                  dict(kind="legs", name="shorts", color=[0.68, 0.6, 0.43]),
                  dict(kind="socks", name="socks", color=[0.9, 0.89, 0.85]),
                  dict(kind="sole", name="shoes", color=[0.32, 0.19, 0.1]),
                  dict(kind="moustache", name="moustache", color=[0.88, 0.87, 0.84]),
                  dict(kind="spectacles", name="spectacles", color=[0.22, 0.17, 0.12]),
                  dict(kind="ear-hair", name="ear-hair", color=[0.9, 0.89, 0.86])]),
    # Bhavi in her rustling morning gown, Ch7-8 (¶249; comic b1-p012-2, b1-p013-1): long, mostly straight hair (the author, 21 Oct)
    "bhavi": dict(
        height=1.62, macro=dict(gender=0.0, age=age(25), muscle=0.45, weight=0.42, height=0.42, proportions=0.65, race=south_asian(0.2, 0.15)),
        targets={"eyes/l-eye-scale-incr": 0.45, "eyes/r-eye-scale-incr": 0.45, "chin/chin-width-decr": 0.5, "head/head-oval": 0.5, "nose/nose-scale-horiz-decr": 0.25, "mouth/mouth-lowerlip-volume-incr": 0.3, "mouth/mouth-upperlip-volume-incr": 0.2, "eyebrows/eyebrows-angle-up": 0.2}, face=dict(smile=0.12),
        skin=dict(texture="young_caucasian_female", tone=[0.76, 0.56, 0.43]), hair="long01", hair_color=BLACK_HAIR, hair_length=1.9,
        eyebrows="eyebrow006", eyelashes="eyelashes02",
        garments=[dict(kind="top", name="gown", color=[0.95, 0.86, 0.86], print="floral", ink=[0.86, 0.38, 0.46], sleeve=2.0, loose=0.1, **{"from": 0.9}),
                  dict(kind="skirt", name="gown-skirt", color=[0.95, 0.86, 0.86], print="floral", ink=[0.86, 0.38, 0.46], flare=0.07, pleats=0.008),
                  dict(kind="waistband", name="sash", color=[0.7, 0.3, 0.36], width=0.05)]),
    # Bhavi on the well, Ch4: the comic's white kurta with red flowers and a rust salwar, barefoot (the author, 21 Oct; ¶187; b1-p008-4)
    "bhavi-kurta": dict(
        base="bhavi",
        garments=[dict(kind="top", name="kurta", color=[0.96, 0.94, 0.9], print="floral", ink=[0.8, 0.16, 0.12], sleeve=0.5, loose=0.06, **{"from": 0.9}),
                  dict(kind="skirt", name="kurta-skirt", color=[0.96, 0.94, 0.9], print="floral", ink=[0.8, 0.16, 0.12], to=0.62, flare=0.04),
                  dict(kind="trousers", name="salwar", color=[0.74, 0.36, 0.16], offset=0.016, pleats=0.006, flare=0.02)]),
    # Maharaj, the stout cook (¶196, ¶203, ¶223; comic b1-p010-2, b1-p012-4): a white turban throughout (the author, 21 Oct)
    "maharaj": dict(
        height=1.65, macro=dict(gender=1.0, age=age(45), muscle=0.4, weight=0.86, height=0.38, race=south_asian(0.35, 0.15)),
        targets={"head/head-round": 0.7, "cheek/l-cheek-volume-incr": 0.5, "cheek/r-cheek-volume-incr": 0.5, "neck/neck-double-incr": 0.4, "eyes/l-eye-scale-decr": 0.2, "eyes/r-eye-scale-decr": 0.2, "mouth/mouth-angles-up": 0.3, "nose/nose-scale-horiz-incr": 0.3}, face=dict(smile=0.15),
        skin=dict(texture="middleage_caucasian_male", tone=[0.56, 0.39, 0.27]), eyebrows="eyebrow001", brow_color=[0.06, 0.05, 0.04],
        garments=[dict(kind="top", name="kurta", color=CREAM, sleeve=0.45, loose=0.1, **{"from": 0.8}),
                  dict(kind="skirt", name="kurta-skirt", color=CREAM, to=0.66, flare=0.03),
                  dict(kind="trousers", name="pyjama", color=WHITE, pleats=0.004),
                  dict(kind="waistband", name="gamchha", color=[0.86, 0.83, 0.78], print="checks", ink=[0.74, 0.12, 0.1], width=0.07),
                  dict(kind="turban", name="turban", color=WHITE),
                  dict(kind="moustache", name="moustache", size=1.6, color=[0.05, 0.04, 0.035])]),
    # Mahapandit Sampoornand Swami: lean, sinewy, long fingers, shaved but for a tied tuft, an ash tilak, the janeyu, white
    # cloth over the torso with a shawl and rudraksha beads (¶104, ¶106, ¶298; b1-p014-2; the author, 21 Oct)
    "mahant": dict(
        height=1.80, macro=dict(gender=1.0, age=age(55), muscle=0.55, weight=0.25, height=0.62, proportions=0.4, race=south_asian(0.3, 0.1)),
        targets={"head/head-scale-horiz-decr": 0.35, "cheek/l-cheek-inner-decr": 0.6, "cheek/r-cheek-inner-decr": 0.6, "cheek/l-cheek-bones-incr": 0.5, "cheek/r-cheek-bones-incr": 0.5, "nose/nose-hump-incr": 0.7, "nose/nose-point-down": 0.4, "nose/nose-scale-vert-incr": 0.3, "eyebrows/eyebrows-angle-up": 0.5, "eyes/l-eye-height2-decr": 0.35, "eyes/r-eye-height2-decr": 0.35, "mouth/mouth-scale-horiz-decr": 0.2, "chin/chin-prominent-incr": 0.3, "hands/l-hand-fingers-length-incr": 0.8, "hands/r-hand-fingers-length-incr": 0.8}, face=dict(smile=0.12),
        skin=dict(texture="middleage_caucasian_male", tone=[0.62, 0.43, 0.28]), eyebrows="eyebrow003", brow_color=[0.08, 0.06, 0.05],
        teeth=[0.58, 0.16, 0.12],  # red with paan (¶298, breakdown ch9)
        garments=[dict(kind="top", name="wrap", color=[0.9, 0.89, 0.85], neckline=0.035, loose=0.05, **{"from": 0.95}),
                  dict(kind="skirt", name="dhoti", color=WHITE, to=0.12, flare=0.05, pleats=0.01),  # (worn long, as a veshti: comic b1-p014-5)
                  dict(kind="band", name="shawl", color=[0.98, 0.97, 0.95], print="border", ink=[0.78, 0.62, 0.3], over="l", width=0.2, offset=0.034),
                  dict(kind="band", name="janeyu", color=[0.95, 0.88, 0.7], over="l", width=0.022, offset=0.032),
                  dict(kind="beads", name="beads", color=[0.36, 0.2, 0.12], drop=0.16),
                  dict(kind="choti", name="choti", color=[0.05, 0.04, 0.035]),
                  dict(kind="tilak", name="tilak", color=WHITE),
                  dict(kind="clogs", name="khadau", color=[0.5, 0.33, 0.18])]),
    # Baldev Singh, the mukhiya's eldest son: large, coarse, a moustache, a cream shirt and a maroon lungi, leather chappals,
    # chewing tobacco (¶104, ¶108, ¶296; b1-p005-4, b1-p014-5)
    "baldev": dict(
        height=1.86, macro=dict(gender=1.0, age=age(35), muscle=0.75, weight=0.8, height=0.75, race=south_asian(0.45, 0.1)),
        targets={"head/head-square": 0.6, "chin/chin-width-incr": 0.6, "chin/chin-prominent-incr": 0.3, "nose/nose-flaring-incr": 0.5, "nose/nose-scale-horiz-incr": 0.3, "eyebrows/eyebrows-trans-down": 0.4, "mouth/mouth-lowerlip-volume-incr": 0.4, "neck/measure-neck-circ-incr": 0.6}, face=dict(frown=0.35),
        skin=dict(texture="young_african_male", tone=[0.46, 0.31, 0.21]), hair="short04", hair_color=BLACK_HAIR, eyebrows="eyebrow002",
        brow_color=[0.04, 0.035, 0.03],
        # (the shirt worn into the lungi, the sash over the join: b1-p014-5)
        garments=[dict(kind="top", name="shirt", color=[0.88, 0.82, 0.68], sleeve=0.6, loose=0.1, tucked=True, **{"from": "waist-0.02"}),
                  dict(kind="skirt", name="lungi", color=[0.5, 0.1, 0.1], to=0.28, flare=0.035, top="waist+0.07", offset=0.032),
                  dict(kind="waistband", name="sash", color=[0.72, 0.13, 0.1], width=0.09, offset=0.03),
                  dict(kind="sole", name="chappals", color=[0.36, 0.21, 0.11]),
                  dict(kind="moustache", name="moustache", size=1.6, color=[0.04, 0.035, 0.03])]),
    # Vaid Shwet: unusually pale, ruddy, overblown, almost bald from the front, a striped shawl (¶127, ¶296; b1-p006-7, b1-p014-5)
    "vaidji": dict(
        height=1.63, macro=dict(gender=1.0, age=age(55), muscle=0.15, weight=1.0, height=0.35, race=south_asian(0.05, 0.1)),
        targets={"head/head-round": 0.7, "neck/neck-double-incr": 1.0, "cheek/l-cheek-volume-incr": 0.7, "cheek/r-cheek-volume-incr": 0.7, "ears/l-ear-scale-incr": 0.4, "ears/r-ear-scale-incr": 0.4, "eyes/l-eye-scale-decr": 0.1, "eyes/r-eye-scale-decr": 0.1, "mouth/mouth-scale-horiz-decr": 0.2}, face=dict(brows=0.35),
        skin=dict(texture="middleage_caucasian_male", tone=[0.86, 0.64, 0.56]), eyebrows="eyebrow004", brow_color=[0.6, 0.58, 0.55],
        blush=dict(color=[0.85, 0.35, 0.32], cheeks=0.55, feet=0.4),
        garments=[dict(kind="top", name="kurta", color=[0.92, 0.89, 0.8], sleeve=1.7, loose=0.12, **{"from": 0.75}),
                  dict(kind="skirt", name="kurta-skirt", color=[0.92, 0.89, 0.8], to=0.6, flare=0.03),
                  dict(kind="trousers", name="pyjama", color=WHITE, pleats=0.004),
                  dict(kind="stole", name="shawl", color=[0.9, 0.86, 0.76], print="stripes", ink=[0.55, 0.12, 0.12]),
                  dict(kind="fringe", name="fringe", color=[0.74, 0.73, 0.7])]),
    # Mahant's obsequious attendant (¶225, ¶246, ¶295; b1-p011-5): thin, a moustache, a short kurta, a dhoti, a red sash
    "attendant": dict(
        height=1.68, macro=dict(gender=1.0, age=age(35), muscle=0.45, weight=0.28, height=0.45, race=south_asian(0.4, 0.15)),
        skin=dict(texture="young_african_male", tone=[0.5, 0.34, 0.24]), hair="short01", hair_color=BLACK_HAIR, eyebrows="eyebrow002",
        garments=[dict(kind="top", name="kurta", color=WHITE, sleeve=0.4, loose=0.06, **{"from": 0.85}),
                  dict(kind="dhoti", name="dhoti", color=WHITE, to=0.2, flare=0.045),
                  dict(kind="waistband", name="sash", color=[0.74, 0.14, 0.1], width=0.06),
                  dict(kind="moustache", name="moustache", color=[0.04, 0.035, 0.03])]),
    # The henchman who brings the summons to the lodge (¶288, ¶293): not the attendant (the author, 21 Oct)
    "henchman": dict(
        height=1.72, macro=dict(gender=1.0, age=age(35), muscle=0.65, weight=0.55, height=0.55, race=south_asian(0.4, 0.1)),
        skin=dict(texture="young_african_male", tone=[0.48, 0.32, 0.22]), hair="short03", hair_color=BLACK_HAIR,
        garments=[dict(kind="top", name="kurta", color=[0.84, 0.5, 0.2], sleeve=0.6, loose=0.08, **{"from": 0.85}),
                  dict(kind="skirt", name="kurta-skirt", color=[0.84, 0.5, 0.2], to=0.72, flare=0.04, offset=0.03),
                  dict(kind="dhoti", name="dhoti", color=WHITE, to=0.16, flare=0.045),
                  dict(kind="sole", name="chappals", color=[0.36, 0.21, 0.11]),
                  dict(kind="moustache", name="moustache", color=[0.04, 0.035, 0.03])]),
    # Dvij himself, seen only in the study window's glass (¶101; the author, 21 Oct): mid-20s, a full beard grown in the coma,
    # a heavily bandaged head, an oversize borrowed gown, a pyjama too tight on the calves, the right arm in plaster (¶96, ¶98)
    "dvij": dict(
        height=1.76, macro=dict(gender=1.0, age=age(26), muscle=0.55, weight=0.42, height=0.58, race=south_asian(0.3, 0.1)),
        skin=dict(texture="young_caucasian_male", tone=[0.62, 0.44, 0.31]), eyebrows="eyebrow002", brow_color=[0.04, 0.035, 0.03],
        garments=[dict(kind="top", name="gown", color=[0.66, 0.63, 0.55], sleeve=1.25, loose=0.18, **{"from": 0.75}),
                  dict(kind="skirt", name="gown-skirt", color=[0.66, 0.63, 0.55], to=0.55, flare=0.05),
                  dict(kind="trousers", name="pyjama", color=[0.78, 0.8, 0.84], pleats=0.003),
                  dict(kind="cast", name="plaster", color=[0.8, 0.77, 0.7]),
                  dict(kind="bandage", name="bandage", color=[0.95, 0.94, 0.9]),
                  dict(kind="beard", name="beard", color=[0.05, 0.04, 0.035]),
                  dict(kind="moustache", name="moustache", color=[0.05, 0.04, 0.035])]),
    # The villagers at the altar: thin men in white, caps and turbans (b1-p015-1; no women: the author, 21 Oct); seen from afar
    "villager-a": dict(
        lod=0.18, height=1.64, macro=dict(gender=1.0, age=age(45), muscle=0.5, weight=0.2, height=0.4, race=south_asian(0.45, 0.1)),
        skin=dict(texture="middleage_african_male", tone=[0.46, 0.31, 0.21]),
        garments=[dict(kind="top", name="banian", color=WHITE, sleeve=0.0, **{"from": 0.9}),
                  dict(kind="dhoti", name="dhoti", color=WHITE, to=0.25, flare=0.045),
                  dict(kind="cap", name="cap", color=WHITE),
                  dict(kind="moustache", name="moustache", color=[0.05, 0.04, 0.035])]),
    "villager-b": dict(
        lod=0.18, height=1.69, macro=dict(gender=1.0, age=age(60), muscle=0.4, weight=0.3, height=0.48, race=south_asian(0.4, 0.15)),
        skin=dict(texture="old_african_male", tone=[0.5, 0.34, 0.23]),
        garments=[dict(kind="top", name="kurta", color=[0.9, 0.88, 0.82], sleeve=0.6, **{"from": 0.85}),
                  dict(kind="dhoti", name="dhoti", color=WHITE, to=0.2, flare=0.045),
                  dict(kind="turban", name="turban", color=[0.93, 0.92, 0.88]),
                  dict(kind="moustache", name="moustache", color=[0.75, 0.74, 0.7])]),
    "villager-c": dict(
        lod=0.18, height=1.62, macro=dict(gender=1.0, age=age(30), muscle=0.55, weight=0.22, height=0.36, race=south_asian(0.5, 0.1)),
        skin=dict(texture="young_african_male", tone=[0.44, 0.29, 0.2]), hair="short01", hair_color=BLACK_HAIR,
        garments=[dict(kind="dhoti", name="dhoti", color=WHITE, to=0.3, flare=0.045),
                  dict(kind="band", name="gamchha", color=[0.9, 0.86, 0.78], print="checks", ink=[0.7, 0.14, 0.12], over="r", width=0.1)]),
}


def blender_with_mpfb() -> dict:
    """Blender's environment, with a user folder of its own where MPFB is unpacked (from the zip, once)."""
    if not (MPFB_DIR / "blender_manifest.toml").exists():
        MPFB_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(MPFB_ZIP) as z:
            z.extractall(MPFB_DIR)
    if not MH.exists():
        with zipfile.ZipFile(MH_ZIP) as z:
            z.extractall(MH)
    return {**os.environ, "BLENDER_USER_RESOURCES": str(BLENDER_USER)}


def spec_of(model: str) -> dict:
    p = dict(PEOPLE[model])
    if "base" in p:
        p = {**PEOPLE[p.pop("base")], **p}
    return p


def build(model: str, env: dict) -> str:
    raw = BUILD / f"{model}.glb"
    spec = BUILD / f"{model}.json"
    BUILD.mkdir(parents=True, exist_ok=True)
    spec.write_text(json.dumps({**spec_of(model), "who": model, "out": str(raw), "ual": str(UAL), "clips": CLIPS,
                                "mpfb_data": str(MPFB_DIR / "data"), "mh": str(MH)}), encoding="utf-8")
    run = subprocess.run([str(BLENDER), "--background", "--factory-startup", "--python", str(SITE / "blender" / "build_human.py"), "--", str(spec)],
                         capture_output=True, text=True, env=env)
    for line in run.stdout.splitlines():
        if line.startswith("PEOPLE WARNING"):
            print(line)
    if "PEOPLE OK" not in run.stdout:
        print(run.stdout[-4000:], run.stderr[-4000:])
        raise SystemExit(f"Blender did not build {model}")
    print(next(l for l in run.stdout.splitlines() if l.startswith("PEOPLE OK")))
    small = BUILD / f"{model}.small.glb"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "gltf-transform", "optimize", str(raw), str(small), "--compress", "meshopt",
                    "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false",
                    "--join", "false", "--flatten", "false", "--instance", "false", "--palette", "false", "--prune", "false"],
                   check=True, cwd=SITE, capture_output=True)
    return publish(f"people-{model}", ".glb", small.read_bytes())


def publish(stem: str, ext: str, data: bytes) -> str:
    name = f"{stem}.{hashlib.sha256(data).hexdigest()[:10]}{ext}"
    for old in OUT.glob(f"{stem}.*{ext}"):
        if old.name != name and old.name.count(".") == 2:
            old.unlink()
    (OUT / name).write_bytes(data)
    return name


def ffmpeg() -> str:
    """An ffmpeg that decodes mp3: $FFMPEG, or imageio-ffmpeg's (pip install imageio-ffmpeg)."""
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


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
        # how bright each moment sounds: its spectrum's centre (ee and ay bright, oo and oh dark), for the lips' shape
        frames = x[: n * hop].reshape(n, hop) * np.hanning(hop)
        spec = np.abs(np.fft.rfft(frames, axis=1))
        freqs = np.fft.rfftfreq(hop, 1 / 8000)
        centre = (spec * freqs).sum(axis=1) / (spec.sum(axis=1) + 1e-9)
        bright = np.clip((centre - 700) / 1300, 0, 1)
        bright = np.convolve(bright, np.ones(3) / 3, mode="same")  # (a mouth moves slower than a spectrum)
        out[mp3.name] = "".join(str(int(round(v * 9))) for v in level) + "|" + "".join(str(int(round(v * 9))) for v in bright)
    return publish("voice-mouths", ".json", json.dumps(out, separators=(",", ":")).encode())


CREDITS = [
    "| Universal Base Characters (Standard): Superhero Male | Quaternius | https://quaternius.com/packs/universalbasecharacters.html (https://quaternius.itch.io/universal-base-characters) | CC0 1.0 | Dvij's first-person arms (arms.*.glb), cut down and dressed by pipeline/build_arms.py |",
    "| MakeHuman base mesh, targets and rig, through MPFB 2.0.18 | The MakeHuman team (Joel Palmius et al.) | https://static.makehumancommunity.org/mpfb.html (https://extensions.blender.org/add-ons/mpfb/) | CC0 1.0 (what MPFB makes; the add-on itself is GPL and is not shipped) | The story's people's bodies, faces and skeletons (people-*.glb, pipeline/build_people.py) |",
    "| MakeHuman system assets: skins, eyes, eyebrows, eyelashes, hair | The MakeHuman team | https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html | CC0 1.0 | The story's people's skin textures (re-toned), eyes, brows, lashes and hair (people-*.glb) |",
    "| Universal Animation Library (Standard) | Quaternius | https://quaternius.com/packs/universalanimationlibrary.html (https://quaternius.itch.io/universal-animation-library) | CC0 1.0 | The story's people's walks, idles, sitting, kneeling, crouching, reaching and picking up, retargeted onto MakeHuman's skeleton (people-*.glb) |",
]
HEADER = "# Model credits\n\n| Model | Author | Source | Licence | Used for |\n|---|---|---|---|---|\n"


def credit() -> None:
    """The credits for every model (the arms' row too: pipeline/build_arms.py calls this)."""
    for dest in (SITE / "docs" / "model-credits.md", OUT / "MODEL-CREDITS.md"):
        dest.write_text(HEADER + "\n".join(CREDITS) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--who", help="only these models, comma separated")
    ap.add_argument("--mouths-only", action="store_true")
    args = ap.parse_args()
    for need in (UAL, MPFB_ZIP, MH_ZIP):
        if not need.exists():
            raise SystemExit(f"{need} is missing (see this script's docstring for where it comes from)")
    info = json.loads(GENERATED.read_text(encoding="utf-8")) if GENERATED.exists() else {"people": {}}
    if not args.mouths_only:
        env = blender_with_mpfb()
        for model in PEOPLE:
            if args.who and model not in args.who.split(","):
                continue
            name = build(model, env)
            info["people"][model] = {"file": name, "height": spec_of(model)["height"], **({"face": spec_of(model)["face"]} if spec_of(model).get("face") else {})}
            print(f"{model}: {name} ({(OUT / name).stat().st_size // 1024} KB)")
        # (the old stand-ins, and anyone no longer in PEOPLE)
        info["people"] = {k: v for k, v in info["people"].items() if k in PEOPLE}
        for old in OUT.glob("people-*.glb"):
            if old.name not in {v["file"] for v in info["people"].values()}:
                old.unlink()
    info["mouths"] = mouths()
    GENERATED.write_text(json.dumps(info, indent=1) + "\n", encoding="utf-8")
    credit()
    print(f"people.json: {len(info['people'])} people, mouths {info['mouths']}")


if __name__ == "__main__":
    main()
