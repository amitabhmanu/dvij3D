"""Step 0.7: merge pipeline outputs and human corrections into one manifest per book.

Inputs (site-assets/data/ + pages/variants.json):
  variants.json  page image files     (make_variants.mjs)
  text.json      lettering units      (extract_text.py)
  panels.json    draft panel boxes    (detect_panels.py)
  chapters.json  chapter start pages  (map_chapters.py)
Corrections (src/content/corrections/, written by the dev review tool, in git):
  panels.json    {"b1-p004": {"panels": [[x0,y0,x1,y1], ...], "alt": ["...", ...]}}
  chapters.json  {"23": 37}   chapter number -> corrected start page

Output: src/content/manifests/b{1..5}.json
Usage: python build_manifests.py
"""
import json

from common import ASSETS, BOOKS, SITE, compressed_pdf

DATA = ASSETS / "data"
CORRECTIONS = SITE / "src" / "content" / "corrections"
OUT = SITE / "src" / "content" / "manifests"


def load(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def order_text(units: list[dict], panels: list[list[float]]) -> list[dict]:
    """Attach each lettering unit to the panel containing its centre, then sort
    by panel reading order (units outside every panel keep their page position)."""
    def panel_of(u):
        cx, cy = (u["bbox"][0] + u["bbox"][2]) / 2, (u["bbox"][1] + u["bbox"][3]) / 2
        for i, (x0, y0, x1, y1) in enumerate(panels):
            if x0 <= cx <= x1 and y0 <= cy <= y1:
                return i
        return None

    out = []
    for u in units:
        p = panel_of(u)
        out.append({**u, "panel": p})
    return sorted(out, key=lambda u: (u["panel"] if u["panel"] is not None else 99,
                                      round(u["bbox"][1], 2), u["bbox"][0]))


def main() -> None:
    variants = load(ASSETS / "pages" / "variants.json", {})
    text = load(DATA / "text.json", {})
    panels = load(DATA / "panels.json", {})
    chapters = load(DATA / "chapters.json", [])
    fixed_panels = load(CORRECTIONS / "panels.json", {})
    fixed_chapters = load(CORRECTIONS / "chapters.json", {})
    OUT.mkdir(parents=True, exist_ok=True)

    missing = []
    for book, meta in BOOKS.items():
        slug = meta["slug"]
        parts, start = [], 1
        for n, count in enumerate(meta["parts"], start=1):
            parts.append({"n": n, "startPage": start, "endPage": start + count - 1})
            start += count

        pages = []
        for n in range(1, meta["pages"] + 1):
            pid = f"{slug}-p{n:03d}"
            v = variants.get(pid)
            if not v:
                missing.append(pid)
                continue
            fix = fixed_panels.get(pid, {})
            boxes = fix.get("panels", panels.get(pid, []))
            alt = fix.get("alt", [])
            pages.append({
                "n": n,
                "id": pid,
                "w": v["w"],
                "h": v["h"],
                "src": v["files"],
                "panels": [{"box": b, "alt": alt[i] if i < len(alt) else ""} for i, b in enumerate(boxes)],
                "text": order_text(text.get(pid, []), boxes),
                "reviewed": pid in fixed_panels,
            })

        book_chapters = []
        for c in chapters:
            if c["book"] != book:
                continue
            start_page = fixed_chapters.get(str(c["n"]), c["startPage"])
            book_chapters.append({"n": c["n"], "title": c["title"], "startPage": start_page,
                                  "confirmed": str(c["n"]) in fixed_chapters or c["confidence"] == "high"})

        pdf = compressed_pdf(book)
        manifest = {
            "book": book,
            "slug": slug,
            "title": meta["title"],
            "pageCount": meta["pages"],
            "cover": f"{slug}-p001",
            "pdf": {"file": f"pdf/{pdf.name}", "bytes": pdf.stat().st_size if pdf.exists() else None},
            "parts": parts,
            "chapters": book_chapters,
            "pages": pages,
        }
        (OUT / f"{slug}.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        reviewed = sum(p["reviewed"] for p in pages)
        print(f"B{book}: {len(pages)}/{meta['pages']} pages, {sum(len(p['panels']) for p in pages)} panels, "
              f"{len(book_chapters)} chapters, {reviewed} pages reviewed")
    if missing:
        print(f"WARNING: {len(missing)} pages have no image variants yet (first: {missing[0]})")


if __name__ == "__main__":
    main()
