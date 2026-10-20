"""The Professor's lodge, drawn from its plan (design §10.3).

Reads src/content/valley/lodge.yaml and draws the floor plan and the site
plan, colouring every room by where it comes from (the novel, the comic, or
ours), so the author can check the plan against the book before it is built.
Also holds the plan's checks, shared with the tests: rooms inside the house and
not overlapping, every room reachable from the front door, the study in the
north-west corner, and a source on everything.

Inputs:  src/content/valley/lodge.yaml
Output:  docs/lodge/plan.png, docs/lodge/site.png
Usage:   python lodge_plan.py
"""
from collections import deque

import yaml
from PIL import Image, ImageDraw, ImageFont

from common import SITE

LODGE_YAML = SITE / "src" / "content" / "valley" / "lodge.yaml"
OUT = SITE / "docs" / "lodge"
SCALE = 24  # px a metre on the floor plan
COLOURS = {"novel": (222, 196, 140), "comic": (176, 205, 214), "both": (190, 214, 160), "ours": (232, 228, 220)}


def load() -> dict:
    return yaml.safe_load(LODGE_YAML.read_text(encoding="utf-8"))


def provenance(sources: list[str]) -> str:
    novel = any(s.startswith("novel") for s in sources)
    comic = any(s.startswith("comic") for s in sources)
    return "both" if novel and comic else "novel" if novel else "comic" if comic else "ours"


def door_point(room: dict, d: dict) -> tuple[float, float]:
    x0, z0, x1, z1 = room["rect"]
    return {"n": (d["at"], z0), "s": (d["at"], z1), "w": (x0, d["at"]), "e": (x1, d["at"])}[d["side"]]


def problems(plan: dict) -> list[str]:
    out = []
    h = plan["house"]["outer"] / 2
    court = plan["house"]["court"] / 2
    ring = court + plan["house"]["corridor"]
    rooms = {r["id"]: r for r in plan["rooms"]}
    for r in plan["rooms"]:
        x0, z0, x1, z1 = r["rect"]
        if not (-h <= x0 < x1 <= h and -h <= z0 < z1 <= h):
            out.append(f"lodge: room {r['id']} lies outside the house")
        if max(abs(x0), abs(x1)) < ring and max(abs(z0), abs(z1)) < ring:
            out.append(f"lodge: room {r['id']} sits in the courtyard or corridor")
        if not r.get("sources"):
            out.append(f"lodge: room {r['id']} has no source")
        for d in r.get("doors", []):
            x, z = door_point(r, d)
            lo, hi = (x0, x1) if d["side"] in "ns" else (z0, z1)
            if not lo + d["width"] / 2 <= d["at"] <= hi - d["width"] / 2:
                out.append(f"lodge: a door of {r['id']} doesn't fit its wall")
    ids = list(rooms)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            ax0, az0, ax1, az1 = rooms[a]["rect"]
            bx0, bz0, bx1, bz1 = rooms[b]["rect"]
            if ax0 < bx1 and bx0 < ax1 and az0 < bz1 and bz0 < az1:
                out.append(f"lodge: rooms {a} and {b} overlap")
    # every room reachable from the front door, through doors
    links = {i: set() for i in ids}
    for r in plan["rooms"]:
        for d in r.get("doors", []):
            other = d["to"]
            if other in rooms:
                links[r["id"]].add(other)
                links[other].add(r["id"])
            elif other == "corridor":
                links[r["id"]].add("corridor")
                links.setdefault("corridor", set()).add(r["id"])
    seen, todo = {"hall"}, deque(["hall"])
    while todo:
        for n in links.get(todo.popleft(), ()):
            if n not in seen:
                seen.add(n)
                todo.append(n)
    for i in ids:
        if i not in seen:
            out.append(f"lodge: room {i} can't be reached from the front door")
    study = rooms.get("study")
    if study and not (study["rect"][0] <= -h + 0.01 and study["rect"][1] <= -h + 0.01):
        out.append("lodge: the study is not in the north-west corner (novel ¶949)")
    return out


