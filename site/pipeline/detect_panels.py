"""Step 0.5: draft panel boxes for the reader's panel mode.

Each panel is a separately embedded image. Images overlap and later ones are
painted over earlier ones, so each panel's box is the part of its image still
visible after painting (see page_panels). Backgrounds and specks are dropped
and the rest sorted into reading order: rows top-to-bottom, then left-to-right
within a row.

Drafts must be reviewed in the dev tool; corrections override these.
Output: site-assets/data/panels.json  {"b1-p004": [[x0, y0, x1, y1], ...]} (0-1)
Usage: python detect_panels.py [--books 1,2] [--overlay b1-p004,b2-p004]
"""
import argparse
import json

import fitz
import numpy as np

from common import ASSETS, BOOKS, compressed_pdf, crop_box, parse_books

MIN_AREA = 0.01      # fraction of page; smaller images are decorations
BACKGROUND = 0.92    # fraction of page; a box this big behind others is a background
CELL = 4             # grid resolution in points


def area(r: fitz.Rect) -> float:
    return max(r.width, 0) * max(r.height, 0)


def page_panels(page: fitz.Page, page_id: str = "") -> list[fitz.Rect]:
    """Visible panel boxes, allowing for paint order.

    Panels are not clipped: later images are simply painted over earlier ones.
    So paint every image, in drawing order, onto a coarse grid ("last painter
    wins") and take the bounding box of the cells each image still owns.
    """
    # a cropped page (common.PAGE_CROPS) is detected inside its published area,
    # so a panel that was cut away cannot come back as a box
    pr = fitz.Rect(*crop_box(page_id, page.rect.width, page.rect.height))
    cols, rows = int(pr.width / CELL), int(pr.height / CELL)
    grid = np.full((rows, cols), -1, dtype=np.int32)
    for n, info in enumerate(page.get_image_info()):  # drawing order
        r = fitz.Rect(info["bbox"]) & pr
        if r.is_empty:
            continue
        grid[int(r.y0 / CELL):int(np.ceil(r.y1 / CELL)), int(r.x0 / CELL):int(np.ceil(r.x1 / CELL))] = n

    boxes = []
    for n in np.unique(grid[grid >= 0]):
        ys, xs = np.nonzero(grid == n)
        owned = len(ys) * CELL * CELL
        if owned < MIN_AREA * area(pr):
            continue  # an image almost entirely covered by later ones
        boxes.append(fitz.Rect(xs.min() * CELL, ys.min() * CELL, (xs.max() + 1) * CELL, (ys.max() + 1) * CELL) & pr)
    if len(boxes) > 1:
        boxes = [b for b in boxes if area(b) < BACKGROUND * area(pr)] or boxes
    return reading_order(boxes)


def reading_order(boxes: list[fitz.Rect]) -> list[fitz.Rect]:
    """Group boxes into rows by vertical overlap, then order each row left to right."""
    rows: list[list[fitz.Rect]] = []
    for b in sorted(boxes, key=lambda r: r.y0):
        cy = (b.y0 + b.y1) / 2
        row = next((row for row in rows if min(r.y0 for r in row) <= cy <= max(r.y1 for r in row)), None)
        if row is not None:
            row.append(b)
        else:
            rows.append([b])
    return [b for row in rows for b in sorted(row, key=lambda r: r.x0)]


def overlay(doc: fitz.Document, index: int, boxes: list[fitz.Rect], out: str) -> None:
    """Debug image: page with numbered draft boxes."""
    page = doc[index]
    shape = page.new_shape()
    for n, b in enumerate(boxes, 1):
        shape.draw_rect(b + (4, 4, -4, -4))
        shape.finish(color=(1, 0, 0), width=4)
        shape.insert_text(b.tl + (12, 40), str(n), fontsize=36, color=(1, 0, 0))
    shape.commit()
    page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5)).save(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--books")
    ap.add_argument("--overlay", help="page ids to render with boxes, e.g. b1-p004")
    args = ap.parse_args()

    out_path = ASSETS / "data" / "panels.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(out_path.read_text()) if out_path.exists() else {}
    wanted = set((args.overlay or "").split(",")) - {""}
    for book in parse_books(args.books):
        doc = fitz.open(compressed_pdf(book))
        slug = BOOKS[book]["slug"]
        counts = []
        for i, page in enumerate(doc):
            pid = f"{slug}-p{i + 1:03d}"
            boxes = page_panels(page, pid)
            _, _, w, h = crop_box(pid, page.rect.width, page.rect.height)
            data[pid] = [[round(b.x0 / w, 4), round(b.y0 / h, 4), round(b.x1 / w, 4), round(b.y1 / h, 4)]
                         for b in boxes]
            counts.append(len(boxes))
            if pid in wanted:
                overlay(fitz.open(compressed_pdf(book)), i, boxes, str(ASSETS / "data" / f"overlay-{pid}.png"))
        print(f"B{book}: {sum(counts)} panels, per page min {min(counts)} max {max(counts)}")
    out_path.write_text(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()
