"""Step 0.10: find where a manuscript passage appears in the comic.

1. Fuzzy-find the passage in the manuscript; the chapter it falls in comes from
   the table-of-contents bookmarks (_Toc...) that mark each chapter heading.
2. Within that chapter's pages, pick the page whose lettering best matches the
   passage; comic captions are abridged, so if nothing matches well, fall back
   to the chapter's first page.

Chapter ranges come from site-assets/data/chapters.json with the reviewed
corrections in src/content/corrections/chapters.json applied on top, so a
lookup lands in the same chapter the reader sees in the manifests.

Used to fill firstSeen, puzzle unlock points and rail anchors.
Usage: python find_page.py "Anahata! I can hear the sound of the unstruck" ["another quote" ...]
       python find_page.py --json "quote"   (machine-readable output)
"""
import json
import re
import sys
import zipfile
from functools import lru_cache

from rapidfuzz import fuzz

from common import ASSETS, BOOK_DIR, BOOKS, SITE

PAGE_MATCH = 70  # partial_ratio needed to trust a page-level match
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


@lru_cache
def manuscript() -> tuple[list[str], list[tuple[int, int]]]:
    """(paragraph texts, [(first paragraph index, chapter number), ...])."""
    xml = zipfile.ZipFile(BOOK_DIR / "The Twice Born.docx").read("word/document.xml").decode("utf-8")
    raw = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)
    paras = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", p)).strip() for p in raw]
    marks = []
    for i, p in enumerate(raw):
        marks += [(i, name) for name in re.findall(r'w:bookmarkStart[^>]*w:name="(_Toc\d+)"', p)]
    marks.sort()
    # Bookmarks run chapter 1..79, Epilogue (80), Notes. The Prologue has none.
    starts = [(paras.index("Prologue"), 0)] + [(i, n) for n, (i, _) in enumerate(marks[:80], start=1)]
    return paras, starts


@lru_cache
def comic() -> tuple[tuple[dict, ...], dict]:
    chapters = json.loads((ASSETS / "data" / "chapters.json").read_text())
    fixed_path = SITE / "src" / "content" / "corrections" / "chapters.json"
    fixed = json.loads(fixed_path.read_text(encoding="utf-8")) if fixed_path.exists() else {}
    for c in chapters:
        if str(c["n"]) in fixed:
            c["startPage"] = fixed[str(c["n"])]
    text = json.loads((ASSETS / "data" / "text.json").read_text(encoding="utf-8"))
    return tuple(chapters), text


def chapter_of(quote: str) -> tuple[int, int]:
    """(chapter number, match score) for the manuscript paragraph best matching quote."""
    paras, starts = manuscript()
    body_start = starts[0][0]
    q = quote.lower()
    best_i, best = body_start, 0
    for i in range(body_start, len(paras)):
        if len(paras[i]) < 3:
            continue
        s = fuzz.partial_ratio(q, paras[i].lower(), score_cutoff=best)
        if s > best:
            best_i, best = i, s
    chapter = max(n for first, n in starts if first <= best_i)
    return chapter, round(best)


def find(quote: str) -> dict:
    # manuscript() strips tags with a regex, which throws away the font a run was
    # set in, so the handful of Devanagari passages in the docx reach it as the
    # legacy bytes described in legacy_devanagari.py - "the letter व" reads as
    # "the letter J". A quote carrying Devanagari therefore cannot match, and
    # would otherwise fail quietly as a low-confidence fall back to the chapter's
    # first page. Say so instead.
    if DEVANAGARI.search(quote):
        print("WARNING: this quote contains Devanagari, which the manuscript stores as "
              "legacy font bytes. The match will be unreliable; search on the surrounding "
              "English instead.", file=sys.stderr)
    chapter, ms_score = chapter_of(quote)
    chapters, text = comic()
    ch = next(c for c in chapters if c["n"] == chapter)
    nxt = next((c for c in chapters if c["n"] == chapter + 1 and c["book"] == ch["book"]), None)
    last = nxt["startPage"] if nxt else BOOKS[ch["book"]]["pages"]
    slug = BOOKS[ch["book"]]["slug"]
    scored = []
    for page in range(ch["startPage"], last + 1):
        lettering = " ".join(u["t"] for u in text[f"{slug}-p{page:03d}"]).lower()
        scored.append((fuzz.partial_ratio(quote.lower(), lettering), page))
    score, page = max(scored) if scored else (0, ch["startPage"])
    if score < PAGE_MATCH:
        page = ch["startPage"]
    return {
        "quote": quote[:80],
        "chapter": chapter,
        "book": ch["book"],
        "page": page,
        "pageId": f"{slug}-p{page:03d}",
        "manuscriptScore": ms_score,
        "pageScore": round(score),
        "confidence": "high" if ms_score >= 90 and score >= PAGE_MATCH else "chapter-only" if ms_score >= 90 else "low",
    }


def main() -> None:
    args = sys.argv[1:]
    as_json = "--json" in args
    quotes = [a for a in args if a != "--json"]
    if not quotes:
        print(__doc__)
        return
    results = [find(q) for q in quotes]
    if as_json:
        print(json.dumps(results, indent=1, ensure_ascii=False))
        return
    for r in results:
        print(f"ch{r['chapter']:>2}  B{r['book']} p{r['page']:<3} [{r['confidence']}] "
              f"(manuscript {r['manuscriptScore']}, page {r['pageScore']})  {r['quote']}")


if __name__ == "__main__":
    main()
