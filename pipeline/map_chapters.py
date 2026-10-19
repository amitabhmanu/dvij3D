"""Step 0.6: find the page where each chapter starts.

The PDFs carry no chapter bookmarks, but every chapter's panel breakdown
quotes its captions and dialogue. Those quotes are fuzzy-matched against the
lettering extracted in step 0.4; a chapter starts on the first page (at or
after the previous chapter's start) where its quotes appear.

Output: site-assets/data/chapters.json
  [{"n": 0, "title": "Prologue", "book": 1, "startPage": 2, "confidence": "high", ...}]
Low-confidence starts are listed for manual review in the dev tool.
Usage: python map_chapters.py
"""
import json
import re

from rapidfuzz import fuzz

from common import ASSETS, BOOKS, IMAGES_DIR

MATCH = 85         # partial_ratio needed for a quote to count as found on a page
MIN_QUOTE_LEN = 18  # ignore short quotes ("No!") that match anywhere


def chapter_files() -> list[tuple[int, int, str]]:
    """(chapter number, book, breakdown path) for all 81 chapters, in order."""
    out = []
    for path in IMAGES_DIR.glob("book */part */chapter*/*_panel_breakdown.md"):
        book = int(re.match(r"book (\d)", path.parts[-4]).group(1))
        folder = path.parts[-2]
        n = 0 if "prologue" in folder else int(re.search(r"\d+", folder).group())
        out.append((n, book, str(path)))
    return sorted(out)


def quotes(path: str) -> list[str]:
    text = open(path, encoding="utf-8").read()
    found = re.findall(r'"([^"\n]{%d,})"' % MIN_QUOTE_LEN, text)
    return [re.sub(r"\s+", " ", q).strip(" .*") for q in found]


def page_texts(book: int) -> list[str]:
    data = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))
    slug = BOOKS[book]["slug"]
    return [" ".join(u["t"] for u in data[f"{slug}-p{i:03d}"]) for i in range(1, BOOKS[book]["pages"] + 1)]


def hits(qs: list[str], page: str) -> int:
    page = page.lower()
    return sum(fuzz.partial_ratio(q.lower(), page, score_cutoff=MATCH) > 0 for q in qs)


def main() -> None:
    pages = {b: page_texts(b) for b in BOOKS}
    result, prev_book, prev_start = [], None, 1
    for n, book, path in chapter_files():
        if book != prev_book:
            prev_book, prev_start = book, 1
        qs = quotes(path)
        # Scan forward from the previous chapter's start; stop at the first hit.
        start, best = prev_start, 0
        for p in range(prev_start, len(pages[book]) + 1):
            best = hits(qs, pages[book][p - 1])
            if best:
                start = p
                break
        confidence = "high" if best >= 2 else "low" if best == 1 else "none"
        title = "Prologue" if n == 0 else "Epilogue" if n == 80 else f"Chapter {n}"
        result.append({"n": n, "title": title, "book": book, "startPage": start,
                       "confidence": confidence, "quotes": len(qs), "hitsOnStart": best})
        prev_start = start
    (ASSETS / "data" / "chapters.json").write_text(json.dumps(result, indent=1))

    for book in BOOKS:
        row = [f"{c['n']}@p{c['startPage']}{'' if c['confidence'] == 'high' else '?'}"
               for c in result if c["book"] == book]
        print(f"B{book}: " + " ".join(row))
    low = [c["n"] for c in result if c["confidence"] != "high"]
    print(f"{len(result)} chapters; review needed for {len(low)}: {low}")


if __name__ == "__main__":
    main()