def font(size: int):
    for name in ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def floor_plan(plan: dict) -> Image.Image:
    h = plan["house"]["outer"] / 2
    margin = 6
    size = int((2 * h + 2 * margin) * SCALE)
    img = Image.new("RGB", (size, size + 60), (250, 247, 240))
    d = ImageDraw.Draw(img)
    P = lambda x, z: ((x + h + margin) * SCALE, (z + h + margin) * SCALE)
    f, small = font(15), font(12)
    court = plan["house"]["court"] / 2
    ring = court + plan["house"]["corridor"]
    # corridor and court
    d.rectangle([P(-ring, -ring), P(ring, ring)], fill=(236, 232, 222), outline=(120, 110, 100))
    d.rectangle([P(-court, -court), P(court, court)], fill=(214, 226, 200), outline=(120, 110, 100))
    pl = plan["house"]["planter"]
    cx, cz = P(*pl["at"])
    r = pl["radius"] * SCALE
    d.ellipse([cx - r, cz - r, cx + r, cz + r], fill=(160, 190, 140), outline=(90, 110, 80))
    sp = plan["house"]["pillars"]["spacing"]
    k = -court
    while k <= court + 0.01:
        for x, z in ((k, -court), (k, court), (-court, k), (court, k)):
            px, pz = P(x, z)
            d.ellipse([px - 4, pz - 4, px + 4, pz + 4], fill=(90, 80, 70))
        k += sp
    d.text(P(-3.2, -0.6), "courtyard", fill=(70, 80, 60), font=f)
    # verandah and steps
    v = plan["verandah"]
    d.rectangle([P(v["span"][0], h), P(v["span"][1], h + v["depth"])], fill=COLOURS[provenance(v["sources"])], outline=(80, 70, 60))
    d.text(P(-2.2, h + 0.8), "verandah", fill=(40, 30, 20), font=f)
    for s in range(v["steps"]):
        y = h + v["depth"] + s * 0.45
        d.rectangle([P(-1.5, y), P(1.5, y + 0.45)], outline=(80, 70, 60))
    # rooms
    for room in plan["rooms"]:
        x0, z0, x1, z1 = room["rect"]
        d.rectangle([P(x0, z0), P(x1, z1)], fill=COLOURS[provenance(room["sources"])], outline=(60, 50, 40), width=3)
        name = room["name"] + ("  [?]" if room.get("ask") else "")
        words, lines, cur = name.split(), [], ""
        for w in words:
            if len(cur + " " + w) > (x1 - x0) * 1.9:
                lines.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        lines.append(cur)
        tx, tz = P(x0 + 0.4, z0 + 0.4)
        for i, line in enumerate(lines):
            d.text((tx, tz + i * 17), line, fill=(30, 25, 20), font=f)
        for dr in room.get("doors", []):
            x, z = door_point(room, dr)
            w2 = dr["width"] / 2
            a, b = ((x - w2, z), (x + w2, z)) if dr["side"] in "ns" else ((x, z - w2), (x, z + w2))
            d.line([P(*a), P(*b)], fill=(182, 64, 44), width=7)
        for wn in room.get("windows", []):
            x, z = door_point(room, wn)
            w2 = wn["width"] / 2
            a, b = ((x - w2, z), (x + w2, z)) if wn["side"] in "ns" else ((x, z - w2), (x, z + w2))
            d.line([P(*a), P(*b)], fill=(60, 120, 170), width=7)
    d.rectangle([P(-h, -h), P(h, h)], outline=(30, 25, 20), width=4)
    # parapet
    pa = plan["house"]["parapet"]["span"]
    d.line([P(pa[0], h - 0.3), P(pa[1], h - 0.3)], fill=(30, 25, 20), width=2)
    # compass and key
    nx, nz = P(h + 2.5, -h)
    d.polygon([(nx, nz - 30), (nx - 10, nz), (nx + 10, nz)], fill=(30, 25, 20))
    d.text((nx - 5, nz + 4), "N", fill=(30, 25, 20), font=f)
    y = size + 8
    x = 16
    for label, c in (("novel", "novel"), ("comic", "comic"), ("novel + comic", "both"), ("ours", "ours")):
        d.rectangle([x, y, x + 18, y + 18], fill=COLOURS[c], outline=(60, 50, 40))
        d.text((x + 24, y + 1), label, fill=(30, 25, 20), font=f)
        x += 150
    d.line([x, y + 9, x + 30, y + 9], fill=(182, 64, 44), width=7)
    d.text((x + 36, y + 1), "door", fill=(30, 25, 20), font=f)
    x += 100
    d.line([x, y + 9, x + 30, y + 9], fill=(60, 120, 170), width=7)
    d.text((x + 36, y + 1), "window", fill=(30, 25, 20), font=f)
    d.text((16, y + 30), "[?] where the novel and the comic disagree (see questions in lodge.yaml)   ·   1 square = 1 m: house 32 m square", fill=(90, 80, 70), font=small)
    return img


