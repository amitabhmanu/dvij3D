"""Gather what the book says and draws about the Professor's lodge, for the
lodge's floor plan and model (design §10.3).

- The novel (book/The Twice Born.docx): every paragraph that names the lodge
  or one of its parts, quoted with its paragraph number.
- The comic: every panel whose description (the reviewed alt text in the
  manifests) shows the lodge or one of its parts, cropped from the page.

Inputs:  book/The Twice Born.docx, src/content/manifests/*.json, site-assets/master/<page>.png
Output:  docs/lodge-reference.md, docs/lodge/panels/<page>-<n>.jpg
Usage:   python lodge_reference.py
"""
import json
import re
import zipfile

from PIL import Image

from common import ASSETS, BOOK_DIR, SITE

DOCS = SITE / "docs"
PANELS = DOCS / "lodge" / "panels"
NOVEL = BOOK_DIR / "The Twice Born.docx"

# Words that mark a passage or panel as being about the lodge or its parts.
NOVEL_WORDS = re.compile(r"\blodge\b|\bcourtyard\b|pillared corridor|\bverandah?s?\b|servant quarters|"
                         r"Professor.s study|\bthe study\b|kitchen|\bthe well\b|cast-iron gate|main gate|mango", re.I)
PANEL_WORDS = re.compile(r"\blodge\b|\bcourtyard\b|\bveranda|\bverandah|\bstudy\b|\bkitchen\b|\bgate|"
                         r"\bthe well\b|by the well|god-prints|\bthe drive\b|white house|colonial house", re.I)
# Places with gates and wells that are not the lodge's.
NOT_LODGE = re.compile(r"fort|temple gate|stepwell|cave", re.I)


def novel_paragraphs() -> list[str]:
    xml = zipfile.ZipFile(NOVEL).read("word/document.xml").decode("utf8")
    paras = [re.sub(r"<[^>]+>", "", p).strip() for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)]
    return [p for p in paras if p]


def lodge_panels() -> list[dict]:
    out = []
    for f in sorted((SITE / "src" / "content" / "manifests").glob("*.json")):
        for page in json.loads(f.read_text(encoding="utf-8"))["pages"]:
            for n, panel in enumerate(page.get("panels") or [], 1):
                alt = panel.get("alt") or ""
                if PANEL_WORDS.search(alt) and not NOT_LODGE.search(alt):
                    out.append({"page": page["id"], "n": n, "box": panel["box"], "alt": alt})
    return out


def crop(p: dict) -> str:
    img = Image.open(ASSETS / "master" / f"{p['page']}.png").convert("RGB")
    w, h = img.size
    x0, y0, x1, y1 = p["box"]
    c = img.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
    c.thumbnail((640, 640))
    PANELS.mkdir(parents=True, exist_ok=True)
    name = f"{p['page']}-{p['n']}.jpg"
    c.save(PANELS / name, quality=78, optimize=True)
    return name


def main() -> None:
    paras = novel_paragraphs()
    passages = [(i, t) for i, t in enumerate(paras) if NOVEL_WORDS.search(t)]
    panels = lodge_panels()
    for old in PANELS.glob("*.jpg") if PANELS.exists() else []:
        old.unlink()
    lines = [
        "# The Professor's lodge: what the book says and draws",
        "",
        "Gathered by `pipeline/lodge_reference.py` for the lodge's floor plan and model (design §10.3). "
        "Every room, door and feature in `src/content/valley/lodge.yaml` cites one of these, or is marked *ours*.",
        "",
        f"## The novel: {len(passages)} passages",
        "",
        "Paragraph numbers index the text of `book/The Twice Born.docx`.",
        "",
    ]
    for i, t in passages:
        lines += [f"**¶{i}.** {t}", ""]
    lines += [f"## The comic: {len(panels)} panels", ""]
    for p in panels:
        name = crop(p)
        lines += [f"**{p['page']} panel {p['n']}.** {p['alt']}", "", f"![{p['page']} panel {p['n']}](lodge/panels/{name})", ""]
    (DOCS / "lodge-reference.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(passages)} novel passages and {len(panels)} comic panels -> docs/lodge-reference.md")


if __name__ == "__main__":
    main()
