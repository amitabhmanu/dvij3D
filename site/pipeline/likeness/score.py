"""How like the comic the 3D faces are (the lifelike pilot's likeness rig, step 1).

For each character: their 3D head is drawn in the people lab over a grid of head turns (render.mjs), MediaPipe's Face
Landmarker reads both those renders and the character's comic crops (labels.yaml, find_faces.py), and each crop is
matched with the render whose head pose is nearest. The likeness error is the distance between the two sets of face
points after the best fit by moving, turning and scaling one onto the other (Procrustes), as a share of the distance
between the eyes, over the face's outline, brows, eyes, nose and lips: lower is closer. The expression in a panel
adds to it, so the number tracks change, it is not an absolute.

    python pipeline/likeness/score.py [who ...] [--tag v1]     -> .downloads/lifelike-pilot/likeness/<who>-<tag>.json, sheets
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import mediapipe as mp
import numpy as np
import yaml
from PIL import Image, ImageDraw

SITE = Path(__file__).resolve().parents[2]
CACHE = SITE / "pipeline" / ".cache" / "likeness"
FACES = CACHE / "faces"
OUT = Path("C:/Users/Amitabh/projects/dvij3D/.downloads/lifelike-pilot/likeness")
MODEL_OF = {"bhavi": "bhavi-kurta"}  # (which built person plays them)

C = mp.tasks.vision.FaceLandmarksConnections
REGIONS = {
    "outline": C.FACE_LANDMARKS_FACE_OVAL, "brows": C.FACE_LANDMARKS_LEFT_EYEBROW + C.FACE_LANDMARKS_RIGHT_EYEBROW,
    "eyes": C.FACE_LANDMARKS_LEFT_EYE + C.FACE_LANDMARKS_RIGHT_EYE, "nose": C.FACE_LANDMARKS_NOSE, "lips": C.FACE_LANDMARKS_LIPS,
}
IDX = {k: sorted({i for c in v for i in (c.start, c.end)}) for k, v in REGIONS.items()}
ALL = sorted({i for v in IDX.values() for i in v})
EYE_L, EYE_R = 33, 263  # the eyes' outer corners


def landmarker():
    o = mp.tasks.vision.FaceLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(SITE / "pipeline" / ".cache" / "mediapipe" / "face_landmarker.task")),
                                              num_faces=1, min_face_detection_confidence=0.3, output_facial_transformation_matrixes=True, output_face_blendshapes=True)
    return mp.tasks.vision.FaceLandmarker.create_from_options(o)


def read(lm, path):
    im = np.asarray(Image.open(path).convert("RGB"))
    r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(im)))
    if not r.face_landmarks:
        return None
    h, w = im.shape[:2]
    p = np.array([[q.x * w, q.y * h, q.z * w] for q in r.face_landmarks[0]])
    m = np.array(r.facial_transformation_matrixes[0])
    return p, m, {b.category_name: b.score for b in r.face_blendshapes[0]}


def pose(m):
    r = m[:3, :3]
    return math.degrees(math.atan2(r[0, 2], r[2, 2])), math.degrees(math.asin(-max(-1, min(1, r[1, 2]))))


def procrustes(a, b):
    """RMS distance of b's points from a's after the best similarity fit of b onto a, as a share of a's eye span."""
    a2, b2 = a[:, :2], b[:, :2]
    ma, mb = a2.mean(0), b2.mean(0)
    A, B = a2 - ma, b2 - mb
    u, s, vt = np.linalg.svd(B.T @ A)
    R = u @ vt
    scale = s.sum() / (B ** 2).sum()
    fit = B @ R * scale
    return float(np.sqrt(((fit - A) ** 2).sum(1).mean()))


def score(lm, who, tag, grid_yaw=range(-60, 61, 12), grid_pitch=(-12, 0, 12)):
    OUT.mkdir(parents=True, exist_ok=True)
    rd = CACHE / "renders" / f"{who}-{tag}"
    rd.mkdir(parents=True, exist_ok=True)
    shots = [{"who": MODEL_OF.get(who, who), "yaw": y, "pitch": p, "look": "ahead", "fov": 22, "dist": 0.75, "w": 512, "h": 512,
              "out": str(rd / f"y{y}_p{p}.jpg")} for y in grid_yaw for p in grid_pitch]
    (rd / "shots.json").write_text(json.dumps(shots))
    subprocess.run(["node", str(Path(__file__).with_name("render.mjs")), str(rd / "shots.json")], check=True, cwd=SITE)
    renders = []
    for s in shots:
        r = read(lm, s["out"])
        if r:
            renders.append((s, *r))
    labels = yaml.safe_load(Path(__file__).with_name("labels.yaml").read_text())[who]
    rows = []
    for k in labels:
        r = read(lm, FACES / f"{k}.jpg")
        if not r:
            continue
        p, m, bs = r
        yaw, pitch = pose(m)
        best = min(renders, key=lambda x: (pose(x[2])[0] - yaw) ** 2 + (pose(x[2])[1] - pitch) ** 2)
        span = np.linalg.norm(p[EYE_L, :2] - p[EYE_R, :2]) or 1
        regions = {k2: procrustes(p[v], best[1][v]) / span for k2, v in IDX.items()}
        rows.append({"crop": k, "yaw": round(yaw, 1), "pitch": round(pitch, 1), "render": Path(best[0]["out"]).name,
                     "render_yaw": round(pose(best[2])[0], 1), "error": round(procrustes(p[ALL], best[1][ALL]) / span, 4),
                     "regions": {k2: round(v, 4) for k2, v in regions.items()},
                     "expression": round(sum(v for n, v in bs.items() if n != "_neutral" and not n.startswith("eyeLook")), 2)})
    # the panels with little expression count the most: the score weights each by how neutral it is
    w = np.array([1 / (1 + r["expression"]) for r in rows])
    e = np.array([r["error"] for r in rows])
    res = {"who": who, "tag": tag, "panels": len(rows), "renders_read": len(renders), "score": round(float((w * e).sum() / w.sum()), 4),
           "regions": {k2: round(float(np.average([r["regions"][k2] for r in rows], weights=w)), 4) for k2 in IDX}, "rows": rows}
    (OUT / f"{who}-{tag}.json").write_text(json.dumps(res, indent=1))
    # a sheet: each panel beside its matched render, the error under it
    rows_s = sorted(rows, key=lambda r: r["error"])[:12]
    sheet = Image.new("RGB", (6 * 2 * 160, ((len(rows_s) + 5) // 6) * 180), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, r in enumerate(rows_s):
        x, y = (i % 6) * 320, (i // 6) * 180
        sheet.paste(Image.open(FACES / f"{r['crop']}.jpg").resize((160, 160)), (x, y))
        sheet.paste(Image.open(rd / r["render"]).resize((160, 160)), (x + 160, y))
        d.text((x + 4, y + 163), f"{r['crop']}  err {r['error']:.3f}", fill=(230, 230, 230))
    sheet.save(OUT / f"{who}-{tag}-pairs.jpg", quality=86)
    print(who, tag, "score", res["score"], "over", len(rows), "panels; regions", res["regions"])
    return res


if __name__ == "__main__":
    args = sys.argv[1:]
    tag = "v0"
    if "--tag" in args:
        tag = args[args.index("--tag") + 1]
        args = [a for a in args if a not in ("--tag", tag)]
    lm = landmarker()
    for who in args or ["professor", "bhavi", "dvij"]:
        score(lm, who, tag)
