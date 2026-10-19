"""Step 0.4: extract the lettering (captions, balloons, sound effects) per page.

Text in the PDFs is live, but split into many small blocks. Each caption box
and speech balloon is drawn as a filled shape behind its text, so blocks are
grouped by the smallest filled shape that contains them:
  rectangle container -> caption, path container -> balloon, none -> sfx.

Output: site-assets/data/text.json
  {"b1-p006": [{"t": "...", "bbox": [x0, y0, x1, y1], "kind": "balloon"}, ...]}
bboxes are normalised to 0-1 page coordinates. Order is top-to-bottom here;
build_manifests.py reorders units by panel reading order.
Usage: python extract_text.py [--books 1,2]
"""
import argparse
import json
import re

import fitz

from common import ASSETS, BOOKS, compressed_pdf, crop_box, parse_books

MIN_CONTAINER_AREA = 400  # pt^2; ignore specks


def containers(page: fitz.Page) -> list[tuple[fitz.Rect, str]]:
    out = []
    for d in page.get_drawings():
        fill = d.get("fill")
        if not fill or not d["items"] or d["rect"].get_area() < MIN_CONTAINER_AREA:
            continue
        if d["rect"].get_area() > 0.5 * page.rect.get_area():
            continue  # page background
        is_rect = all(item[0] == "re" for item in d["items"])
        out.append((d["rect"], "caption" if is_rect else "balloon"))
    return out


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def page_lines(page: fitz.Page) -> list[tuple[fitz.Rect, str]]:
    """Every text line on the page, with outline/shadow duplicates removed.

    Lines (not blocks) are the unit: PyMuPDF sometimes merges lines from two
    neighbouring captions into one block. Spans within a line are joined
    without spaces, since they are fragments of the same run of text.
    """
    lines: list[tuple[fitz.Rect, str]] = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            text = clean("".join(s["text"] for s in line["spans"]))
            if not text:
                continue
            rect = fitz.Rect(line["bbox"])
            dup = any(t == text and abs(r.x0 - rect.x0) < 4 and abs(r.y0 - rect.y0) < 4 for r, t in lines)
            if not dup:
                lines.append((rect, text))
    return lines


def page_units(page: fitz.Page, page_id: str = "") -> list[dict]:
    shapes = containers(page)
    groups: dict[int, dict] = {}
    loose = []
    for rect, text in page_lines(page):
        centre = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
        inside = [(i, r) for i, (r, _) in enumerate(shapes) if centre in r]
        if not inside:
            loose.append({"rect": rect, "lines": [(rect, text)]})
            continue
        idx, box = min(inside, key=lambda ir: ir[1].get_area())
        g = groups.setdefault(idx, {"rect": fitz.Rect(box), "lines": [], "kind": shapes[idx][1]})
        g["lines"].append((rect, text))

    units = list(groups.values()) + merge_loose(loose)
    for u in units:
        u["lines"].sort(key=lambda rt: (round(rt[0].y0 / 6), rt[0].x0))
        u["text"] = " ".join(t for _, t in u["lines"])
        if "kind" not in u:
            u["kind"] = classify_loose(u["text"])
    # bboxes are normalised to the *published* page, which on a cropped page is
    # only part of it (common.PAGE_CROPS); lettering outside it is not published.
    _, _, w, h = crop_box(page_id, page.rect.width, page.rect.height)
    units.sort(key=lambda u: (round(u["rect"].y0 / 40), u["rect"].x0))
    return [
        {
            "t": u["text"],
            "bbox": [round(u["rect"].x0 / w, 4), round(u["rect"].y0 / h, 4),
                     round(u["rect"].x1 / w, 4), round(u["rect"].y1 / h, 4)],
            "kind": u["kind"],
        }
        for u in units
        if u["rect"].y0 < h
    ]


def classify_loose(text: str) -> str:
    """Unboxed lettering: long lowercase narration is a caption, the rest is sfx."""
    words = text.split()
    if len(words) > 5 and sum(c.islower() for c in text) > sum(c.isupper() for c in text):
        return "caption"
    return "sfx"


def merge_loose(loose: list[dict]) -> list[dict]:
    """Merge unboxed lines that touch (stacked sfx, multi-line narration)."""
    merged: list[dict] = []
    for u in sorted(loose, key=lambda u: (u["rect"].y0, u["rect"].x0)):
        near = next((m for m in merged if (m["rect"] + (-6, -6, 6, 6)).intersects(u["rect"])), None)
        if near:
            near["rect"] |= u["rect"]
            near["lines"] += u["lines"]
        else:
            merged.append(u)
    return merged


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--books")
    args = ap.parse_args()

    out_path = ASSETS / "data" / "text.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    for book in parse_books(args.books):
        doc = fitz.open(compressed_pdf(book))
        slug = BOOKS[book]["slug"]
        kinds: dict[str, int] = {}
        for i, page in enumerate(doc, start=1):
            pid = f"{slug}-p{i:03d}"
            units = page_units(page, pid)
            data[pid] = units
            for u in units:
                kinds[u["kind"]] = kinds.get(u["kind"], 0) + 1
        print(f"B{book}: {kinds}")
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
