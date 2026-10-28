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
         site-assets/characters/rhubarb/Rhubarb-Lip-Sync-1.14.0-Windows/ (https://github.com/DanielSWolf/rhubarb-lip-sync/
           releases, MIT; optional: without it the mouths follow the voices' loudness and brightness only)
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
# Dvij's brows as cards (the lifelike pilot): strong and dark (b1-p013-19)
DVIJ_BROWS = dict(kind="hair-cards", name="brows", style="brows", color=[0.04, 0.035, 0.03], root=[0.03, 0.025, 0.02], tip=[0.07, 0.055, 0.045],
                  arch=0.003, length=0.012, width=0.0065, count=30, strands=16)
# Each person: their body (MakeHuman's sliders), face, skin, hair and what they wear. Colours as written (sRGB).
PEOPLE = {
    # Dr Vidyasagar Parthasarathi, 60s-70s (¶133, ¶136; breakdowns ch2, ch3; comic b1-p006-7, b1-p007-2, b1-p012-4)
    "professor": dict(
        height=1.68, macro=dict(gender=1.0, age=age(68), muscle=0.45, weight=0.3, height=0.45, race=south_asian(0.25, 0.15)),
        targets={"nose/nose-scale-horiz-incr": 0.5, "nose/nose-scale-vert-incr": 0.5, "nose/nose-point-width-incr": 0.3, "ears/l-ear-scale-incr": 0.8, "ears/r-ear-scale-incr": 0.8, "eyebrows/eyebrows-trans-down": 0.5, "eyes/l-eye-scale-incr": 0.55, "eyes/r-eye-scale-incr": 0.55, "mouth/mouth-angles-up": 0.6, "forehead/forehead-scale-vert-incr": 0.3,
                 # the lifelike pilot's refit to his panels (b1-p005-9, b1-p007-2, b1-p012-6, b1-p013-1): a longer, leaner face, the
                 # chin longer, the cheekbones showing over hollower cheeks, the head narrower (his outline was the worst region)
                 "head/head-oval": 0.45, "head/head-scale-horiz-decr": 0.2, "head/head-fat-decr": 0.25, "chin/chin-height-incr": 0.4,
                 "cheek/l-cheek-bones-incr": 0.4, "cheek/r-cheek-bones-incr": 0.4, "cheek/l-cheek-volume-decr": 0.35, "cheek/r-cheek-volume-decr": 0.35}, face=dict(smile=0.25),
        skin=dict(texture="old_caucasian_male", tone=[0.66, 0.48, 0.36]), hair_color=[0.87, 0.86, 0.83],
        brow_color=[0.84, 0.82, 0.78], eyebrows="eyebrow010", detail=dict(age=1.5, pores=0.7),
        # the lifelike pilot: skin zones (ruddy nose and ears, the eyes' darker skin, a shaven old man's faint shadow),
        # and his hair, moustache and brows as cards (blender/lifelike.py)
        zones=dict(nose=0.5, cheeks=0.4, ears=0.6, eyes=0.55, beard=0.2), brow_cards=True,
        garments=[dict(kind="top", name="shirt", color=[0.8, 0.74, 0.58], sleeve=0.55, loose=0.16, smooth=24, tucked=True, **{"from": "waist-0.005"}),
                  dict(kind="shirt-front", name="shirt-front", color=[0.78, 0.72, 0.56]),
                  dict(kind="legs", name="shorts", color=[0.68, 0.6, 0.43], top="waist+0.035", offset=0.022, smooth=12),
                  dict(kind="waistband", name="belt", color=[0.3, 0.18, 0.1], at="waist+0.015", width=0.036, offset=0.042, buckle=[0.7, 0.6, 0.35]),
                  dict(kind="watch", name="watch", side="l", color=[0.86, 0.83, 0.72]),
                  dict(kind="socks", name="socks", color=[0.9, 0.89, 0.85]),
                  dict(kind="sole", name="shoes", color=[0.32, 0.19, 0.1]),
                  dict(kind="stubble", name="scalp", color=[0.52, 0.45, 0.39]),  # (hair round: skin-grey, not a white band under the curls)
                  dict(kind="curls", name="mane", color=[0.5, 0.49, 0.47], depth=0.024, knots=False),  # (the mass under the cards)
                  # loose grey curls standing off the head, fullest over the ears and behind, whiter at the ears (b1-p012-6, b1-p013-1)
                  dict(kind="hair-cards", name="curls", style="curly", color=[0.78, 0.77, 0.74], root=[0.42, 0.41, 0.39], tip=[0.9, 0.89, 0.86],
                       volume=0.036, length=0.06, curl=0.0075, turns=2.0, width=0.0065, gap=0.0048, wave=0.25, strands=14, light=0.05,
                       band=True, points=13, fill=0.3, thick=[6, 12], root_fade=0.12),  # (hair round: narrow bands wound round each curl, longer and finer, not flakes)
                  # the white moustache, drooping over the lip and a little uneven (b1-p012-6, b1-p012-23)
                  # (refit: smaller and greyer, as his panels draw it, not a white block)
                  dict(kind="hair-cards", name="moustache", style="moustache", color=[0.74, 0.73, 0.7], root=[0.48, 0.47, 0.45], tip=[0.86, 0.85, 0.82],
                       size=1.1, count=56, strands=30, width=0.008),
                  dict(kind="hair-cards", name="brows", style="brows", color=[0.82, 0.8, 0.76], root=[0.6, 0.58, 0.55], tip=[0.9, 0.89, 0.86],
                       arch=0.002, length=0.014, width=0.0065, count=30, strands=16),
                  dict(kind="spectacles", name="spectacles", color=[0.22, 0.17, 0.12]),
                  dict(kind="ear-hair", name="ear-hair", color=[0.9, 0.89, 0.86])]),
    # Bhavi in her rustling morning gown, Ch7-8 (¶249; comic b1-p012-2, b1-p013-1): long, mostly straight hair (the author, 21 Oct)
    "bhavi": dict(
        # the lifelike pilot (5b), refit to her panels (b1-p008-4, b1-p012-28, b1-p013-9): eyes larger and almond, the outer
        # corners lifted; a narrower jaw and small chin; cheekbones up; a slimmer bridge and finer tip; fuller lips with a
        # defined bow; a longer neck; lithe
        height=1.62, macro=dict(gender=0.0, age=age(25), muscle=0.45, weight=0.36, height=0.42, proportions=0.8, race=south_asian(0.2, 0.15)),
        targets={"eyes/l-eye-scale-incr": 0.75, "eyes/r-eye-scale-incr": 0.75, "eyes/l-eye-corner2-up": 0.4, "eyes/r-eye-corner2-up": 0.4,
                 "eyes/l-eye-height2-incr": 0.2, "eyes/r-eye-height2-incr": 0.2,
                 "chin/chin-width-decr": 0.8, "chin/chin-triangle": 0.35, "head/head-oval": 0.7, "head/head-invertedtriangular": 0.25,
                 "cheek/l-cheek-bones-incr": 0.5, "cheek/r-cheek-bones-incr": 0.5, "cheek/l-cheek-trans-up": 0.3, "cheek/r-cheek-trans-up": 0.3,
                 "nose/nose-scale-horiz-decr": 0.4, "nose/nose-width1-decr": 0.5, "nose/nose-point-width-decr": 0.35,
                 "mouth/mouth-lowerlip-volume-incr": 0.6, "mouth/mouth-upperlip-volume-incr": 0.5, "mouth/mouth-cupidsbow-incr": 0.6,
                 "eyebrows/eyebrows-angle-up": 0.35, "neck/neck-scale-vert-incr": 0.45}, face=dict(smile=0.12),
        # a warmer golden-brown, sampled from her panels; freckles over the nose and cheeks and a natural flush
        skin=dict(texture="young_caucasian_female", tone=[0.74, 0.52, 0.36]), hair_color=BLACK_HAIR,
        zones=dict(nose=0.45, cheeks=0.55, ears=0.5, eyes=0.4, freckles=80), brow_cards=True,
        eyelashes="eyelashes02", detail=dict(age=0.12, pores=0.3),
        hair_cards=[  # long, thick, mostly straight (the author, 21 Oct), volume at the crown and sides, strands framing the face
            dict(kind="hair-cards", name="hair", style="long", color=BLACK_HAIR, root=[0.03, 0.025, 0.02], tip=[0.09, 0.07, 0.055],
                 length=0.5, volume=0.02, width=0.019, gap=0.0068, framing=0.3, flyaways=10, wave=0.0025, strands=40, light=0.04,
                 soft=0.016, edge_keep=0.85, edge_fade=0.02),  # (hair round: a soft hairline, the front row thinned and faded in at the root)
            # (hair round: lighter, finer brows, of many narrow cards a few hairs each, full at the nose end and fine at the tail:
            # b1-p008-4, b1-p012-28)
            dict(kind="hair-cards", name="brows", style="brows", color=[0.07, 0.055, 0.045], root=[0.05, 0.04, 0.032], tip=[0.12, 0.09, 0.07],
                 arch=0.005, length=0.011, width=0.0032, count=56, strands=4, fill=0.35, thick=[14, 24], taper=0.9, scatter=0.0015)],
        garments=[dict(kind="top", name="gown", color=[0.95, 0.86, 0.86], print="floral", ink=[0.86, 0.38, 0.46], sleeve=2.0, loose=0.1, **{"from": 0.9}),
                  dict(kind="skirt", name="gown-skirt", color=[0.95, 0.86, 0.86], print="floral", ink=[0.86, 0.38, 0.46], flare=0.07, pleats=0.008),
                  dict(kind="waistband", name="sash", color=[0.7, 0.3, 0.36], width=0.05)]),
    # Bhavi on the well, Ch4: the comic's white kurta with red flowers and a rust salwar, barefoot (the author, 21 Oct; ¶187; b1-p008-4)
    "bhavi-kurta": dict(
        base="bhavi",
        # (the kurta's body hangs over its skirts, and they over the salwar's top: one long kurta, no seam to see through)
        garments=[dict(kind="top", name="kurta", color=[0.96, 0.94, 0.9], print="floral", ink=[0.8, 0.16, 0.12], sleeve=0.5, loose=0.06, **{"from": "waist-0.07"}),
                  dict(kind="skirt", name="kurta-skirt", color=[0.96, 0.94, 0.9], print="floral", ink=[0.8, 0.16, 0.12], top="waist-0.01", to=0.62, flare=0.04, offset=0.022, sits=True),  # (she sits on the well's rim)
                  dict(kind="trousers", name="salwar", color=[0.74, 0.36, 0.16], top="waist-0.05", offset=0.014, pleats=0.006, flare=0.02)]),
    # Maharaj, the stout cook (¶196, ¶203, ¶223; comic b1-p010-2, b1-p012-4): a white turban throughout (the author, 21 Oct)
    "maharaj": dict(
        height=1.65, macro=dict(gender=1.0, age=age(45), muscle=0.4, weight=0.86, height=0.38, race=south_asian(0.35, 0.15)),
        targets={"head/head-round": 0.7, "cheek/l-cheek-volume-incr": 0.5, "cheek/r-cheek-volume-incr": 0.5, "neck/neck-double-incr": 0.4, "eyes/l-eye-scale-decr": 0.2, "eyes/r-eye-scale-decr": 0.2, "mouth/mouth-angles-up": 0.3, "nose/nose-scale-horiz-incr": 0.3}, face=dict(smile=0.15),
        skin=dict(texture="middleage_caucasian_male", tone=[0.56, 0.39, 0.27]), eyebrows="eyebrow001", brow_color=[0.06, 0.05, 0.04],
        detail=dict(age=0.7, pores=0.6),
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
        detail=dict(age=0.95, pores=0.6),  # (lean and lined)
        # (the wrap tucked into the dhoti's top, the dhoti over it: no hem to see)
        garments=[dict(kind="top", name="wrap", color=[0.9, 0.89, 0.85], neckline=0.035, loose=0.05, tucked=True, **{"from": "waist-0.12"}),
                  dict(kind="skirt", name="dhoti", color=WHITE, top="waist+0.05", to=0.12, flare=0.05, pleats=0.01, offset=0.03),  # (worn long, as a veshti: comic b1-p014-5)
                  dict(kind="band", name="shawl", color=[0.98, 0.97, 0.95], print="border", ink=[0.78, 0.62, 0.3], over="l", width=0.2, offset=0.048),
                  dict(kind="band", name="janeyu", color=[0.95, 0.88, 0.7], over="l", width=0.012, offset=0.044, ribbon=True),  # (a thread: a ribbon, not cut from the body)
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
        brow_color=[0.04, 0.035, 0.03], detail=dict(age=0.55, pores=0.85),
        teeth=[0.55, 0.42, 0.26],  # stained with the tobacco he chews (¶108)
        # (the shirt worn into the lungi, the sash over the join: b1-p014-5)
        garments=[dict(kind="top", name="shirt", color=[0.88, 0.82, 0.68], sleeve=0.6, loose=0.1, tucked=True, **{"from": "waist-0.02"}),
                  dict(kind="skirt", name="lungi", color=[0.5, 0.1, 0.1], to=0.28, flare=0.035, top="waist+0.07", offset=0.032),
                  dict(kind="waistband", name="sash", color=[0.72, 0.13, 0.1], width=0.09, offset=0.042),  # (over the lungi's top)
                  dict(kind="sole", name="chappals", color=[0.36, 0.21, 0.11]),
                  dict(kind="moustache", name="moustache", size=1.6, color=[0.04, 0.035, 0.03])]),
    # Vaid Shwet: unusually pale, ruddy, overblown, almost bald from the front, a striped shawl (¶127, ¶296; b1-p006-7, b1-p014-5)
    "vaidji": dict(
        height=1.63, macro=dict(gender=1.0, age=age(55), muscle=0.15, weight=1.0, height=0.35, race=south_asian(0.05, 0.1)),
        targets={"head/head-round": 0.7, "neck/neck-double-incr": 1.0, "cheek/l-cheek-volume-incr": 0.7, "cheek/r-cheek-volume-incr": 0.7, "ears/l-ear-scale-incr": 0.4, "ears/r-ear-scale-incr": 0.4, "eyes/l-eye-scale-decr": 0.1, "eyes/r-eye-scale-decr": 0.1, "mouth/mouth-scale-horiz-decr": 0.2}, face=dict(brows=0.35),
        skin=dict(texture="middleage_caucasian_male", tone=[0.86, 0.64, 0.56]), eyebrows="eyebrow004", brow_color=[0.6, 0.58, 0.55],
        blush=dict(color=[0.85, 0.35, 0.32], cheeks=0.55, feet=0.4), detail=dict(age=0.8, pores=0.75),  # (overblown, ruddy, open-pored)
        garments=[dict(kind="top", name="kurta", color=[0.92, 0.89, 0.8], sleeve=1.7, loose=0.12, **{"from": 0.75}),
                  dict(kind="skirt", name="kurta-skirt", color=[0.92, 0.89, 0.8], to=0.6, flare=0.03),
                  dict(kind="trousers", name="pyjama", color=WHITE, pleats=0.004),
                  dict(kind="stole", name="shawl", color=[0.9, 0.86, 0.76], print="stripes", ink=[0.55, 0.12, 0.12]),
                  dict(kind="fringe", name="fringe", color=[0.74, 0.73, 0.7])]),
    # Mahant's obsequious attendant (¶225, ¶246, ¶295; b1-p011-5): thin, a moustache, a short kurta, a dhoti, a red sash
    "attendant": dict(
        height=1.68, macro=dict(gender=1.0, age=age(35), muscle=0.45, weight=0.28, height=0.45, race=south_asian(0.4, 0.15)),
        skin=dict(texture="young_african_male", tone=[0.5, 0.34, 0.24]), hair="short01", hair_color=BLACK_HAIR, eyebrows="eyebrow002",
        brow_color=[0.04, 0.035, 0.03], detail=dict(age=0.45, pores=0.6),
        garments=[dict(kind="top", name="kurta", color=WHITE, sleeve=0.4, loose=0.06, **{"from": 0.85}),
                  dict(kind="dhoti", name="dhoti", color=WHITE, to=0.2, flare=0.045),
                  dict(kind="waistband", name="sash", color=[0.74, 0.14, 0.1], width=0.06),
                  dict(kind="moustache", name="moustache", color=[0.04, 0.035, 0.03])]),
    # The henchman who brings the summons to the lodge (¶288, ¶293): not the attendant (the author, 21 Oct)
    "henchman": dict(
        height=1.72, macro=dict(gender=1.0, age=age(35), muscle=0.65, weight=0.55, height=0.55, race=south_asian(0.4, 0.1)),
        skin=dict(texture="young_african_male", tone=[0.48, 0.32, 0.22]), hair="short03", hair_color=BLACK_HAIR, eyebrows="eyebrow002",
        brow_color=[0.04, 0.035, 0.03], detail=dict(age=0.45, pores=0.7),
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
        detail=dict(age=0.3, pores=0.45),  # (gaunt from the coma: the folds a little deeper than his years)
        # the lifelike pilot (5c): skin zones; thick dark curls springing up over the bandage, strong brows (b1-p012-11, b1-p013-19)
        targets={"eyebrows/eyebrows-trans-down": 0.25, "chin/chin-width-incr": 0.2, "head/head-square": 0.2},
        zones=dict(nose=0.35, cheeks=0.3, ears=0.5, eyes=0.6, beard=0.35), brow_cards=True,
        hair_cards=[DVIJ_BROWS],
        # Chapters 1-6: the heavy bandage over all his skull (¶101; b1-p004), the borrowed gown, the pyjama too tight
        garments=[dict(kind="top", name="gown", color=[0.66, 0.63, 0.55], sleeve=1.25, loose=0.18, **{"from": 0.75}),
                  dict(kind="skirt", name="gown-skirt", color=[0.66, 0.63, 0.55], to=0.55, flare=0.05),
                  dict(kind="trousers", name="pyjama", color=[0.78, 0.8, 0.84], pleats=0.003),
                  dict(kind="cast", name="plaster", color=[0.8, 0.77, 0.7]),
                  dict(kind="bandage", name="bandage", color=[0.95, 0.94, 0.9]),
                  dict(kind="beard", name="beard", color=[0.05, 0.04, 0.035]),
                  dict(kind="moustache", name="moustache", color=[0.05, 0.04, 0.035])]),
    # Dvij from Chapter 7: "the mass of bandages had been replaced by a much smaller bandage" (b1-ch07 healed), a band of
    # gauze with his thick dark curls springing up over it, a cream shirt, the plaster still on his right arm (b1-p012-11)
    "dvij-healed": dict(
        base="dvij",
        hair_cards=[dict(kind="hair-cards", name="curls", style="curly", color=[0.05, 0.04, 0.035], root=[0.03, 0.025, 0.02], tip=[0.1, 0.08, 0.065],
                         volume=0.03, length=0.045, curl=0.008, turns=1.3, width=0.016, gap=0.0085, wave=0.2, strands=30, above=0.045, light=0.05)] + [DVIJ_BROWS],
        garments=[dict(kind="top", name="shirt", color=[0.86, 0.82, 0.7], sleeve=0.55, loose=0.12, **{"from": "waist-0.12"}),
                  dict(kind="trousers", name="trousers", color=[0.62, 0.58, 0.5], pleats=0.003),
                  dict(kind="cast", name="plaster", color=[0.8, 0.77, 0.7]),
                  dict(kind="curls", name="mane", color=[0.04, 0.032, 0.028], depth=0.016, knots=False),  # (the mass of his hair under the cards)
                  dict(kind="bandage", name="bandage", color=[0.95, 0.94, 0.9], band_only=True),
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


def build(model: str, env: dict, extra: dict | None = None, stem: str | None = None) -> str:
    """Build one person (or, with extra={"arms_only": True}, Dvij's arms) and publish it as <stem>.<hash>.glb."""
    stem = stem or f"people-{model}"
    raw = BUILD / f"{stem}.glb"
    spec = BUILD / f"{stem}.json"
    BUILD.mkdir(parents=True, exist_ok=True)
    spec.write_text(json.dumps({**spec_of(model), "who": model, "out": str(raw), "ual": str(UAL), "clips": CLIPS,
                                "mpfb_data": str(MPFB_DIR / "data"), "mh": str(MH), **(extra or {})}), encoding="utf-8")
    run = subprocess.run([str(BLENDER), "--background", "--factory-startup", "--python", str(SITE / "blender" / "build_human.py"), "--", str(spec)],
                         capture_output=True, text=True, env=env)
    for line in run.stdout.splitlines():
        if line.startswith("PEOPLE WARNING"):
            print(line)
    if "PEOPLE OK" not in run.stdout:
        print(run.stdout[-4000:], run.stderr[-4000:])
        raise SystemExit(f"Blender did not build {model}")
    print(next(l for l in run.stdout.splitlines() if l.startswith("PEOPLE OK")))
    small = BUILD / f"{stem}.small.glb"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "gltf-transform", "optimize", str(raw), str(small), "--compress", "meshopt",
                    "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false",
                    "--join", "false", "--flatten", "false", "--instance", "false", "--palette", "false", "--prune", "false"],
                   check=True, cwd=SITE, capture_output=True)
    return publish(stem, ".glb", small.read_bytes())


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


RHUBARB = CHARS / "rhubarb" / "Rhubarb-Lip-Sync-1.14.0-Windows" / "rhubarb.exe"


def shapes(mp3) -> str:
    """The mouth's shapes through a voiced line, 25 a second, as Rhubarb Lip Sync reads them from the sound
    (https://github.com/DanielSWolf/rhubarb-lip-sync, MIT; its letters: A shut (m, b, p), B teeth (k, s, t, ee),
    C open (eh), D wide (ah), E rounded (aw, er), F puckered (oo, w), G lip under the teeth (f, v), H tongue up (l),
    X at rest). Cached, by the file's hashed name, in pipeline/.build/rhubarb."""
    if not RHUBARB.exists():
        return ""
    cache = BUILD.parent / "rhubarb" / (mp3.stem + ".json")
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        wav = cache.with_suffix(".wav")
        subprocess.run([ffmpeg(), "-v", "error", "-y", "-i", str(mp3), "-ac", "1", "-ar", "16000", str(wav)], check=True)
        subprocess.run([str(RHUBARB), "-f", "json", "--extendedShapes", "GHX", "-o", str(cache), str(wav)], check=True, capture_output=True)
        wav.unlink()
    cues = json.loads(cache.read_text(encoding="utf-8"))["mouthCues"]
    end = cues[-1]["end"] if cues else 0
    out = ["X"] * int(round(end * 25))
    for c in cues:
        for i in range(int(c["start"] * 25), min(len(out), int(round(c["end"] * 25)))):
            out[i] = c["value"]
    return "".join(out)


def mouths() -> str:
    """Each voiced line's loudness, 25 times a second, as one digit (0 shut .. 9 wide): a mouth to follow; how bright
    it sounds; and the lips' shapes (shapes(), above)."""
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
        out[mp3.name] = "".join(str(int(round(v * 9))) for v in level) + "|" + "".join(str(int(round(v * 9))) for v in bright) + "|" + shapes(mp3)
    return publish("voice-mouths", ".json", json.dumps(out, separators=(",", ":")).encode())


CREDITS = [
    "| MakeHuman base mesh, targets and rig, through MPFB 2.0.18 | The MakeHuman team (Joel Palmius et al.) | https://static.makehumancommunity.org/mpfb.html (https://extensions.blender.org/add-ons/mpfb/) | CC0 1.0 (what MPFB makes; the add-on itself is GPL and is not shipped) | The story's people's bodies, faces and skeletons (people-*.glb, pipeline/build_people.py), and Dvij's first-person arms, cut from his (arms.*.glb, pipeline/build_arms.py) |",
    "| MakeHuman system assets: skins, eyes, eyebrows, eyelashes, hair | The MakeHuman team | https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html | CC0 1.0 | The story's people's skin textures (re-toned), eyes, brows, lashes and hair (people-*.glb) |",
    "| Rhubarb Lip Sync 1.14.0 (the program; nothing of it is shipped) | Daniel S. Wolf | https://github.com/DanielSWolf/rhubarb-lip-sync | MIT | The mouths' shapes for every voiced line, read from the sound (voice-mouths.*.json) |",
    "| Universal Animation Library (Standard) | Quaternius | https://quaternius.com/packs/universalanimationlibrary.html (https://quaternius.itch.io/universal-animation-library) | CC0 1.0 | The story's people's walks, idles, sitting, kneeling, crouching, reaching and picking up, retargeted onto MakeHuman's skeleton (people-*.glb) |",
]
CREDITS += [
    "| MediaPipe Face Landmarker (the program and its model; nothing of it is shipped) | Google | https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker | Apache 2.0 | Reading the comic's faces to score the 3D faces' likeness (pipeline/likeness/, the lifelike pilot) |",
    "| DreamShaper 8 (Stable Diffusion 1.5) with the LCM LoRA for SD 1.5 (nothing of them, nor their pictures, is shipped) | Lykon; latent-consistency | https://huggingface.co/Lykon/dreamshaper-8, https://huggingface.co/latent-consistency/lcm-lora-sdv1-5 | CreativeML OpenRAIL-M; OpenRAIL++ | Reference pictures for fitting the faces and grooming the hair, made on the laptop (pipeline/likeness/refs.py) |",
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
