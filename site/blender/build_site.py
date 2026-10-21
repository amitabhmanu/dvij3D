"""Build the temple site in Blender from its plan (design §10.3): Mahant's pandaal and what is
in it, the fire altar outside, and the dug-over field around them.

Run by pipeline/build_site.py, never by hand:
    blender --background --factory-startup --python blender/build_site.py -- <spec.json> <textures dir> <out.glb> <renders dir>

The spec is src/content/valley/temple-site.yaml as JSON. Frame: metres, x east, y up, z south,
origin at the middle of the tent's floor, the tent's entrance facing south (+z).

What the game reads from the file, by name (as the lodge's):
    site, furniture     what you see
    collision           what you bump into and stand on (hidden in the game)
and from the markers sidecar: arrive:site, room:tent, look:<id>, seat:<id>, mark:<id>.
"""
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402

from kit import Kit, render  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
SPEC, TEX, OUT, RENDERS = args[0], args[1], args[2], args[3]
spec = json.load(open(SPEC, encoding="utf-8"))
T = spec["tent"]
W, D = T["size"][0] / 2, T["size"][1] / 2
WALL, PEAK, DOOR = T["wall"], T["peak"], T["door"]["width"] / 2
RIDGE = W - D  # the ridge runs along x, so the canopy is a hipped roof

bpy.ops.wm.read_factory_settings(use_empty=True)
kit = Kit(TEX, {"canvas": 3.0, "carpet": 8.6, "earth": 5.0, "kund": 1.3, "durrie": 2.0, "wood": 2.0,
                "curtain": 2.0, "valance": W * 2 / 3})
rand = random.Random(9)


def materials():
    for t in ("canvas", "curtain", "carpet", "earth", "kund", "durrie", "wood"):
        kit.material(t, tex=t)
    kit.material("valance", tex="valance", alpha=True)
    kit.material("verse", tex="verse")
    kit.material("diagram", tex="diagram")
    kit.material("brass", color=(0.62, 0.42, 0.12), rough=0.35, metal=0.9)
    kit.material("cushion", color=(0.5, 0.08, 0.06), rough=0.8)
    kit.material("bolster", color=(0.55, 0.1, 0.08))
    kit.material("green-cloth", color=(0.12, 0.28, 0.18))
    kit.material("saffron", color=(0.95, 0.45, 0.08))
    kit.material("marigold", color=(0.98, 0.55, 0.05))
    kit.material("leaf", color=(0.22, 0.42, 0.12))
    kit.material("leaf-dark", color=(0.1, 0.3, 0.1))
    kit.material("betel", color=(0.18, 0.4, 0.1))
    kit.material("amber", color=(0.45, 0.22, 0.05), rough=0.1)
    kit.material("glass", color=(0.6, 0.62, 0.6), rough=0.05)
    kit.material("bark", color=(0.3, 0.2, 0.12))
    kit.material("fruit-red", color=(0.65, 0.1, 0.05))
    kit.material("fruit-yellow", color=(0.92, 0.75, 0.15))
    kit.material("basket", color=(0.55, 0.4, 0.2))
    kit.material("ash", color=(0.2, 0.17, 0.15))
    kit.material("fire", color=(1.0, 0.45, 0.08), rough=1.0, emit=6.0)
    kit.material("flame", color=(1.0, 0.8, 0.3), rough=1.0, emit=8.0)
    kit.material("spoil", color=(0.58, 0.47, 0.33))
    kit.material("stone", color=(0.55, 0.52, 0.46))
    kit.material("bone", color=(0.86, 0.82, 0.72))


# --- helpers --------------------------------------------------------------------

