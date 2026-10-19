"""Shared paths and helpers for the Twice Born content pipeline."""
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
ROOT = SITE.parent
BOOK_DIR = ROOT / "book"
IMAGES_DIR = ROOT / "images"
ASSETS = ROOT / "site-assets"
REPORTS = SITE / "pipeline" / "reports"

# "parts" = page counts of the part PDFs (images/book N/BNC1..C5.pdf), whose
# concatenation is exactly the book PDF.
BOOKS = {
    1: {"slug": "b1", "title": "Valley", "pages": 42, "parts": [12, 8, 6, 9, 7]},
    2: {"slug": "b2", "title": "Parchment", "pages": 34, "parts": [5, 7, 8, 6, 8]},
    3: {"slug": "b3", "title": "Leaf", "pages": 34, "parts": [9, 7, 7, 6, 5]},
    4: {"slug": "b4", "title": "Ascent", "pages": 32, "parts": [8, 9, 9, 6]},
    5: {"slug": "b5", "title": "Discovery", "pages": 29, "parts": [6, 7, 6, 5, 5]},
}


# Pages published cropped, as the fraction of the page height kept from the top.
#
# B1 p1 is the only one, and it is a defect in the source PDF rather than a
# design choice: the page holds the valley map across the top (0 to 840 pt) and
# a 1536x1024 pure-black PNG across the bottom (847.5 to 1687.5 pt), which is in
# book/B1.pdf itself and so in the printed book (design §2.1). The author chose
# to crop the page to the map (§18.3). The cut is at the map image's own bottom
# edge, 840 / 1687.5 = 0.497778, so no black pixel and no white margin survives.
#
# The crop is applied at the source - rendering, panel detection and text
# extraction all work inside it - so everything downstream, including the stored
# panel boxes and the reader, only ever sees the published page.
PAGE_CROPS = {"b1-p001": 0.497778}


def crop_box(page_id: str, width: float, height: float) -> tuple[float, float, float, float]:
    """The published area of a page, in that page's own units."""
    return (0.0, 0.0, width, height * PAGE_CROPS.get(page_id, 1.0))


def source_pdf(book: int) -> Path:
    return BOOK_DIR / f"B{book}.pdf"


def compressed_pdf(book: int) -> Path:
    return ASSETS / "pdf" / f"the-twice-born-b{book}.pdf"


def parse_books(arg: str | None) -> list[int]:
    """'1,3' -> [1, 3]; None or 'all' -> every book."""
    if not arg or arg == "all":
        return list(BOOKS)
    return [int(b) for b in arg.split(",")]
