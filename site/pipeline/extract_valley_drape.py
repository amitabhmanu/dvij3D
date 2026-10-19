"""Step 7.6: the painted valley map, laid over the line map (design §10.1).

book/B1.pdf p1 holds a painted map of the valley (1425x1104, xref 18) above a
pure-black image of almost the same size (1536x1024, xref 21). The painting is
a different drawing from images/artifacts/map.jpg, not a sharper copy of it, so
it is registered by hand-picked matching points (src/content/valley/
drape-points.yaml) rather than by image features: an affine fit first, and a
smoothed thin-plate spline on top where the affine leaves more than MAX_AFFINE
of residual. The painting is then warped into map.jpg's frame, so the 3D
terrain traced from map.jpg can wear it as its skin.

The painting is already published as the reader's page b1-p001, so its warped
copy raises no new publishing question.

Inputs:  book/B1.pdf, images/artifacts/map.jpg, src/content/valley/drape-points.yaml
Output:  site-assets/terrain/valley-drape.<hash>.webp
         src/content/generated/drape.json           (committed)
         pipeline/reports/valley-drape-overlay.png  (for review)
Usage:   python extract_valley_drape.py
"""
import hashlib
import io
import json

import cv2
import fitz
import numpy as np
import yaml
from PIL import Image
from scipy.interpolate import RBFInterpolator

from common import ASSETS, REPORTS, source_pdf
from valley_contours import CONTENT, MAP_JPG

POINTS = CONTENT / "valley" / "drape-points.yaml"
DRAPE_JSON = CONTENT / "generated" / "drape.json"
TERRAIN = ASSETS / "terrain"
XREF, SIZE = 18, (1425, 1104)
WIDTH = 1792  # drape width; height follows map.jpg's aspect (1792 at q72 keeps it under 500 KB)
QUALITY = 72
EDGE = 0.02  # fade width at the painting's torn edges, as a fraction of the drape
MAX_AFFINE = 6.0  # px on map.jpg: beyond this the spline takes over
SMOOTHING = 1e-4  # spline smoothing (in normalised units), so one misread point can't pucker the map


def extract() -> np.ndarray:
    doc = fitz.open(source_pdf(1))
    info = doc.extract_image(XREF)
    img = Image.open(io.BytesIO(info["image"])).convert("RGB")
    if img.size != SIZE:
        raise SystemExit(f"B1 p1 xref {XREF} is {img.size}, expected {SIZE}: has the PDF changed?")
    rgb = np.asarray(img)
    if rgb.mean() < 50:
        raise SystemExit(f"B1 p1 xref {XREF} is nearly black: that is the page's black image, not the map")
    return rgb


def fit(points: list[dict], map_w: int, map_h: int):
    """map.jpg (normalised) -> painting (normalised), and the residuals in map.jpg px."""
    m = np.array([p["map"] for p in points], float)
    p = np.array([p["painted"] for p in points], float)
    A = np.c_[m, np.ones(len(m))]
    coef, *_ = np.linalg.lstsq(A, p, rcond=None)
    # residual measured in map.jpg pixels: invert the fit at each point
    fwd, *_ = np.linalg.lstsq(np.c_[p, np.ones(len(p))], m, rcond=None)
    back = np.c_[p, np.ones(len(p))] @ fwd
    resid = np.hypot((back[:, 0] - m[:, 0]) * map_w, (back[:, 1] - m[:, 1]) * map_h)
    rms = float(np.sqrt((resid ** 2).mean()))
    if rms <= MAX_AFFINE:
        return (lambda q: np.c_[q, np.ones(len(q))] @ coef), "affine", rms, resid
    rbf = RBFInterpolator(m, p, kernel="thin_plate_spline", smoothing=SMOOTHING, degree=1)
    return rbf, "thin-plate spline", rms, resid


def main() -> None:
    painted = extract()
    ph, pw = painted.shape[:2]
    line_map = cv2.imread(str(MAP_JPG))
    if line_map is None:
        raise SystemExit(f"Cannot read {MAP_JPG}")
    mh, mw = line_map.shape[:2]
    points = yaml.safe_load(POINTS.read_text(encoding="utf-8"))["points"]
    if len(points) < 6:
        raise SystemExit(f"{POINTS.name}: {len(points)} points; a spline needs at least 6 well spread")
    warp, method, rms, resid = fit(points, mw, mh)
    worst = int(np.argmax(resid))
    print(f"Affine residual {rms:.1f} px RMS on map.jpg (worst {resid[worst]:.1f} px: {points[worst]['name']}); using {method}")

    height = round(WIDTH * mh / mw)
    u, v = np.meshgrid((np.arange(WIDTH) + 0.5) / WIDTH, (np.arange(height) + 0.5) / height)
    src = warp(np.c_[u.ravel(), v.ravel()])
    mx = (src[:, 0] * pw - 0.5).reshape(height, WIDTH).astype(np.float32)
    my = (src[:, 1] * ph - 0.5).reshape(height, WIDTH).astype(np.float32)
    drape = cv2.remap(painted[:, :, ::-1], mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    # The painting's edges are torn and dark, and map.jpg reaches a little past
    # it on the east. Fade those into the painting's own paper colour, so the
    # terrain's outer rim wears plain parchment rather than a smear.
    paper = np.median(painted.reshape(-1, 3), axis=0)[::-1]
    lum = cv2.cvtColor(painted, cv2.COLOR_RGB2GRAY)
    _, labels = cv2.connectedComponents((lum <= 60).astype(np.uint8), connectivity=8)
    rim = np.unique(np.r_[labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    torn = np.isin(labels, rim[rim > 0])  # dark regions that reach the painting's edge
    usable = cv2.erode(((~torn) * 255).astype(np.uint8), np.ones((9, 9), np.uint8))
    keep = cv2.remap(usable, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    keep = cv2.GaussianBlur(keep.astype(np.float32) / 255, (0, 0), EDGE * WIDTH / 2)[:, :, None]
    drape = (drape * keep + paper * (1 - keep)).astype(np.uint8)

    buf = io.BytesIO()
    Image.fromarray(drape[:, :, ::-1]).save(buf, "WEBP", quality=QUALITY, method=6)
    data = buf.getvalue()
    name = f"valley-drape.{hashlib.sha256(data).hexdigest()[:10]}.webp"
    TERRAIN.mkdir(parents=True, exist_ok=True)
    for old in TERRAIN.glob("valley-drape.*.webp"):
        if old.name != name:
            old.unlink()
    (TERRAIN / name).write_bytes(data)

    DRAPE_JSON.write_text(json.dumps({
        "file": name, "w": WIDTH, "h": height, "method": method,
        "affineRms": round(rms, 2), "points": len(points),
    }, indent=1) + "\n", encoding="utf-8")

    # review: map.jpg's ink in red over the warped painting
    small = cv2.resize(drape, (mw * 2, mh * 2), interpolation=cv2.INTER_AREA)
    ink = cv2.resize(cv2.cvtColor(line_map, cv2.COLOR_BGR2GRAY), (mw * 2, mh * 2)) < 150
    small[ink] = (40, 40, 230)
    for p in points:
        x, y = int(p["map"][0] * mw * 2), int(p["map"][1] * mh * 2)
        cv2.drawMarker(small, (x, y), (255, 255, 0), cv2.MARKER_CROSS, 18, 2)
    REPORTS.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(REPORTS / "valley-drape-overlay.png"), small)
    print(f"Wrote {name} ({len(data) // 1024} KB, {WIDTH}x{height}); review {REPORTS / 'valley-drape-overlay.png'}")


if __name__ == "__main__":
    main()
