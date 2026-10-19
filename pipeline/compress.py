"""Step 0.1: compress the final book PDFs and run the quality gate.

Every embedded panel image in the source PDFs is a lossless Flate RGB image
(no transparency, <=150 dpi at print size), so compression is a straight
re-encode to JPEG. Text, vectors and layout are untouched.

Usage: python compress.py [--books 1,2] [--quality 80]

Settings (q80, 4:2:0) were chosen by visual comparison: ~10 % of source size,
indistinguishable at 2x zoom, worst-page SSIM ~0.97.
"""
import argparse
import io
import json
import time

import fitz
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

from common import BOOKS, REPORTS, compressed_pdf, parse_books, source_pdf

SSIM_THRESHOLD = 0.97
GATE_ZOOM = 1.0  # render scale for the visual comparison


def reencode(doc: fitz.Document, quality: int) -> tuple[int, int]:
    """Replace every image with a JPEG version. Returns (count, bytes_saved)."""
    done, saved = set(), 0
    for page in doc:
        for img in page.get_images(full=True):
            xref = img[0]
            if xref in done:
                continue
            done.add(xref)
            before = len(doc.xref_stream_raw(xref))
            pix = fitz.Pixmap(doc, xref)
            if pix.alpha or pix.colorspace is None or pix.colorspace.n != 3:
                pix = fitz.Pixmap(fitz.csRGB, pix, 0)
            buf = io.BytesIO()
            Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(
                buf, "JPEG", quality=quality, optimize=True, subsampling=2  # 4:2:0
            )
            data = buf.getvalue()
            if len(data) < before:  # keep the original if JPEG would be larger
                page.replace_image(xref, stream=data)
                saved += before - len(data)
    return len(done), saved


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Mean structural similarity of two greyscale images (Wang et al. 2004)."""
    a, b = a.astype(np.float64), b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a, mu_b = gaussian_filter(a, 1.5), gaussian_filter(b, 1.5)
    var_a = gaussian_filter(a * a, 1.5) - mu_a**2
    var_b = gaussian_filter(b * b, 1.5) - mu_b**2
    cov = gaussian_filter(a * b, 1.5) - mu_a * mu_b
    num = (2 * mu_a * mu_b + c1) * (2 * cov + c2)
    den = (mu_a**2 + mu_b**2 + c1) * (var_a + var_b + c2)
    return float((num / den).mean())


def grey(page: fitz.Page) -> np.ndarray:
    pix = page.get_pixmap(matrix=fitz.Matrix(GATE_ZOOM, GATE_ZOOM), colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)


def gate(book: int, src: fitz.Document, out: fitz.Document) -> dict:
    expected = BOOKS[book]["pages"]
    text_diff = [i + 1 for i in range(src.page_count) if src[i].get_text() != out[i].get_text()]
    scores = {i + 1: round(ssim(grey(src[i]), grey(out[i])), 4) for i in range(src.page_count)}
    worst = min(scores, key=scores.get)
    checks = {
        "page_count": src.page_count == out.page_count == expected,
        "text_identical": not text_diff,
        "ssim": scores[worst] >= SSIM_THRESHOLD,
    }
    return {
        "pages": out.page_count,
        "text_mismatch_pages": text_diff,
        "ssim_min": scores[worst],
        "ssim_min_page": worst,
        "ssim_mean": round(sum(scores.values()) / len(scores), 4),
        "checks": checks,
        "passed": all(checks.values()),
    }


def compress(book: int, quality: int) -> dict:
    src_path, out_path = source_pdf(book), compressed_pdf(book)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    doc = fitz.open(src_path)
    count, _ = reencode(doc, quality)
    doc.save(out_path, garbage=4, deflate=True, clean=True)
    doc.close()

    src, out = fitz.open(src_path), fitz.open(out_path)
    result = {
        "book": book,
        "quality": quality,
        "images": count,
        "source_mb": round(src_path.stat().st_size / 1e6, 1),
        "compressed_mb": round(out_path.stat().st_size / 1e6, 1),
        "seconds": round(time.time() - t0),
        **gate(book, src, out),
    }
    result["ratio_pct"] = round(100 * result["compressed_mb"] / result["source_mb"], 1)
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--books")
    ap.add_argument("--quality", type=int, default=80)
    args = ap.parse_args()

    REPORTS.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS / "compress.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    for book in parse_books(args.books):
        r = compress(book, args.quality)
        report[f"b{book}"] = r
        status = "PASS" if r["passed"] else "FAIL"
        print(f"B{book}: {r['source_mb']} MB -> {r['compressed_mb']} MB ({r['ratio_pct']}%), "
              f"SSIM min {r['ssim_min']} (p{r['ssim_min_page']}), text ok={r['checks']['text_identical']} "
              f"[{status}] {r['seconds']}s")
    report_path.write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