def site_plan(plan: dict) -> Image.Image:
    g = plan["grounds"]
    bx0, bz0, bx1, bz1 = g["boundary"]["rect"]
    s = 5  # px a metre
    pad = 40
    zmin = min(bz0, g["mound_path"]["to"][1] - 10)
    img = Image.new("RGB", (int((bx1 - bx0) * s + 2 * pad + 120), int((bz1 - zmin) * s + 2 * pad)), (250, 247, 240))
    d = ImageDraw.Draw(img)
    P = lambda x, z: ((x - bx0) * s + pad, (z - zmin) * s + pad)
    f = font(13)
    d.rectangle([P(bx0, bz0), P(bx1, bz1)], fill=(226, 214, 168), outline=(120, 70, 50), width=4)
    gx, gz = g["gate"]["at"]
    d.line([P(gx - g["gate"]["width"] / 2, gz), P(gx + g["gate"]["width"] / 2, gz)], fill=(250, 247, 240), width=6)
    for x in (gx - g["gate"]["width"] / 2 - 0.6, gx + g["gate"]["width"] / 2 + 0.6):
        px, pz = P(x, gz)
        d.ellipse([px - 6, pz - 6, px + 6, pz + 6], fill=(240, 236, 220), outline=(60, 50, 40))
    d.text(P(gx + 4, gz - 4), "gate", fill=(30, 25, 20), font=f)
    (x0, z0), (x1, z1) = g["drive"]["from"], g["drive"]["to"]
    w = g["drive"]["width"] / 2
    d.rectangle([P(x0 - w, z1), P(x1 + w, z0)], fill=(200, 190, 170))
    px, pz = P(*g["drive"]["planter"])
    d.ellipse([px - 12, pz - 12, px + 12, pz + 12], fill=(150, 170, 120), outline=(80, 90, 60))
    h = plan["house"]["outer"] / 2
    d.rectangle([P(-h - 2, -h - 2), P(h + 2, h + 2 + plan["verandah"]["depth"])], outline=(200, 190, 170), width=10)
    d.rectangle([P(-h, -h), P(h, h)], fill=(214, 120, 90), outline=(60, 40, 30), width=2)
    d.text(P(-8, -2), "the lodge", fill=(255, 250, 240), font=f)
    wx, wz = g["well"]["at"]
    px, pz = P(wx, wz)
    r = g["well"]["radius"] * s
    d.ellipse([px - r, pz - r, px + r, pz + r], fill=(90, 110, 130), outline=(60, 50, 40))
    d.text((px + 10, pz - 6), "well", fill=(30, 25, 20), font=f)
    for key, label in (("servant_quarters", "servant quarters"), ("kurup_shed", "Kurup's shed")):
        a, b, c, e = g[key]["rect"]
        d.rectangle([P(a, b), P(c, e)], fill=(190, 150, 120), outline=(60, 40, 30))
        d.text(P(a, b - 5), label, fill=(30, 25, 20), font=f)
    yx, yz = g["back_yard"]["at"]
    d.text(P(yx, yz), "back yard: wood pile, stump", fill=(30, 25, 20), font=f)
    (mx0, mz0), (mx1, mz1) = g["mango_grove"]["from"], g["mango_grove"]["to"]
    for i in range(int(min(mx0, mx1)), int(max(mx0, mx1)), 9):
        for j in range(int(min(mz0, mz1)), int(max(mz0, mz1)), 9):
            px, pz = P(i, j)
            d.ellipse([px - 7, pz - 7, px + 7, pz + 7], fill=(110, 140, 80))
    d.text(P(mx1 + 3, (mz0 + mz1) / 2), "mango grove", fill=(30, 25, 20), font=f)
    (ax, az), (bx, bz) = g["mound_path"]["from"], g["mound_path"]["to"]
    d.line([P(ax, az), P(bx, bz)], fill=(150, 120, 90), width=4)
    px, pz = P(bx, bz)
    d.ellipse([px - 26, pz - 18, px + 26, pz + 18], fill=(180, 150, 110), outline=(100, 80, 60))
    d.text((px + 30, pz - 6), "the mound", fill=(30, 25, 20), font=f)
    d.text(P(bx0 + 2, bz1 - 6), "brick wall with a brown-bush hedge inside it (novel ¶163)", fill=(30, 25, 20), font=f)
    nx, nz = P(bx1 + 12, zmin + 8)
    d.polygon([(nx, nz - 24), (nx - 8, nz), (nx + 8, nz)], fill=(30, 25, 20))
    d.text((nx - 4, nz + 4), "N", fill=(30, 25, 20), font=f)
    return img


def main() -> None:
    plan = load()
    bad = problems(plan)
    if bad:
        raise SystemExit("lodge.yaml has problems:\n  " + "\n  ".join(bad))
    OUT.mkdir(parents=True, exist_ok=True)
    floor_plan(plan).save(OUT / "plan.png")
    site_plan(plan).save(OUT / "site.png")
    print(f"{len(plan['rooms'])} rooms, {len(plan['questions'])} questions for the author -> docs/lodge/plan.png, site.png")


if __name__ == "__main__":
    main()
