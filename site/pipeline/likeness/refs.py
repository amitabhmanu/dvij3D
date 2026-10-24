"""Extra reference pictures of the Professor, Bhavi and Dvij, made on this laptop's CPU (the lifelike pilot's refs).

Model: DreamShaper 8 (Lykon, Stable Diffusion 1.5; CreativeML OpenRAIL-M) with the LCM LoRA for SD 1.5 (latent-
consistency; OpenRAIL++), so a picture takes 6 steps. FLUX.1-schnell needs far more memory than the laptop's 8 GB.
Faces start from the comic's own crops (img2img), so they stay close to the panels; the back of the hair has no
panel to start from and is drawn from the words alone.

They are reference only: for fitting the faces (front and profile), grooming the hair from behind, expression
presets and a projection-paint base for the skin. None of them ships.

    python pipeline/likeness/refs.py [who ...]      -> <out>/<who>-<view>.jpg  (out: .downloads/lifelike-pilot/refs)
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import yaml
from PIL import Image

SITE = Path(__file__).resolve().parents[2]
FACES = SITE / "pipeline" / ".cache" / "likeness" / "faces"
OUT = Path("C:/Users/Amitabh/projects/dvij3D/.downloads/lifelike-pilot/refs")
MODEL, LCM = "Lykon/dreamshaper-8", "latent-consistency/lcm-lora-sdv1-5"
STYLE = "realistic painted comic illustration, warm natural skin, detailed face, soft even studio light, plain light grey background"
NEG = "cartoon, deformed, extra fingers, bad anatomy, blurry, text, watermark, frame, cropped head, hat, two people"

WHO = {
    "professor": "an elderly South Indian man about 70, loose grey curly hair white at the ears, round wire-rimmed glasses, "
                 "a white drooping moustache, warm brown skin, deep crow's feet, a cream cotton shirt",
    "bhavi": "a young Indian woman about 25, large almond doe eyes, arched dark brows, full lips, a small curving jaw, "
             "warm golden-brown skin with light freckles on the nose and cheeks, long thick mostly straight black hair, "
             "a white kurta printed with small red flowers",
    "dvij": "a young Indian man in his late twenties, thick dark curly hair, a short stubble beard, strong brows, warm brown skin, "
            "a white gauze bandage wound round his head, a cream cotton shirt",
}
EXPR = {
    "professor": ["smiling warmly", "laughing, head tipped back", "frowning", "surprised, brows raised"],
    "bhavi": ["smiling warmly", "laughing", "frowning", "surprised, brows raised", "glaring, eyes narrowed", "chewing her lower lip, unsure"],
    "dvij": ["worried", "puzzled, one brow raised", "determined, jaw set", "a small shy smile"],
}


def yaw_pitch(m):
    """The head's turn (degrees) from MediaPipe's facial transformation matrix."""
    r = np.array(m)[:3, :3]
    return math.degrees(math.atan2(r[0, 2], r[2, 2])), math.degrees(math.asin(-max(-1, min(1, r[1, 2]))))


def crops(who):
    labels = yaml.safe_load((Path(__file__).with_name("labels.yaml")).read_text())[who]
    index = json.loads((FACES / "faces.json").read_text())
    out = []
    for k in labels:
        f = index.get(k)
        if not f or not f.get("matrix"):
            continue
        y, p = yaw_pitch(f["matrix"])
        size = max(f["bbox"][2] - f["bbox"][0], f["bbox"][3] - f["bbox"][1])
        out.append((k, y, p, size))
    return out


def pipes():
    from diffusers import LCMScheduler, StableDiffusionImg2ImgPipeline, StableDiffusionPipeline
    torch.set_num_threads(3)  # (one core left for the rest of the laptop)
    t2i = StableDiffusionPipeline.from_pretrained(MODEL, torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
    t2i.scheduler = LCMScheduler.from_config(t2i.scheduler.config)
    t2i.load_lora_weights(LCM)
    t2i.fuse_lora()
    t2i.enable_attention_slicing()
    i2i = StableDiffusionImg2ImgPipeline(**t2i.components)
    return t2i, i2i


def main(whos):
    OUT.mkdir(parents=True, exist_ok=True)
    t2i, i2i = pipes()
    log = OUT / "refs.log"
    for who in whos:
        cs = crops(who)
        big = [c for c in cs if c[3] > 150] or cs
        front = min(big, key=lambda c: abs(c[1]) + abs(c[2]) * 0.5)
        side = max(big, key=lambda c: abs(c[1]))
        desc = WHO[who]
        g = torch.Generator().manual_seed(7)
        jobs = [("front", front[0], f"head and shoulders portrait, facing the viewer, neutral expression, {desc}, {STYLE}", 0.55),
                ("profile", side[0], f"head and shoulders portrait, true side profile, neutral expression, {desc}, {STYLE}", 0.6),
                ("back", None, f"the back of the head and shoulders seen from behind and a little to one side, showing the hair, {desc}, {STYLE}", 1.0)]
        jobs += [(f"expr-{i}-{e.split(',')[0].replace(' ', '-')}", front[0], f"head and shoulders portrait, {e}, {desc}, {STYLE}", 0.62)
                 for i, e in enumerate(EXPR[who])]
        for name, src, prompt, strength in jobs:
            path = OUT / f"{who}-{name}.jpg"
            if path.exists():
                continue
            t = time.time()
            if src:
                init = Image.open(FACES / f"{src}.jpg").convert("RGB").resize((512, 512))
                im = i2i(prompt=prompt, negative_prompt=NEG, image=init, strength=strength, num_inference_steps=8, guidance_scale=1.5, generator=g).images[0]
            else:
                im = t2i(prompt=prompt, negative_prompt=NEG, width=512, height=512, num_inference_steps=6, guidance_scale=1.5, generator=g).images[0]
            im.save(path, quality=92)
            with log.open("a", encoding="utf-8") as f:
                f.write(f"{path.name}\tfrom {src or 'text'}\t{time.time() - t:.0f}s\t{prompt}\n")
            print(path.name, f"{time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or ["professor", "bhavi", "dvij"])