def rod(g, a, b, r, mat, seg=6):
    """A round rod between two points (any direction)."""
    import mathutils
    A, Bp = mathutils.Vector(a), mathutils.Vector(b)
    axis = (Bp - A).normalized()
    side = axis.cross(mathutils.Vector((0, 1, 0)) if abs(axis.y) < 0.9 else mathutils.Vector((1, 0, 0))).normalized()
    up = axis.cross(side)
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        o0 = side * math.cos(a0) * r + up * math.sin(a0) * r
        o1 = side * math.cos(a1) * r + up * math.sin(a1) * r
        om = side * math.cos((a0 + a1) / 2) + up * math.sin((a0 + a1) / 2)
        g.quad([A + o0, A + o1, Bp + o1, Bp + o0], tuple(om), mat)
        g.quad([A, A, A + o1, A + o0], tuple(-axis), mat)
        g.quad([Bp, Bp, Bp + o1, Bp + o0], tuple(axis), mat)


def table(g, col, x, z, w, d, h, mat="wood", top=None):
    g.box(x - w / 2, x + w / 2, h - 0.04, h, z - d / 2, z + d / 2, mat, top=top)
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.box(x + sx * (w / 2 - 0.06) - 0.03, x + sx * (w / 2 - 0.06) + 0.03, 0, h - 0.04,
                  z + sz * (d / 2 - 0.06) - 0.03, z + sz * (d / 2 - 0.06) + 0.03, mat)
    col.box(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, "wood")


FACE = {"n": (0, -1), "s": (0, 1), "e": (1, 0), "w": (-1, 0)}


def chair(g, col, x, z, face):
    fx, fz = FACE[face]
    g.box(x - 0.24, x + 0.24, 0.42, 0.47, z - 0.24, z + 0.24, "wood", top="cushion")
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.box(x + sx * 0.2 - 0.025, x + sx * 0.2 + 0.025, 0, 0.42, z + sz * 0.2 - 0.025, z + sz * 0.2 + 0.025, "wood")
    bx, bz = x - fx * 0.22, z - fz * 0.22  # the back, behind the sitter
    if fx:
        g.box(bx - 0.03, bx + 0.03, 0.47, 1.0, z - 0.24, z + 0.24, "wood")
    else:
        g.box(x - 0.24, x + 0.24, 0.47, 1.0, bz - 0.03, bz + 0.03, "wood")
    col.box(x - 0.26, x + 0.26, 0, 0.9, z - 0.26, z + 0.26, "wood")


# --- the tent -------------------------------------------------------------------

