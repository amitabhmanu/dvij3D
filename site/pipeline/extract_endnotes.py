"""Step 0.9: turn the manuscript's endnotes into draft Codex entries.

Reads word/endnotes.xml from book/The Twice Born.docx. Paragraphs become
Markdown paragraphs, Word tables become Markdown tables, and embedded images
(EMF diagrams the browser can't show) become a TODO pointing at the matching
images/artifacts diagram. Each draft also records the manuscript sentence the
endnote is attached to, so find_page.py can locate it in the comic.

Devanagari in the notes is set in a legacy 8-bit font, so its runs hold Latin
bytes rather than letters. Those runs are decoded by legacy_devanagari; a byte
with no mapping is left as it stands and reported at the end, never passed off
as text. Extracting without this produced "f, F, d, D, E" where the tattva
table has क ख ग घ ङ.

Output: src/content/codex/_drafts/NN-<slug>.md  (draft: true; edit, then move up)
Usage: python extract_endnotes.py
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter

from common import BOOK_DIR, SITE
from legacy_devanagari import decode, is_legacy, is_unmapped_legacy

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
DOCX = BOOK_DIR / "The Twice Born.docx"
OUT = SITE / "src" / "content" / "codex" / "_drafts"

# Titles for the 13 endnotes, in order (the notes themselves have no headings).
TITLES = [
    "Vaastu Purusha Mandala", "Ashtadhyayi", "The Vedic Mathematics shloka",
    "Dikpalas", "Lakshmi's symbol", "Nakshatras", "Stages of Shaivite renunciation",
    "Chakras and tattvas", "Kanchukas", "Bija mantras", "Periodic Table of the Tattvas",
    "Navagrahas and Navratnas", "Gnomon",
]


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# Legacy-font bytes this run of the script could not decode, as
# {byte: an endnote title}. main() reports them; they are never silently kept.
UNMAPPED: dict[str, str] = {}
# Table cells that hold only a picture, as a list of endnote titles.
IMAGE_CELLS: list[str] = []
_current_note = "?"


def run_font(r: ET.Element) -> str | None:
    rpr = r.find(f"{W}rPr")
    if rpr is None:
        return None
    fonts = rpr.find(f"{W}rFonts")
    if fonts is None:
        return None
    return fonts.get(f"{W}ascii") or fonts.get(f"{W}hAnsi") or fonts.get(f"{W}cs")


def text_of(el: ET.Element) -> str:
    """Text of an element, run by run, decoding legacy Devanagari as it goes.

    Run by run rather than straight over w:t, because the font that says how to
    read the bytes lives on the run.
    """
    parts = []
    for r in el.iter(f"{W}r"):
        t = "".join(x.text or "" for x in r.iter(f"{W}t"))
        if not t:
            continue
        font = run_font(r)
        if is_legacy(font):
            t, unknown = decode(t)
            for byte in unknown:
                UNMAPPED.setdefault(byte, _current_note)
        elif is_unmapped_legacy(font):
            # A legacy font with no mapping. Decoding it against Webdunia's
            # tables would invent letters, so the bytes stand and are reported.
            UNMAPPED.setdefault(f"{t} [{font}]", _current_note)
        parts.append(t)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def cell_md(tc: ET.Element) -> str:
    """One table cell. A cell holding only a picture has no text to give.

    The Nakshatras table keeps its Devanagari syllables this way - 27 cells that
    are each an image - so returning "" would quietly drop a whole column. The
    cell is marked instead, and main() says how many there were.
    """
    text = text_of(tc).replace("|", "/")
    if not text and any(el.tag.endswith("}drawing") or el.tag.endswith("}pict") for el in tc.iter()):
        IMAGE_CELLS.append(_current_note)
        return "<!-- image -->"
    return text


def table_md(tbl: ET.Element) -> str:
    rows = [[cell_md(c) for c in tr.findall(f"{W}tc")] for tr in tbl.findall(f"{W}tr")]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def note_body(note: ET.Element) -> str:
    parts = []
    for child in note:
        if child.tag == f"{W}p":
            has_image = any(el.tag.endswith("}drawing") or el.tag.endswith("}pict") for el in child.iter())
            t = text_of(child)
            if t:
                parts.append(t)
            if has_image:
                parts.append("<!-- TODO: diagram in the manuscript (EMF); use the matching images/artifacts image -->")
        elif child.tag == f"{W}tbl":
            parts.append(table_md(child))
    return "\n\n".join(p for p in parts if p)


def anchors(doc_xml: str) -> dict[str, str]:
    """endnote id -> the sentence it is attached to in the manuscript."""
    root = ET.fromstring(doc_xml)
    out = {}
    for p in root.iter(f"{W}p"):
        refs = [r.get(f"{W}id") for r in p.iter(f"{W}endnoteReference")]
        if refs:
            para = text_of(p)
            for rid in refs:
                out[rid] = para[-240:]
    return out


def main() -> None:
    with zipfile.ZipFile(DOCX) as z:
        notes_xml = z.read("word/endnotes.xml")
        doc_xml = z.read("word/document.xml").decode("utf-8")
    where = anchors(doc_xml)
    notes = [n for n in ET.fromstring(notes_xml).findall(f"{W}endnote")
             if n.get(f"{W}type") not in ("separator", "continuationSeparator") and text_of(n)]
    OUT.mkdir(parents=True, exist_ok=True)
    global _current_note
    # Selecting the notes above already ran text_of over all of them, with no
    # title to attribute anything to. Drop that pass's findings; the titled loop
    # below covers the same text and can say where each byte came from.
    UNMAPPED.clear()
    IMAGE_CELLS.clear()
    for i, (note, title) in enumerate(zip(notes, TITLES), start=1):
        _current_note = title
        slug = slugify(title)
        body = note_body(note)
        anchor = where.get(note.get(f"{W}id"), "").replace('"', "'")
        front = (f"---\nid: {slug}\ntitle: \"{title}\"\ndraft: true\nsource: endnote-{i}\n"
                 f"summary: \"\"\nrelated: []\nfirstSeen: null  # fill with find_page.py using manuscriptAnchor\n"
                 f"manuscriptAnchor: \"{anchor}\"\n---\n\n")
        (OUT / f"{i:02d}-{slug}.md").write_text(front + body + "\n", encoding="utf-8")
        print(f"{i:02d} {title:34s} {len(body.split()):4d} words  tables={body.count(chr(10) + '|---')}")
    if len(notes) != len(TITLES):
        print(f"WARNING: {len(notes)} endnotes found, {len(TITLES)} titles defined")
    if IMAGE_CELLS:
        print("\nNOTE: table cells holding only a picture, so the draft has no text for them:")
        for title, n in Counter(IMAGE_CELLS).items():
            print(f"  {n} cell(s) in {title}")
    if UNMAPPED:
        print(f"\nWARNING: {len(UNMAPPED)} legacy-font run(s) with no mapping. They are "
              f"left as the source has them; see legacy_devanagari.py:")
        for byte, where in sorted(UNMAPPED.items()):
            print(f"  {byte!r} in {where}")


if __name__ == "__main__":
    main()
