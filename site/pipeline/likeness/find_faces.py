"""Find the painted faces on the comic's pages and crop them, for the likeness rig (pipeline/likeness/README.md).

MediaPipe's Face Landmarker (Apache 2.0) is built for photographs, so each page is read in overlapping windows at
a few scales, and every face it finds is kept with its 478 points, head pose and 52 expression scores.

    python pipeline/likeness/find_faces.py b1-p005 b1-p013     # a range of pages
Writes pipeline/.cache/likeness/faces/<page>-fNN.jpg and faces.json (bbox, landmarks, pose, blendshapes).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image

SITE = Path(__file__).resolve().parents[2]
MASTER = SITE.parent / "site-assets" / "master"
CACHE = SITE / "pipeline" / ".cache"
MODEL = CACHE / "mediapipe" / "face_landmarker.task"
OUT = CACHE / "likeness" / "faces"


def landmarker():
    o = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),
        num_faces=4, min_face_detection_confidence=0.35, min_face_presence_confidence=0.35,
        output_face_blendshapes=True, output_facial_transformation_matrixes=True)
    return mp.tasks.vision.FaceLandmarker.create_from_options(o)


def read(lm, rgb: np.ndarray):
    """Faces in one image: list of (points px Nx3, blendshapes dict, 4x4 matrix)."""
    h, w = rgb.shape[:2]
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    out = []
    for i, pts in enumerate(res.face_landmarks):
        p = np.array([[q.x * w, q.y * h, q.z * w] for q in pts])
        bs = {b.category_name: round(b.score, 4) for b in res.face_blendshapes[i]} if res.face_blendshapes else {}
        m = np.array(res.facial_transformation_matrixes[i]).tolist() if res.facial_transformation_matrixes else None
        out.append((p, bs, m))
    return out


def iou(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


def page_faces(lm, page: str):
    im = Image.open(MASTER / f"{page}.png").convert("RGB")
    W, H = im.size
    found = []  # (bbox, points, bs, matrix)
    for win in (1400, 800, 420):  # big close-ups, medium shots, small figures
        step = win // 2
        for y in range(0, max(1, H - win // 2), step):
            for x in range(0, max(1, W - win // 2), step):
                box = (x, y, min(W, x + win), min(H, y + win))
                tile = im.crop(box)
                scale = 640 / max(tile.size)
                tile = tile.resize((round(tile.size[0] * scale), round(tile.size[1] * scale)), Image.LANCZOS)
                for p, bs, m in read(lm, np.asarray(tile)):
                    p = p / scale
                    p[:, 0] += x
                    p[:, 1] += y
                    bb = (p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max())
                    size = max(bb[2] - bb[0], bb[3] - bb[1])
                    if size < 40 or size > win * 0.95:
                        continue
                    # a face cut by the window's edge is read badly; the overlapping window has it whole
                    if (bb[0] < x + 2 and x > 0) or (bb[1] < y + 2 and y > 0) or bb[2] > box[2] - 2 or bb[3] > box[3] - 2:
                        if not (bb[2] >= W - 2 or bb[3] >= H - 2):
                            continue
                    dup = next((f for f in found if iou(f[0], bb) > 0.3), None)
                    if dup is None:
                        found.append((bb, p, bs, m))
                    elif size > max(dup[0][2] - dup[0][0], dup[0][3] - dup[0][1]):
                        found[found.index(dup)] = (bb, p, bs, m)
    found.sort(key=lambda f: (round(f[0][1] / 300), f[0][0]))
    return im, found


def main(first: str, last: str | None = None):
    OUT.mkdir(parents=True, exist_ok=True)
    book, a = first.split("-p")
    b = int((last or first).split("-p")[1])
    index_path = OUT / "faces.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    lm = landmarker()
    for n in range(int(a), b + 1):
        page = f"{book}-p{n:03d}"
        if not (MASTER / f"{page}.png").exists():
            continue
        im, found = page_faces(lm, page)
        for k in [k for k in index if k.startswith(page + "-")]:
            del index[k]
        for i, (bb, p, bs, m) in enumerate(found):
            key = f"{page}-f{i:02d}"
            size = max(bb[2] - bb[0], bb[3] - bb[1])
            cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
            half = size * 0.85
            crop = tuple(round(v) for v in (cx - half, cy - half * 1.1, cx + half, cy + half * 0.9))
            im.crop(crop).resize((384, 384), Image.LANCZOS).save(OUT / f"{key}.jpg", quality=90)
            index[key] = {"page": page, "bbox": [round(v, 1) for v in bb], "crop": crop,
                          "points": np.round(p, 2).tolist(), "blendshapes": bs, "matrix": m}
        print(page, len(found), "faces")
    index_path.write_text(json.dumps(index))


if __name__ == "__main__":
    main(*sys.argv[1:3])