def tent(g, col):
    # the sides: canvas walls, the front open between its tied-back curtains
    for x0, x1, z0, z1 in ((-W, W, -D, -D), (-W, -W, -D, D), (W, W, -D, D), (-W, -DOOR, D, D), (DOOR, W, D, D)):
        n = (0, 0, -1) if z0 == z1 == -D else (0, 0, 1) if z0 == z1 else ((-1, 0, 0) if x0 == -W else (1, 0, 0))
        g.quad([(x0, 0, z0), (x1, 0, z1), (x1, WALL, z1), (x0, WALL, z0)], n, "canvas")
        col.box(min(x0, x1) - 0.05, max(x0, x1) + 0.05, 0, WALL, min(z0, z1) - 0.05, max(z0, z1) + 0.05, "canvas")
    g.quad([(-DOOR, WALL - 0.45, D), (DOOR, WALL - 0.45, D), (DOOR, WALL, D), (-DOOR, WALL, D)], (0, 0, 1), "canvas")
    # the canopy: a hipped roof, its ridge along x
    E = 0.25  # the eaves overhang
    eave = [(-W - E, WALL, -D - E), (W + E, WALL, -D - E), (W + E, WALL, D + E), (-W - E, WALL, D + E)]
    r0, r1 = (-RIDGE, PEAK, 0), (RIDGE, PEAK, 0)
    g.quad([eave[3], eave[2], r1, r0], (0, 1, 1), "canvas")      # front
    g.quad([eave[0], eave[1], r1, r0], (0, 1, -1), "canvas")     # back
    g.quad([eave[1], eave[2], r1, r1], (1, 1, 0), "canvas")      # east end
    g.quad([eave[0], eave[3], r0, r0], (-1, 1, 0), "canvas")     # west end
    # the scalloped valance hanging round the eaves (b1-p011-4)
    V = 0.6
    for a, b, n in ((eave[3], eave[2], (0, 0, 1)), (eave[0], eave[1], (0, 0, -1)), (eave[1], eave[2], (1, 0, 0)), (eave[0], eave[3], (-1, 0, 0))):
        g.quad([(a[0], WALL - V, a[2]), (b[0], WALL - V, b[2]), (b[0], WALL, b[2]), (a[0], WALL, a[2])], n, "valance",
               uv=[(0, 0), (3, 0), (3, 1), (0, 1)])
    # the verse painted on the front of the canopy (b1-p015-1): the comic's own lettering
    def on_front(u, v):  # u across (-1..1), v up the front slope (0 eave .. 1 ridge)
        y = WALL + (PEAK - WALL) * v + 0.02
        z = (D + E) * (1 - v) + 0.02
        return (u * 1.5, y, z)
    g.quad([on_front(-1, 0.18), on_front(1, 0.18), on_front(1, 0.62), on_front(-1, 0.62)], (0, 1, 1), "verse",
           uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # poles: the corners, the doorway and the ridge
    for x, z, top in ((-W, -D, WALL), (W, -D, WALL), (-W, D, WALL), (W, D, WALL), (-DOOR, D, WALL), (DOOR, D, WALL),
                      (-RIDGE, 0, PEAK), (RIDGE, 0, PEAK)):
        g.cylinder(x, z, 0.06, 0, top, "wood", seg=6)
        col.cylinder(x, z, 0.08, 0, top, "wood", seg=6)
    # the red curtains, tied back at either side of the entrance (b1-p011-4)
    for s in (-1, 1):
        x0, x1 = s * DOOR, s * (DOOR + 0.55)
        g.quad([(x0, 0, D + 0.04), (x1, 0, D + 0.04), (x1, WALL - 0.45, D + 0.04), (x0 + s * 0.25, WALL - 0.45, D + 0.04)],
               (0, 0, 1), "curtain")
        g.cylinder(s * (DOOR + 0.3), D + 0.06, 0.08, 1.1, 1.2, "brass", seg=6)  # the tie
    # the saffron pennants on the roof (b1-p015-1)
    for i in range(T.get("flags", 2)):
        x = -RIDGE + (2 * RIDGE) * i / max(1, T["flags"] - 1)
        g.cylinder(x, 0, 0.03, PEAK, PEAK + 1.3, "wood", seg=5)
        g.quad([(x, PEAK + 1.3, 0), (x, PEAK + 0.9, 0), (x + 0.7, PEAK + 1.05, 0), (x + 0.7, PEAK + 1.05, 0)], (0, 0, 1), "saffron")


# --- inside ----------------------------------------------------------------------

def inside(g, col):
    for it in spec["inside"]:
        k = it["kind"]
        if k == "carpet":
            x0, z0, x1, z1 = it["rect"]
            g.quad([(x0, 0.015, z0), (x1, 0.015, z0), (x1, 0.015, z1), (x0, 0.015, z1)], (0, 1, 0), "carpet",
                   uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
            continue
        x, z = it["at"] if isinstance(it.get("at"), list) else (0, 0)
        if k == "divan":
            w, d = it["size"]
            g.box(x - w / 2, x + w / 2, 0, 0.32, z - d / 2, z + d / 2, "wood")
            g.box(x - w / 2 + 0.03, x + w / 2 - 0.03, 0.32, 0.46, z - d / 2 + 0.03, z + d / 2 - 0.03, "cushion")
            g.box(x - w / 2, x + w / 2, 0.32, 0.85, z - d / 2, z - d / 2 + 0.14, "cushion")  # its padded back
            for s in (-1, 1):  # round bolsters at each end
                rod(g, (x + s * (w / 2 - 0.15), 0.6, z - d / 2 + 0.1), (x + s * (w / 2 - 0.15), 0.6, z + d / 2 - 0.1), 0.14, "bolster", seg=8)
            col.box(x - w / 2, x + w / 2, 0, 0.6, z - d / 2, z + d / 2, "wood")
        elif k == "bolster":  # the "fattish masnad" he leans on (novel ¶296)
            rod(g, (x - 0.35, 0.62, z), (x + 0.35, 0.62, z), 0.2, "green-cloth", seg=10)
        elif k == "chair":
            chair(g, col, x, z, it["face"])
        elif k == "low-table":
            w, d = it["size"]
            table(g, col, x, z, w, d, 0.42)
        elif k == "diagram":
            g.quad([(x - 0.42, 0.43, z - 0.3), (x + 0.42, 0.43, z - 0.3), (x + 0.42, 0.43, z + 0.3), (x - 0.42, 0.43, z + 0.3)],
                   (0, 1, 0), "diagram", uv=[(0, 1), (1, 1), (1, 0), (0, 0)])
        elif k == "paan-tray":
            g.cylinder(x, z, 0.17, 0.42, 0.45, "brass", seg=12)
            for i in range(6):
                a = i * math.pi / 3
                g.box(x + 0.09 * math.cos(a) - 0.035, x + 0.09 * math.cos(a) + 0.035, 0.45, 0.48,
                      z + 0.09 * math.sin(a) - 0.035, z + 0.09 * math.sin(a) + 0.035, "betel")
        elif k == "bottle":
            g.cylinder(x, z, 0.045, 0.42, 0.66, "amber", seg=8)
            g.cylinder(x, z, 0.016, 0.66, 0.74, "amber", seg=6)
            for dx in (0.16, 0.26):
                g.cylinder(x + dx, z + 0.05, 0.03, 0.42, 0.5, "glass", seg=8)
        elif k == "chest":  # where the bottle comes from (novel ¶228)
            g.box(x - 0.45, x + 0.45, 0, 0.5, z - 0.25, z + 0.25, "wood")
            for dx in (-0.3, 0.3):
                g.box(x + dx - 0.03, x + dx + 0.03, 0, 0.51, z - 0.26, z + 0.26, "brass")
            col.box(x - 0.45, x + 0.45, 0, 0.5, z - 0.25, z + 0.25, "wood")
        elif k == "lamp-table":
            table(g, col, x, z, 0.6, 0.45, 0.6)
            g.cylinder(x, z, 0.07, 0.6, 0.63, "brass", seg=8)
            g.cylinder(x, z, 0.02, 0.63, 0.95, "brass", seg=6)
            g.cylinder(x, z, 0.09, 0.95, 0.98, "brass", seg=8)
            g.sphere(x, 1.02, z, 0.025, "flame", seg=6)
        elif k == "cabinet":
            g.box(x - 0.5, x + 0.5, 0, 1.8, z - 0.22, z + 0.22, "wood")
            col.box(x - 0.5, x + 0.5, 0, 1.8, z - 0.22, z + 0.22, "wood")
        elif k == "marigolds":
            g.cylinder(x, z, 0.12, 0, 0.35, "brass", seg=10, r1=0.07)
            g.cylinder(x, z, 0.07, 0.35, 0.45, "brass", seg=10, r1=0.1)
            for i in range(7):
                g.sphere(x + rand.uniform(-0.15, 0.15), 0.55 + rand.uniform(0, 0.25), z + rand.uniform(-0.15, 0.15), 0.07, "marigold", seg=6)
        elif k == "verse":  # hung on the tent wall (b1-p014-5)
            zc = -D + 0.03
            g.quad([(it["at"] - 0.8, 1.2, zc), (it["at"] + 0.8, 1.2, zc), (it["at"] + 0.8, 2.2, zc), (it["at"] - 0.8, 2.2, zc)],
                   (0, 0, 1), "verse", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])


# --- outside ---------------------------------------------------------------------

def outside(g, col):
    for it in spec["outside"]:
        k = it["kind"]
        if k == "altar":  # the square fire altar with its white zigzag (b1-p015-1)
            x, z = it["at"]
            s = it["size"] / 2
            g.box(x - s - 0.25, x + s + 0.25, 0, 0.12, z - s - 0.25, z + s + 0.25, "kund")  # its base step
            for (x0, x1, z0, z1) in ((x - s, x + s, z - s, z - s + 0.2), (x - s, x + s, z + s - 0.2, z + s),
                                     (x - s, x - s + 0.2, z - s, z + s), (x + s - 0.2, x + s, z - s, z + s)):
                g.box(x0, x1, 0.12, 0.6, z0, z1, "kund")
            g.box(x - s + 0.2, x + s - 0.2, 0.12, 0.35, z - s + 0.2, z + s - 0.2, "ash")
            for i in range(9):  # the fire
                fx, fz = x + rand.uniform(-0.3, 0.3), z + rand.uniform(-0.3, 0.3)
                h = rand.uniform(0.5, 1.0)
                g.cylinder(fx, fz, rand.uniform(0.08, 0.16), 0.35, 0.35 + h, "fire" if i % 3 else "flame", seg=5, r1=0.0, cap=False)
            col.box(x - s - 0.25, x + s + 0.25, 0, 0.6, z - s - 0.25, z + s + 0.25, "kund")
        elif k == "totem":  # "made of five kinds of leaves" (novel ¶320, b1-p015-1)
            x, z = it["at"]
            g.cylinder(x, z, 0.035, 0, 3.6, "wood", seg=6)
            col.cylinder(x, z, 0.06, 0, 3.6, "wood", seg=6)
            for i, (y, w, mat) in enumerate(((3.3, 0.45, "leaf"), (2.75, 0.4, "leaf-dark"), (2.2, 0.5, "leaf"),
                                              (1.7, 0.35, "leaf-dark"), (1.0, 0.6, "leaf"))):
                a = i * 1.3
                cx, cz = math.cos(a) * 0.02, math.sin(a) * 0.02
                g.quad([(x + cx - w, y, z + cz), (x + cx, y - w * 0.9, z + cz), (x + cx + w, y, z + cz), (x + cx, y + w * 0.9, z + cz)],
                       (math.sin(a), 0, math.cos(a)), mat)
        elif k == "tree":
            x, z = it["at"]
            g.cylinder(x, z, 0.12, 0, 2.6, "bark", seg=7, r1=0.08)
            col.cylinder(x, z, 0.16, 0, 2.6, "bark", seg=7)
            for dx, dy, dz, r in ((0, 3.2, 0, 1.2), (0.7, 2.8, 0.3, 0.9), (-0.6, 2.9, -0.4, 0.9), (0.2, 3.8, -0.2, 0.8)):
                g.sphere(x + dx, dy, z + dz, r, "leaf-dark", seg=8, squash=0.8)
        elif k == "offerings":  # fruit, flowers and brass pots by the altar (b1-p015-1, b1-p015-5)
            x, z = it["at"]
            for i, (dx, dz) in enumerate(((0, 0), (0.6, 0.1), (-0.6, -0.1), (0.25, 0.55), (-0.3, 0.6))):
                g.cylinder(x + dx, z + dz, 0.22, 0, 0.12, "basket", seg=10, r1=0.26)
                for j in range(5):
                    mat = ("fruit-red", "fruit-yellow", "marigold")[(i + j) % 3]
                    g.sphere(x + dx + rand.uniform(-0.12, 0.12), 0.16, z + dz + rand.uniform(-0.12, 0.12), 0.06, mat, seg=6)
            for dx in (1.0, 1.25, -1.0):
                g.sphere(x + dx, 0.14, z - 0.4, 0.14, "brass", seg=8, squash=0.9)
                g.cylinder(x + dx, z - 0.4, 0.05, 0.24, 0.34, "brass", seg=6, r1=0.07)
        elif k == "seat":  # a square cushion on the ground
            x, z = it["at"]
            g.box(x - 0.3, x + 0.3, 0, 0.08, z - 0.3, z + 0.3, "cushion")
        elif k == "durrie":
            x0, z0, x1, z1 = it["rect"]
            g.quad([(x0, 0.01, z0), (x1, 0.01, z0), (x1, 0.01, z1), (x0, 0.01, z1)], (0, 1, 0), "durrie")
        elif k == "flags":
            for x, z in it["points"]:
                g.cylinder(x, z, 0.04, 0, 4.0, "wood", seg=5)
                col.cylinder(x, z, 0.07, 0, 4.0, "wood", seg=5)
                g.quad([(x, 4.0, z), (x, 3.4, z), (x + 0.9, 3.7, z), (x + 0.9, 3.7, z)], (0, 0, 1), "saffron")
        elif k == "heaps":  # the field dug over in the Shalyodhara (novel ¶224): heaps of earth, stones, a bone or two
            x0, z0, x1, z1 = it["rect"]
            clear = it.get("keep_clear", [])
            n = 0
            while n < it["count"]:
                x, z = rand.uniform(x0, x1), rand.uniform(z0, z1)
                if any(a <= x <= c and b <= z <= d for a, b, c, d in clear) or (abs(x) < W + 3 and abs(z) < D + 3):
                    continue
                r = rand.uniform(0.6, 1.4)
                g.sphere(x, 0, z, r, "spoil", seg=8, squash=0.45)
                for _ in range(4):
                    g.sphere(x + rand.uniform(-r, r), 0.05, z + rand.uniform(-r, r), rand.uniform(0.08, 0.2), "stone", seg=5)
                if n % 5 == 0:
                    g.box(x + r, x + r + 0.35, 0, 0.05, z, z + 0.06, "bone")
                col.box(x - r * 0.7, x + r * 0.7, 0, r * 0.45, z - r * 0.7, z + r * 0.7, "spoil")
                n += 1


def ground(g, col):
    x0, z0, x1, z1 = spec["ground"]["pad"]
    g.quad([(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)], (0, 1, 0), "earth")
    col.quad([(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)], (0, 1, 0), "earth")


def markers():
    for m in spec["markers"]:
        x, z = m["at"]
        props = {k: v for k, v in m.items() if k in ("heading", "label")}
        kit.empty(("arrive:site" if m["id"] == "arrive" else f"mark:{m['id']}"), x, 0, z, **props)
    kit.empty("room:tent", 0, 1.0, 0, kind="room", label="Mahant's pandaal", rect=json.dumps([-W, -D, W, D]))
    for it in spec["outside"]:
        if it["kind"] == "seat":
            kit.empty(f"seat:{it['id']}", it["at"][0], 0.08, it["at"][1], face=it["face"])
    alt = next(i for i in spec["outside"] if i["kind"] == "altar")
    kit.empty("look:altar", alt["at"][0], 0.8, alt["at"][1], kind="look", label="The fire altar",
              text='"An altar had been set with a fire already burning. A totem rose at its side, appeared to be made of five kinds of leaves."',
              pages=["b1-p015"])
    dg = next(i for i in spec["inside"] if i["kind"] == "diagram")
    kit.empty("look:diagram", dg["at"][0], 0.6, dg["at"][1], kind="look", label="The temple's plan",
              text='"A large sheet of paper lay over a table, with a large diagram and text written around it."',
              pages=["b1-p014"])


def main():
    materials()
    site, furniture, col = kit.geo(), kit.geo(), kit.geo()
    ground(site, col)
    tent(site, col)
    inside(furniture, col)
    outside(furniture, col)
    site.to_object("site")
    furniture.to_object("furniture")
    c = col.to_object("collision")
    c["kind"] = "collision"
    markers()
    if RENDERS != "-":
        render({
            "field": ((-14, 1.7, 26), (2, 2.0, 0)),          # comic b1-p011-4: the tent on the stony field
            "inside": ((-1.2, 1.6, 2.6), (1.4, 0.7, -2.4)),   # comic b1-p014-1: the divan, the table, the chairs
            "altar": ((-6, 1.7, 7), (1, 0.8, 15)),            # comic b1-p015-1: the altar before the tent
            "plain": ((-30, 1.7, 40), (8, 2, 2)),             # comic b1-p015-10: the tent small on the plain
        }, f"{RENDERS}/site")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, export_image_format="WEBP", use_selection=False)
    json.dump(kit.markers, open(OUT + ".markers.json", "w", encoding="utf-8"), indent=1)
    print(f"SITE OK {OUT}")


main()
