"""Build the Professor's lodge in Blender from its plan (design §10.3).

Run by pipeline/build_lodge.py, never by hand:
    blender --background --factory-startup --python blender/build_lodge.py -- <spec.json> <textures dir> <out.glb> <renders dir>

The spec is src/content/valley/lodge.yaml as JSON. Everything is built from it
and from the textures pipeline/lodge_textures.py makes, so a change to the plan
is a rebuild, not an edit in Blender.

Frame: the plan's own, metres, +x east, +z south, y up, origin at the centre
of the courtyard; Blender's is +x east, +y north, z up, so a plan point
(x, y, z) is Blender (x, -z, y). The glTF export turns that back into the
game's frame (x east, y up, z south).

What the game reads from the file, by name:
    house, grounds, furniture   what you see
    collision                   what you bump into and stand on (hidden in the game)
    door:<room>:<n>[:L|R]       door leaves, origin at the hinge, swing about y
    look:<id>                   things to look at (custom props: label, room)
    room:<id>                   room volumes, for knowing you're indoors (props: rect)
    arrive:<id>                 where fast travel puts you
    spoiler:<id>                shown only to readers who have reached it (props: page)
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
SPEC, TEX, OUT, RENDERS = args[0], args[1], args[2], args[3]
spec = json.load(open(SPEC, encoding="utf-8"))
H = spec["house"]
FLOOR = H["plinth"]
TOP = FLOOR + H["ceiling"]
T = H["wall"]
HALF = H["outer"] / 2
COURT = H["court"] / 2
RING = COURT + H["corridor"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def B(x, y, z):
    """Plan frame -> Blender frame."""
    return (x, -z, y)


# --- materials ---------------------------------------------------------------

MATS = {}
TILE = {  # metres one texture repeat covers
    "whitewash": 4.6, "whitewash-grey": 4.6, "tiles": 3.0, "flags": 3.0, "flags-court": 3.0, "wood": 2.0,
    "shutter": 1.6, "iron": 1.0, "gravel": 3.0, "lawn": 8.0, "soot": 4.6, "fretwork": 2.8, "books": 2.4, "gods": 3.0,
}


# The photo-scanned sets (pipeline/lodge_photos.py): material -> metres one repeat covers
PHOTOS = json.load(open(f"{TEX}/photos.json", encoding="utf-8")) if os.path.exists(f"{TEX}/photos.json") else {}
TILE.update(PHOTOS)


def material(name, tex=None, color=None, rough=0.9, metal=0.0, alpha=False, double=True):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex in PHOTOS:  # its relief and its roughness, which glTF carries as normal and metallic-roughness maps
        nm = nt.nodes.new("ShaderNodeTexImage")
        nm.image = bpy.data.images.load(f"{TEX}/{tex}-normal.png")
        nm.image.colorspace_settings.name = "Non-Color"
        bump = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nm.outputs["Color"], bump.inputs["Color"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        rm = nt.nodes.new("ShaderNodeTexImage")
        rm.image = bpy.data.images.load(f"{TEX}/{tex}-rough.png")
        rm.image.colorspace_settings.name = "Non-Color"
        nt.links.new(rm.outputs["Color"], bsdf.inputs["Roughness"])
    if tex:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(f"{TEX}/{tex}.png")
        m.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            m.node_tree.links.new(node.outputs["Alpha"], bsdf.inputs["Alpha"])
            if hasattr(m, "blend_method"):
                m.blend_method = "CLIP"
                m.alpha_threshold = 0.5
    else:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    MATS[name] = m
    return m


def setup_materials():
    for t in ("whitewash", "whitewash-grey", "tiles", "flags", "flags-court", "wood", "shutter", "iron", "gravel",
              "lawn", "soot", "books", "gods"):
        material(t, tex=t)
    material("fretwork", tex="fretwork", alpha=True)
    material("brass", color=(0.62, 0.42, 0.12), rough=0.35, metal=0.9)
    material("sheet", color=(0.62, 0.58, 0.5), rough=0.95)  # "the dirty bed sheet" (¶94)
    material("kumkum", color=(0.45, 0.08, 0.04), rough=0.7)
    material("soil", color=(0.18, 0.12, 0.08), rough=1.0)
    material("tulsi", color=(0.12, 0.22, 0.07), rough=0.7)
    material("tulsi-dark", color=(0.15, 0.08, 0.14), rough=0.7)
    material("grass-grey", color=(0.4, 0.4, 0.33), rough=1.0)  # "grey grass growing all over it" (¶99)
    wg = material("window-glass", color=(0.32, 0.34, 0.3), rough=0.25)  # dirty panes (¶101)
    wg.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.32
    if hasattr(wg, "blend_method"):
        wg.blend_method = "BLEND"
    if hasattr(wg, "surface_render_method"):
        wg.surface_render_method = "BLENDED"
    material("blanket", color=(0.32, 0.27, 0.22), rough=1.0)  # coarse grey-brown wool
    material("schist", color=(0.3, 0.31, 0.29), rough=0.55)
    material("specimen", color=(0.38, 0.4, 0.22), rough=0.2)  # something pale floating in old spirit
    material("fan-metal", color=(0.5, 0.47, 0.4), rough=0.8, metal=0.35)  # old cream enamel under years of dust (¶194)
    material("cast-iron", color=(0.035, 0.035, 0.035), rough=0.45, metal=0.75)  # "large black polished bolts" (¶93)
    material("clay", color=(0.42, 0.2, 0.1))
    material("glass", color=(0.08, 0.1, 0.1), rough=0.1)
    material("water", color=(0.02, 0.04, 0.03), rough=0.05)
    material("cloth", color=(0.42, 0.18, 0.12))
    material("cloth-pale", color=(0.6, 0.55, 0.45))
    material("foliage", color=(0.18, 0.24, 0.08))
    material("hedge", color=(0.3, 0.24, 0.1))
    material("paper", color=(0.85, 0.8, 0.65))
    material("lamp", color=(0.95, 0.85, 0.55), rough=0.4)
    material("green-patch", color=(0.25, 0.42, 0.22))
    material("chilli", color=(0.55, 0.06, 0.04), rough=0.6)
    material("garlic", color=(0.85, 0.8, 0.7))
    material("rug", color=(0.45, 0.16, 0.1))
    material("soot-dark", color=(0.09, 0.07, 0.05))
    fire = material("fire", color=(1.0, 0.45, 0.1), rough=1.0)
    bsdf = fire.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.42, 0.08, 1)
    bsdf.inputs["Emission Strength"].default_value = 4.0


# --- geometry ----------------------------------------------------------------

class Geo:
    """Quads with UVs in metres, grouped by material, turned into one Blender object."""

    def __init__(self):
        self.verts, self.faces, self.uvs, self.mats, self.names = [], [], [], [], []

    def quad(self, pts, normal, mat, uv=None):
        pts = [Vector(p) for p in pts]
        n = (pts[1] - pts[0]).cross(pts[3] - pts[0])
        if n.dot(Vector(normal)) < 0:
            pts = [pts[0], pts[3], pts[2], pts[1]]
            if uv:
                uv = [uv[0], uv[3], uv[2], uv[1]]
        if uv is None:
            uv = self.planar(pts, normal, mat)
        i = len(self.verts)
        self.verts += [B(*p) for p in pts]
        self.faces.append((i, i + 1, i + 2, i + 3))
        self.uvs.append(uv)
        if mat not in self.names:
            self.names.append(mat)
        self.mats.append(self.names.index(mat))

    @staticmethod
    def planar(pts, normal, mat):
        s = TILE.get(mat, 3.0)
        nx, ny, nz = (abs(c) for c in normal)
        if ny >= max(nx, nz):  # floors, ceilings, roofs: lay the texture flat
            return [(p.x / s, p.z / s) for p in pts]
        if nx >= nz:  # walls facing east or west: along z, up y
            return [(p.z / s, p.y / s) for p in pts]
        return [(p.x / s, p.y / s) for p in pts]

    def box(self, x0, x1, y0, y1, z0, z1, mat, faces="all", top=None):
        X0, X1, Y0, Y1, Z0, Z1 = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1)
        if X1 - X0 < 1e-4 or Y1 - Y0 < 1e-4 or Z1 - Z0 < 1e-4:
            return
        sides = {
            "+y": ([(X0, Y1, Z0), (X1, Y1, Z0), (X1, Y1, Z1), (X0, Y1, Z1)], (0, 1, 0)),
            "-y": ([(X0, Y0, Z0), (X1, Y0, Z0), (X1, Y0, Z1), (X0, Y0, Z1)], (0, -1, 0)),
            "+x": ([(X1, Y0, Z0), (X1, Y1, Z0), (X1, Y1, Z1), (X1, Y0, Z1)], (1, 0, 0)),
            "-x": ([(X0, Y0, Z0), (X0, Y1, Z0), (X0, Y1, Z1), (X0, Y0, Z1)], (-1, 0, 0)),
            "+z": ([(X0, Y0, Z1), (X1, Y0, Z1), (X1, Y1, Z1), (X0, Y1, Z1)], (0, 0, 1)),
            "-z": ([(X0, Y0, Z0), (X1, Y0, Z0), (X1, Y1, Z0), (X0, Y1, Z0)], (0, 0, -1)),
        }
        for k, (pts, n) in sides.items():
            if faces == "all" or k in faces:
                self.quad(pts, n, top if (top and k == "+y") else mat)

    def cylinder(self, x, z, r, y0, y1, mat, seg=12, cap=True):
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            p0 = (x + r * math.cos(a0), y0, z + r * math.sin(a0))
            p1 = (x + r * math.cos(a1), y0, z + r * math.sin(a1))
            am = (a0 + a1) / 2
            u0, u1 = i / seg * 2 * math.pi * r / TILE.get(mat, 3), (i + 1) / seg * 2 * math.pi * r / TILE.get(mat, 3)
            self.quad([p0, p1, (p1[0], y1, p1[2]), (p0[0], y1, p0[2])], (math.cos(am), 0, math.sin(am)), mat,
                      uv=[(u0, y0 / 3), (u1, y0 / 3), (u1, y1 / 3), (u0, y1 / 3)])
            if cap:
                self.quad([(x, y1, z), (x, y1, z), (p1[0], y1, p1[2]), (p0[0], y1, p0[2])], (0, 1, 0), mat)

    def sphere(self, x, y, z, r, mat, seg=10):
        rings = seg // 2
        for j in range(rings):
            t0, t1 = math.pi * j / rings - math.pi / 2, math.pi * (j + 1) / rings - math.pi / 2
            for i in range(seg):
                a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
                pts = [(x + r * math.cos(t) * math.cos(a), y + r * math.sin(t), z + r * math.cos(t) * math.sin(a))
                       for t, a in ((t0, a0), (t0, a1), (t1, a1), (t1, a0))]
                c = [sum(p[k] for p in pts) / 4 for k in range(3)]
                self.quad(pts, (c[0] - x, c[1] - y, c[2] - z), mat)

    def to_object(self, name, collection=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        uv = mesh.uv_layers.new(name="UVMap")
        for poly, quad in zip(mesh.polygons, self.uvs):
            for li, (u, v) in zip(poly.loop_indices, quad):
                uv.data[li].uv = (u, v)
        for m in self.names:
            mesh.materials.append(MATS[m])
        for poly, mi in zip(mesh.polygons, self.mats):
            poly.material_index = mi
        obj = bpy.data.objects.new(name, mesh)
        (collection or scene.collection).objects.link(obj)
        return obj


MARKERS = []


def empty(name, x, y, z, **props):
    # glTF optimisation prunes empty nodes, so the game reads markers from a
    # sidecar (lodge.json) as well; the empties stay for anyone opening the .blend
    MARKERS.append({"name": name, "at": [round(x, 3), round(y, 3), round(z, 3)], **props})
    e = bpy.data.objects.new(name, None)
    e.location = B(x, y, z)
    for k, v in props.items():
        e[k] = v
    scene.collection.objects.link(e)
    return e


# --- the house ---------------------------------------------------------------

def openings():
    """Every door and window, as (orientation, line, centre, width, bottom, top, kind, room, n)."""
    out = []
    for r in spec["rooms"]:
        x0, z0, x1, z1 = r["rect"]
        for kind in ("doors", "windows"):
            for n, o in enumerate(r.get(kind, [])):
                side = o["side"]
                orient, line = ("h", z0 if side == "n" else z1) if side in "ns" else ("v", x0 if side == "w" else x1)
                if kind == "doors":
                    bottom, top = FLOOR, FLOOR + (3.4 if o.get("arch") else 2.6)
                else:
                    bottom, top = FLOOR + 0.9, FLOOR + 2.8
                out.append((orient, round(line, 3), o["at"], o["width"], bottom, top, kind[:-1], r["id"], n, o))
    return out


def wall_lines():
    """Every room edge as a wall line, merged where rooms share a wall."""
    lines = {}
    for r in spec["rooms"]:
        x0, z0, x1, z1 = r["rect"]
        for orient, line, a, b in (("h", z0, x0, x1), ("h", z1, x0, x1), ("v", x0, z0, z1), ("v", x1, z0, z1)):
            lines.setdefault((orient, round(line, 3)), []).append((a, b))
    merged = {}
    for key, spans in lines.items():
        spans.sort()
        out = [list(spans[0])]
        for a, b in spans[1:]:
            if a <= out[-1][1] + 1e-6:
                out[-1][1] = max(out[-1][1], b)
            else:
                out.append([a, b])
        merged[key] = out
    return merged


def wall_piece(g, orient, line, a, b, y0, y1, mat, col=None):
    if orient == "h":
        g.box(a, b, y0, y1, line - T / 2, line + T / 2, mat)
        if col is not None:
            col.box(a, b, y0, y1, line - T / 2, line + T / 2, "whitewash")
    else:
        g.box(line - T / 2, line + T / 2, y0, y1, a, b, mat)
        if col is not None:
            col.box(line - T / 2, line + T / 2, y0, y1, a, b, "whitewash")


def build_walls(g, col):
    ops = openings()
    for (orient, line), spans in wall_lines().items():
        outer = abs(abs(line) - HALF) < 1e-3
        back = orient == "h" and abs(line + HALF) < 1e-3
        mat = "whitewash-grey" if back else "whitewash"
        for a, b in spans:
            here = sorted((o for o in ops if o[0] == orient and o[1] == line and a <= o[2] <= b), key=lambda o: o[2])
            cur = a
            for o in here:
                lo, hi = o[2] - o[3] / 2, o[2] + o[3] / 2
                wall_piece(g, orient, line, cur, lo, 0, TOP, mat, col)
                wall_piece(g, orient, line, lo, hi, o[5], TOP, mat, col)  # lintel
                if o[4] > FLOOR + 0.01:
                    wall_piece(g, orient, line, lo, hi, 0, o[4], mat, col)  # sill
                else:  # the threshold, just under the floor: two faces in one place bake black
                    wall_piece(g, orient, line, lo, hi, 0, FLOOR - 0.005, mat, None)
                cur = hi
            wall_piece(g, orient, line, cur, b, 0, TOP, mat, col)
    # the kitchen's soot-black deep end (novel ¶195)
    k = next(r for r in spec["rooms"] if r["id"] == "kitchen")
    x0, z0, x1, z1 = k["rect"]
    g.box(x0 + 0.5, x1 - 0.5, FLOOR + 1.6, TOP - 0.01, z0 + T / 2 + 0.01, z0 + T / 2 + 0.03, "soot")


def build_windows_and_doors(g, furniture):
    """Window glass, green shutters folded open against the outer face, door frames,
    and the door leaves as separate objects with their origin at the hinge."""
    for o in openings():
        orient, line, c, w, bottom, top, kind, room, n, raw = o
        outer_side = 1 if line > 0 else -1
        if kind == "window":  # the shutters folded back (ours), and dirty glass in a wooden frame (below)
            glaze(orient, line, c, w, bottom, top)
            if orient == "h":
                for s in (-1, 1):
                    x = c + s * (w / 2 + w / 4)
                    zf = line + outer_side * (T / 2 + 0.03)
                    g.box(x - w / 4, x + w / 4, bottom, top, zf - 0.02, zf + 0.02, "shutter")
            else:
                for s in (-1, 1):
                    z = c + s * (w / 2 + w / 4)
                    xf = line + outer_side * (T / 2 + 0.03)
                    g.box(xf - 0.02, xf + 0.02, bottom, top, z - w / 4, z + w / 4, "shutter")
            continue
        if raw.get("arch"):
            continue
        leaves = ["L", "R"] if raw.get("double") else [""]
        lw = w / len(leaves)
        for i, side in enumerate(leaves):
            leaf = Geo()
            leaf.box(0, lw - 0.02, FLOOR, top - 0.02, -0.03, 0.03, "wood")
            leaf.box(0.08, lw - 0.1, FLOOR + 1.4, top - 0.2, -0.04, 0.04, "shutter")
            obj = leaf.to_object(f"door:{room}:{n}" + (f":{side}" if side else ""))
            # hinge at one jamb; the game swings it about y
            if orient == "h":
                hx = c - w / 2 + (w if side == "R" else 0)
                obj.location = B(hx, 0, line)
                obj.rotation_euler = (0, 0, math.pi if side == "R" else 0)
            else:
                hz = c - w / 2 + (w if side == "R" else 0)
                obj.location = B(line, 0, hz)
                obj.rotation_euler = (0, 0, -math.pi / 2 if side != "R" else math.pi / 2)
            obj["kind"] = "door"
            obj["room"] = room
            obj["to"] = raw["to"]
            obj["open"] = 1.4  # radians it swings open; the game owns the rest


PANES = None  # the windows' glass: its own object, so it neither bakes nor casts the sun's shadow


def glaze(orient, line, c, w, bottom, top):
    """A window's dirty panes in a wooden frame, a mullion and a transom across them: "windows that
    revealed a wide lawn through their dirty panes. They also revealed the reflection of a bearded
    face" (novel ¶101; glazed at the author's word, 21 Oct)."""
    global PANES
    if PANES is None:
        PANES = (Geo(), Geo())
    glass, frame = PANES
    def at(u, y, d=0.0):  # a point in the window's plane: u along the wall, d out of it
        return (u, y, line + d) if orient == "h" else (line + d, y, u)
    n = (0, 0, 1) if orient == "h" else (1, 0, 0)
    pane = [at(c - w / 2, bottom), at(c + w / 2, bottom), at(c + w / 2, top), at(c - w / 2, top)]
    glass.quad(pane, n, "window-glass", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    glass.quad(pane, tuple(-v for v in n), "window-glass", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mid, tr = c, bottom + (top - bottom) * 0.62
    for u0, u1, y0, y1 in ((c - w / 2, c - w / 2 + 0.05, bottom, top), (c + w / 2 - 0.05, c + w / 2, bottom, top),
                           (c - w / 2, c + w / 2, bottom, bottom + 0.05), (c - w / 2, c + w / 2, top - 0.05, top),
                           (mid - 0.025, mid + 0.025, bottom, top), (c - w / 2, c + w / 2, tr - 0.025, tr + 0.025)):
        a, b = at(u0, y0, -0.03), at(u1, y1, 0.03)
        frame.box(min(a[0], b[0]), max(a[0], b[0]), y0, y1, min(a[2], b[2]), max(a[2], b[2]), "wood")


def build_floors(g, col):
    # the plinth under the wings and the corridor, flagged on top
    for x0, x1, z0, z1 in ((-HALF, HALF, -HALF, -COURT), (-HALF, HALF, COURT, HALF),
                           (-HALF, -COURT, -COURT, COURT), (COURT, HALF, -COURT, COURT)):
        g.box(x0, x1, -0.6, FLOOR, z0, z1, "whitewash", faces=("+y", "+x", "-x", "+z", "-z"), top="flags")
        col.box(x0, x1, -0.6, FLOOR, z0, z1, "flags")
    # the courtyard, a step down (comic b1-p004-7, b3-p031-1)
    g.box(-COURT, COURT, -0.6, FLOOR - 0.3, -COURT, COURT, "flags-court", faces=("+y",))
    col.box(-COURT, COURT, -0.6, FLOOR - 0.3, -COURT, COURT, "flags")
    # ceilings with sal-wood crossbeams (novel ¶194)
    for r in spec["rooms"]:
        x0, z0, x1, z1 = r["rect"]
        # (to the walls' faces, not into them, so the baked shade at the edge isn't the wall's inside)
        g.box(x0 + T / 2, x1 - T / 2, TOP, TOP + 0.08, z0 + T / 2, z1 - T / 2, "whitewash", faces=("-y",))
        span_x = (x1 - x0) >= (z1 - z0)
        n = max(1, int((x1 - x0 if span_x else z1 - z0) / 2.4))
        for i in range(1, n + 1):
            if span_x:
                x = x0 + i * (x1 - x0) / (n + 1)
                g.box(x - 0.12, x + 0.12, TOP - 0.3, TOP, z0, z1, "wood")
            else:
                z = z0 + i * (z1 - z0) / (n + 1)
                g.box(x0, x1, TOP - 0.3, TOP, z - 0.12, z + 0.12, "wood")
    # the corridor's ceiling
    for x0, x1, z0, z1 in ((-RING, RING, -RING, -COURT), (-RING, RING, COURT, RING),
                           (-RING, -COURT, -COURT, COURT), (COURT, RING, -COURT, COURT)):
        g.box(x0, x1, TOP, TOP + 0.08, z0, z1, "wood", faces=("-y",))


def build_pillars(g, col):
    p = H["pillars"]
    r = p["diameter"] / 2
    sp = p["spacing"]
    k = -COURT
    seen = set()
    while k <= COURT + 1e-3:
        for x, z in ((k, -COURT), (k, COURT), (-COURT, k), (COURT, k)):
            key = (round(x, 2), round(z, 2))
            if key in seen:
                continue
            seen.add(key)
            g.cylinder(x, z, r, FLOOR, TOP, "whitewash", seg=10, cap=False)
            g.box(x - r - 0.08, x + r + 0.08, FLOOR, FLOOR + 0.35, z - r - 0.08, z + r + 0.08, "whitewash")
            g.box(x - r - 0.1, x + r + 0.1, TOP - 0.3, TOP, z - r - 0.1, z + r + 0.1, "whitewash")
            col.box(x - r, x + r, FLOOR, TOP, z - r, z + r, "whitewash")
        k += sp
    # the lintel along the court edge, and the low step down into the court
    for x0, x1, z0, z1 in ((-COURT, COURT, -COURT - 0.2, -COURT + 0.2), (-COURT, COURT, COURT - 0.2, COURT + 0.2),
                           (-COURT - 0.2, -COURT + 0.2, -COURT, COURT), (COURT - 0.2, COURT + 0.2, -COURT, COURT)):
        g.box(x0, x1, TOP - 0.45, TOP, z0, z1, "whitewash")


def build_court_cover(g, col):
    """Rusting iron bars over the court with the fibreglass torn away in places
    (novel ¶193; mostly open, as the comic draws it)."""
    y = TOP + 0.6
    for i in range(-7, 8, 2):
        g.box(i - 0.04, i + 0.04, y, y + 0.08, -COURT, COURT, "iron")
        g.box(-COURT, COURT, y, y + 0.08, i - 0.04, i + 0.04, "iron")
    for x0, z0, x1, z1 in ((-8, -8, -3, -5), (3, 4, 8, 8), (-8, 5, -5, 8)):  # what's left of the sheets
        g.box(x0, x1, y + 0.09, y + 0.1, z0, z1, "paper")
    tulsi(g, col, *H["planter"]["at"])


def tulsi(g, col, x, z):
    """The tulsi vrindavan at the court's centre: "a tall pedestal with a plant growing on it ...
    He tended carefully to its fledgling shoots" (novel ¶213, comic b1-p010-10): a stepped square
    pedestal, a niche for the lamp on its south face, a band of kumkum red, the basin at the top,
    and the young tulsi in it."""
    y = FLOOR - 0.3  # the court's floor
    g.box(x - 0.5, x + 0.5, y, y + 0.14, z - 0.5, z + 0.5, "whitewash")
    g.box(x - 0.4, x + 0.4, y + 0.14, y + 0.26, z - 0.4, z + 0.4, "whitewash")
    g.box(x - 0.3, x + 0.3, y + 0.26, y + 1.1, z - 0.3, z + 0.3, "whitewash")
    g.box(x - 0.31, x + 0.31, y + 0.98, y + 1.04, z - 0.31, z + 0.31, "kumkum")
    g.box(x - 0.36, x + 0.36, y + 1.1, y + 1.18, z - 0.36, z + 0.36, "whitewash")
    g.box(x - 0.08, x + 0.08, y + 0.45, y + 0.7, z + 0.29, z + 0.302, "soot-dark")  # the lamp's niche, sooted
    g.sphere(x, y + 0.48, z + 0.31, 0.025, "clay", seg=6)  # a clay diya in it
    g.cylinder(x, z, 0.26, y + 1.18, y + 1.32, "clay", seg=12)  # the basin
    g.cylinder(x, z, 0.23, y + 1.3, y + 1.31, "soil", seg=12)
    g.cylinder(x, z, 0.008, y + 1.3, y + 1.62, "wood", seg=4)  # the stem
    import random
    rnd = random.Random(213)
    for k in range(60):  # its small leaves, round the young shoots, some the dark purple of krishna tulsi
        h = rnd.uniform(0.06, 0.32)
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.02, 0.15 - h * 0.25)
        g.sphere(x + math.cos(a) * r, y + 1.31 + h, z + math.sin(a) * r, 0.017, "tulsi" if k % 3 else "tulsi-dark", seg=4)
    col.box(x - 0.5, x + 0.5, y, y + 1.4, z - 0.5, z + 0.5, "whitewash")


def build_roof(g):
    """Hipped red tiles round the court (comic b1-p008-2, b3-p031-1)."""
    rf = H["roof"]
    eave = rf["eaves"]
    out_r, in_r = HALF + eave, COURT - eave * 0.6
    mid = (HALF + COURT) / 2
    rise = (out_r - mid) * math.tan(math.radians(rf["pitch"]))
    y0, y1 = TOP + 0.05, TOP + 0.05 + rise
    def ring(r):
        return [(-r, r), (r, r), (r, -r), (-r, -r)]  # SW, SE, NE, NW in (x, z)
    o, m, i = ring(out_r), ring(mid), ring(in_r)
    for k in range(4):
        a, b = k, (k + 1) % 4
        # outer slope
        pts = [(o[a][0], y0, o[a][1]), (o[b][0], y0, o[b][1]), (m[b][0], y1, m[b][1]), (m[a][0], y1, m[a][1])]
        cx, cz = (o[a][0] + o[b][0]) / 2, (o[a][1] + o[b][1]) / 2
        g.quad(pts, (cx, 3, cz), "tiles", uv=[(0, 0), (2 * out_r / 3, 0), (2 * out_r / 3, (out_r - mid) / 2.6), (0, (out_r - mid) / 2.6)])
        g.quad(pts, (-cx, -3, -cz), "whitewash")  # its underside
        # inner slope, down to the court
        pts = [(i[a][0], y0, i[a][1]), (i[b][0], y0, i[b][1]), (m[b][0], y1, m[b][1]), (m[a][0], y1, m[a][1])]
        g.quad(pts, (-cx, 3, -cz), "tiles", uv=[(0, 0), (2 * in_r / 3, 0), (2 * in_r / 3, (mid - in_r) / 2.6), (0, (mid - in_r) / 2.6)])
        g.quad(pts, (cx, -3, cz), "wood")
    # the eaves' fascia
    for k in range(4):
        a, b = o[k], o[(k + 1) % 4]
        g.quad([(a[0], y0 - 0.25, a[1]), (b[0], y0 - 0.25, b[1]), (b[0], y0, b[1]), (a[0], y0, a[1])],
               ((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2), "wood")
    # the gap between the wall tops and the roof, closed
    for x0, x1, z0, z1 in ((-HALF, HALF, HALF - T, HALF), (-HALF, HALF, -HALF, -HALF + T), (-HALF, -HALF + T, -HALF, HALF), (HALF - T, HALF, -HALF, HALF)):
        g.box(x0, x1, TOP, y0 + 0.4, z0, z1, "whitewash")
    # the crenellated parapet across the front's middle (novel ¶164; comic b1-p008-2, b3-p031-1)
    pa = H["parapet"]
    x0, x1 = pa["span"]
    zf = HALF + 0.1
    base = y0 + (out_r - HALF) * math.tan(math.radians(rf["pitch"]))
    g.box(x0, x1, TOP - 0.2, base + pa["height"], zf - 0.5, zf, "whitewash")
    n = 9
    w = (x1 - x0) / n
    for k in range(n):
        if k % 2 == 0:
            g.box(x0 + k * w, x0 + (k + 1) * w, base + pa["height"], base + pa["height"] + 0.55, zf - 0.5, zf, "whitewash")
    for xx in (x0, x1, 0):
        g.box(xx - 0.35, xx + 0.35, TOP - 0.2, base + pa["height"] + 0.9, zf - 0.6, zf + 0.05, "whitewash")
        g.sphere(xx, base + pa["height"] + 1.15, zf - 0.27, 0.25, "whitewash", seg=8)


def build_verandah(g, col):
    """The fretted front verandah with decorated railings (novel ¶164; comic
    b1-p008-2, b3-p031-1) and its three steps (novel ¶163)."""
    v = spec["verandah"]
    x0, x1 = v["span"]
    z0, z1 = HALF, HALF + v["depth"]
    g.box(x0, x1, -0.6, FLOOR, z0, z1, "whitewash", top="flags")
    col.box(x0, x1, -0.6, FLOOR, z0, z1, "flags")
    for s in range(v["steps"]):
        h = FLOOR * (v["steps"] - s) / (v["steps"] + 1)  # three risers down to the gravel
        zz = z1 + s * 0.4
        g.box(-1.6, 1.6, -0.6, h, zz, zz + 0.4, "whitewash", top="flags")
        col.box(-1.6, 1.6, -0.6, h, zz, zz + 0.4, "flags")
    roof_y = TOP - 0.6
    bays = 5
    xs = [x0 + 0.25 + k * (x1 - x0 - 0.5) / bays for k in range(bays + 1)]
    for x in xs:
        g.cylinder(x, z1 - 0.25, 0.14, FLOOR, roof_y, "whitewash", seg=8, cap=False)
        col.box(x - 0.14, x + 0.14, FLOOR, roof_y, z1 - 0.39, z1 - 0.11, "whitewash")
    g.box(x0 - 0.2, x1 + 0.2, roof_y, roof_y + 0.25, z0, z1 + 0.3, "wood")
    g.quad([(x0 - 0.3, roof_y + 0.25, z1 + 0.3), (x1 + 0.3, roof_y + 0.25, z1 + 0.3), (x1 + 0.3, roof_y + 0.9, z0), (x0 - 0.3, roof_y + 0.9, z0)],
           (0, 1, 0.3), "tiles", uv=[(0, 0), (5, 0), (5, 1.2), (0, 1.2)])
    # the fretted frieze between the pillars, and railings either side of the steps
    for a, b in zip(xs, xs[1:]):
        g.quad([(a + 0.14, roof_y - 1.3, z1 - 0.25), (b - 0.14, roof_y - 1.3, z1 - 0.25), (b - 0.14, roof_y, z1 - 0.25), (a + 0.14, roof_y, z1 - 0.25)],
               (0, 0, 1), "fretwork", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
        if (a + b) / 2 < -1.7 or (a + b) / 2 > 1.7:
            g.box(a, b, FLOOR + 0.85, FLOOR + 0.95, z1 - 0.3, z1 - 0.2, "whitewash")
            k = a + 0.2
            while k < b - 0.1:
                g.box(k - 0.03, k + 0.03, FLOOR, FLOOR + 0.85, z1 - 0.27, z1 - 0.23, "whitewash")
                k += 0.18
            col.box(a, b, FLOOR, FLOOR + 0.95, z1 - 0.3, z1 - 0.2, "whitewash")


# --- furniture ---------------------------------------------------------------

def beam_near(x0, z0, x1, z1, cx, cz):
    """The sal crossbeam nearest a room's middle (as build_floors lays them): where its fan hangs."""
    span_x = (x1 - x0) >= (z1 - z0)
    n = max(1, int((x1 - x0 if span_x else z1 - z0) / 2.4))
    if span_x:
        return min((x0 + i * (x1 - x0) / (n + 1) for i in range(1, n + 1)), key=lambda x: abs(x - cx)), cz
    return cx, min((z0 + i * (z1 - z0) / (n + 1) for i in range(1, n + 1)), key=lambda z: abs(z - cz))


def iron_beam(g, x, z0, z1):
    """"A heavy cast-iron beam stretched across [the] big room. Timber could be seen beyond the
    beam, holding preciously on to the heavy load with large black polished bolts" (novel ¶93):
    an I-section under the sal crossbeams, bolted up to each."""
    y1 = TOP - 0.3  # under the crossbeams
    y0 = y1 - 0.25
    g.box(x - 0.11, x + 0.11, y1 - 0.025, y1, z0, z1, "cast-iron")  # the flanges
    g.box(x - 0.11, x + 0.11, y0, y0 + 0.025, z0, z1, "cast-iron")
    g.box(x - 0.012, x + 0.012, y0, y1, z0, z1, "cast-iron")  # the web
    span = z1 - z0
    n = max(1, int(span / 2.4))
    for i in range(1, n + 1):
        bz = z0 + i * span / (n + 1)
        for s in (-1, 1):  # a bolt each side of the web, up through the flange into the timber
            g.cylinder(x + s * 0.07, bz, 0.022, y1 - 0.06, y1 + 0.12, "cast-iron", seg=6)
            g.cylinder(x + s * 0.07, bz, 0.035, y1 - 0.075, y1 - 0.045, "cast-iron", seg=6)  # the nut


def ceiling_fan(room, x, z, hang, drop):
    """A period ceiling fan: canopy, downrod, coupling, motor housing and four blades on their
    irons (the comic's fan casts a cross-shaped shadow, b1-p004-2), dust-ridden (novel ¶194).
    Built about its own hub: "fan-<room>" stays still, "fan-<room>-blades" (its child) turns."""
    body = Geo()
    hub = -drop  # the housing's middle, below where it hangs
    body.cylinder(0, 0, 0.075, -0.1, 0.0, "fan-metal", seg=12)  # the canopy
    body.cylinder(0, 0, 0.016, hub + 0.12, -0.1, "fan-metal", seg=6)  # the downrod
    body.cylinder(0, 0, 0.035, hub + 0.1, hub + 0.16, "fan-metal", seg=8)  # the coupling
    body.cylinder(0, 0, 0.17, hub - 0.06, hub + 0.1, "fan-metal", seg=16)  # the motor housing
    body.cylinder(0, 0, 0.12, hub - 0.11, hub - 0.06, "fan-metal", seg=16)
    body.sphere(0, hub - 0.11, 0, 0.05, "fan-metal", seg=8)  # the finial under it
    obj = body.to_object(f"fan-{room}")
    obj.location = B(x, hang, z)
    blades = Geo()
    for k in range(4):
        a = k * math.pi / 2
        c, s_ = math.cos(a), math.sin(a)
        def at(r, w, y):  # a point r out along this blade, w across it, y up
            return (r * c - w * s_, y, r * s_ + w * c)
        blades.quad([at(0.12, -0.02, 0), at(0.24, -0.02, 0), at(0.24, 0.02, 0), at(0.12, 0.02, 0)], (0, 1, 0), "fan-metal")  # the iron
        tilt = 0.022  # the blade's pitch: its leading edge a little lower
        blades.quad([at(0.22, -0.065, -tilt), at(0.78, -0.07, -tilt), at(0.78, 0.07, tilt), at(0.22, 0.065, tilt)], (0, 1, 0), "fan-metal")
        blades.quad([at(0.22, -0.065, -tilt - 0.004), at(0.78, -0.07, -tilt - 0.004), at(0.78, 0.07, tilt - 0.004), at(0.22, 0.065, tilt - 0.004)], (0, -1, 0), "fan-metal")
    bo = blades.to_object(f"fan-{room}-blades")
    bo.parent = obj
    bo.location = B(0, hub + 0.02, 0)  # (Blender frame, relative to the fan's own origin)


def table(g, col, x, z, w, d, h=0.78, mat="wood"):
    g.box(x - w / 2, x + w / 2, FLOOR + h - 0.05, FLOOR + h, z - d / 2, z + d / 2, mat)
    for sx in (-1, 1):
        for sz in (-1, 1):
            lx, lz = x + sx * (w / 2 - 0.08), z + sz * (d / 2 - 0.08)
            g.box(lx - 0.04, lx + 0.04, FLOOR, FLOOR + h - 0.05, lz - 0.04, lz + 0.04, mat)
    col.box(x - w / 2, x + w / 2, FLOOR, FLOOR + h, z - d / 2, z + d / 2, "wood")


def chair(g, x, z, face=0.0):
    g.box(x - 0.22, x + 0.22, FLOOR + 0.42, FLOOR + 0.47, z - 0.22, z + 0.22, "wood")
    dx, dz = math.sin(face) * 0.2, math.cos(face) * 0.2
    g.box(x - 0.22 - abs(dz) * 0, x + 0.22, FLOOR + 0.47, FLOOR + 1.0, z - dz - 0.03, z - dz + 0.03, "wood") if abs(dz) > abs(dx) else \
        g.box(x - dx - 0.03, x - dx + 0.03, FLOOR + 0.47, FLOOR + 1.0, z - 0.22, z + 0.22, "wood")
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.box(x + sx * 0.18 - 0.03, x + sx * 0.18 + 0.03, FLOOR, FLOOR + 0.42, z + sz * 0.18 - 0.03, z + sz * 0.18 + 0.03, "wood")


def sofa(g, col, x, z, w, against, cloth="cloth"):
    """A sofa with its back to a wall: against is n/s/e/w."""
    d = 0.85
    if against in "ns":
        z0 = z - d / 2
        g.box(x - w / 2, x + w / 2, FLOOR, FLOOR + 0.45, z0, z0 + d, cloth)
        bz = z0 if against == "n" else z0 + d - 0.2
        g.box(x - w / 2, x + w / 2, FLOOR + 0.45, FLOOR + 0.9, bz, bz + 0.2, cloth)
        for s in (-1, 1):
            g.box(x + s * w / 2 - (0.18 if s > 0 else 0), x + s * w / 2 + (0 if s > 0 else 0.18), FLOOR + 0.45, FLOOR + 0.7, z0, z0 + d, cloth)
        col.box(x - w / 2, x + w / 2, FLOOR, FLOOR + 0.9, z0, z0 + d, "wood")
    else:
        x0 = x - d / 2
        g.box(x0, x0 + d, FLOOR, FLOOR + 0.45, z - w / 2, z + w / 2, cloth)
        bx = x0 if against == "w" else x0 + d - 0.2
        g.box(bx, bx + 0.2, FLOOR + 0.45, FLOOR + 0.9, z - w / 2, z + w / 2, cloth)
        col.box(x0, x0 + d, FLOOR, FLOOR + 0.9, z - w / 2, z + w / 2, "wood")


def bed(g, col, x, z, along_x=True):
    """An iron bed, made up: the mattress under a dirty sheet, a blanket over the lower part, a
    stack of pillows at the head (novel ¶94-95: "the folds of the dirty bed sheet", "the stack of
    pillows behind his neck", the glass rolling "down the blanket"; comic b1-p004-3)."""
    w, l = (2.0, 1.0) if along_x else (1.0, 2.0)
    g.box(x - w / 2, x + w / 2, FLOOR + 0.35, FLOOR + 0.53, z - l / 2, z + l / 2, "sheet")
    g.box(x - w / 2, x + w / 2, FLOOR, FLOOR + 0.35, z - l / 2, z + l / 2, "iron")
    if along_x:
        g.box(x - w / 2 - 0.05, x - w / 2, FLOOR, FLOOR + 1.1, z - l / 2, z + l / 2, "iron")
        hx, hz, ax, az = x - w / 2, z, 1, 0  # the head, and which way the bed runs from it
    else:
        g.box(x - w / 2, x + w / 2, FLOOR, FLOOR + 1.1, z - l / 2 - 0.05, z - l / 2, "iron")
        hx, hz, ax, az = x, z - l / 2, 0, 1
    across = l if along_x else w
    # the blanket over the foot two-thirds, hanging a little over the sides
    f0, f1 = 0.65, 2.0
    bx0, bx1 = (hx + f0, hx + f1) if ax else (x - across / 2 - 0.04, x + across / 2 + 0.04)
    bz0, bz1 = (z - across / 2 - 0.04, z + across / 2 + 0.04) if ax else (hz + f0, hz + f1)
    g.box(bx0, bx1, FLOOR + 0.42, FLOOR + 0.58, bz0, bz1, "blanket")
    # three pillows, stacked a little askew
    for k in range(3):
        px, pz = hx + ax * (0.3 + 0.02 * k), hz + az * (0.3 + 0.02 * k)
        half = across * 0.36 - 0.03 * k
        g.box(px - (0.17 if ax else half), px + (0.17 if ax else half), FLOOR + 0.53 + k * 0.09, FLOOR + 0.62 + k * 0.09,
              pz - (half if ax else 0.17), pz + (half if ax else 0.17), "sheet")
    col.box(x - w / 2, x + w / 2, FLOOR, FLOOR + 0.58, z - l / 2, z + l / 2, "wood")


def armchair(g, col, x, z, face=0.0, cloth="cloth"):
    """An old sissoo armchair with a cushioned seat and back (novel ¶97, ¶140, ¶194), turned by face (radians)."""
    c, s_ = math.cos(face), math.sin(face)

    def box(lx0, lx1, y0, y1, lz0, lz1, mat):  # a box in the chair's own frame, turned to face
        ring = [(x + px * c - pz * s_, z + px * s_ + pz * c) for px, pz in ((lx0, lz0), (lx1, lz0), (lx1, lz1), (lx0, lz1))]
        cx_, cz_ = sum(r[0] for r in ring) / 4, sum(r[1] for r in ring) / 4
        for k in range(4):
            (ax_, az_), (bx_, bz_) = ring[k], ring[(k + 1) % 4]
            nx, nz = bz_ - az_, -(bx_ - ax_)
            if nx * ((ax_ + bx_) / 2 - cx_) + nz * ((az_ + bz_) / 2 - cz_) < 0:
                nx, nz = -nx, -nz
            g.quad([(ax_, y0, az_), (bx_, y0, bz_), (bx_, y1, bz_), (ax_, y1, az_)], (nx, 0, nz), mat)
        g.quad([(px_, y1, pz_) for px_, pz_ in ring], (0, 1, 0), mat)

    for sx in (-0.27, 0.27):
        for sz in (-0.25, 0.25):
            box(sx - 0.03, sx + 0.03, FLOOR, FLOOR + 0.42, sz - 0.03, sz + 0.03, "wood")
        box(sx - 0.04, sx + 0.04, FLOOR + 0.42, FLOOR + 0.68, -0.25, 0.28, "wood")  # the arms
    box(-0.27, 0.27, FLOOR + 0.36, FLOOR + 0.42, -0.27, 0.27, "wood")
    box(-0.24, 0.24, FLOOR + 0.42, FLOOR + 0.52, -0.24, 0.22, cloth)  # the cushion
    box(-0.25, 0.25, FLOOR + 0.42, FLOOR + 1.0, 0.24, 0.3, "wood")  # the back
    box(-0.22, 0.22, FLOOR + 0.52, FLOOR + 0.92, 0.17, 0.24, cloth)
    col.box(x - 0.35, x + 0.35, FLOOR, FLOOR + 0.7, z - 0.35, z + 0.35, "wood")


def sheet(g, x, y, z, w, d, a, mat="paper"):
    """A loose sheet lying flat, turned by a (radians)."""
    c, s_ = math.cos(a), math.sin(a)
    g.quad([(x + px * c - pz * s_, y, z + px * s_ + pz * c) for px, pz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))], (0, 1, 0), mat)


def shelves(g, col, x0, x1, z0, z1):
    g.box(x0, x1, FLOOR, TOP - 0.4, z0, z1, "wood")
    face = "+z" if abs(z1 - z0) < abs(x1 - x0) else "+x"
    nz = (0, 0, 1) if face == "+z" else (1, 0, 0)
    if face == "+z":
        g.quad([(x0, FLOOR + 0.1, z1 + 0.01), (x1, FLOOR + 0.1, z1 + 0.01), (x1, TOP - 0.5, z1 + 0.01), (x0, TOP - 0.5, z1 + 0.01)], nz, "books")
    else:
        g.quad([(x1 + 0.01, FLOOR + 0.1, z0), (x1 + 0.01, FLOOR + 0.1, z1), (x1 + 0.01, TOP - 0.5, z1), (x1 + 0.01, TOP - 0.5, z0)], nz, "books")
    col.box(x0, x1, FLOOR, TOP - 0.4, z0, z1, "wood")


def furnish(g, col):
    R = {r["id"]: r for r in spec["rooms"]}
    # the sitting room: a sofa beneath the front window (novel ¶885), armchairs, a side table
    x0, z0, x1, z1 = R["sitting"]["rect"]
    sofa(g, col, -10.5, z1 - 0.75, 2.4, "s")
    for x in (-13.5, -7.5):
        sofa(g, col, x, z1 - 2.8, 0.9, "s")
    table(g, col, -10.5, z1 - 2.6, 1.0, 0.6, 0.5)
    # the dining hall: a long table and chairs, a sideboard
    table(g, col, 10.5, 13.25, 4.2, 1.2)
    for k in range(5):
        chair(g, 8.8 + k * 0.85, 12.2, 0)
        chair(g, 8.8 + k * 0.85, 14.3, math.pi)
    table(g, col, 10.5, 10.5 + 0.55, 2.4, 0.5, 0.9)
    # beds
    bed(g, col, -14.5, 7.5, along_x=True)  # the room where Dvij wakes
    chair(g, -12.5, 3.0)
    # "a couple of randomly placed armchairs" behind him, backlit by the boarded window (novel ¶97, comic b1-p004-4)
    armchair(g, col, -15.0, 3.2, 0.6, cloth="cloth-pale")
    armchair(g, col, -13.6, 1.4, math.pi + 0.15, cloth="cloth-pale")  # turned to the bed: where the Professor sits to watch Bhavi at work (comic b1-p013-1)
    bed(g, col, -14.5, -7.5, along_x=True)  # Bhavi's room
    table(g, col, -14.8, -2.5, 1.2, 0.5, 1.0)
    bed(g, col, 0, -14.6, along_x=False)  # the Professor's bedroom
    shelves(g, col, 3.3, 4.6, -15.6, -15.0)
    # the study: desk with lamp and board game, couch, shelves to the ceiling, statues,
    # a tape recorder, a globe, a veena (novel ¶949, ¶1286; comic b1-p004-8, b2-p027-9, b2-p033-11)
    shelves(g, col, -15.7, -15.2, -15.6, -14.3)  # clear of the west window (novel ¶949)
    shelves(g, col, -9.5, -6.0, -15.7, -15.2)  # clear of the back door to the mound path (novel ¶1450)
    table(g, col, -12.8, -12.6, 1.8, 0.9)
    armchair(g, col, -12.8, -11.55, 0.0)  # the cushioned chair Dvij is sat in (novel ¶140, comic b1-p007-3)
    g.box(-13.0, -12.2, FLOOR + 0.78, FLOOR + 0.83, -12.9, -12.3, "wood")  # the board game
    for i in range(10):
        g.sphere(-12.95 + (i % 5) * 0.16, FLOOR + 0.86, -12.8 + (i // 5) * 0.3, 0.03, "paper", seg=6)  # cowries
    g.cylinder(-13.5, -12.85, 0.08, FLOOR + 0.78, FLOOR + 1.25, "brass", seg=8)  # the study lamp
    g.cylinder(-13.5, -12.85, 0.2, FLOOR + 1.2, FLOOR + 1.4, "lamp", seg=10)
    g.box(-12.0, -11.75, FLOOR + 0.78, FLOOR + 0.92, -12.95, -12.65, "iron")  # the tape recorder
    sofa(g, col, -7.0, -12.6, 2.0, "e", cloth="cloth-pale")  # the couch
    g.sphere(-6.3, FLOOR + 1.2, -15.0, 0.3, "paper", seg=10)  # the globe
    g.cylinder(-6.3, -15.0, 0.05, FLOOR, FLOOR + 0.9, "wood", seg=6)
    for x, z in ((-15.3, -10.9), (-9.0, -15.3)):  # statues
        g.cylinder(x, z, 0.2, FLOOR, FLOOR + 0.9, "whitewash-grey", seg=8)
        g.cylinder(x, z, 0.12, FLOOR + 0.9, FLOOR + 1.6, "brass", seg=8)
        g.sphere(x, FLOOR + 1.75, z, 0.13, "brass", seg=8)
    # the kitchen: a tandoor at the deep end, a worktop with jars and brass and
    # earthen pots, a wall of god-prints, a lantern (novel ¶195, ¶1942; comic b1-p010-2, b4-p001-2)
    x0, z0, x1, z1 = R["kitchen"]["rect"]
    g.cylinder(14.6, -15.0, 0.6, FLOOR, FLOOR + 0.9, "clay", seg=14)
    col.box(14.0, 15.2, FLOOR, FLOOR + 0.9, -15.6, -14.4, "wood")
    table(g, col, 9.0, -15.4, 4.0, 0.7, 0.9, mat="whitewash-grey")
    for k in range(8):
        x = 7.3 + k * 0.45
        if k % 3 == 0:
            g.sphere(x, FLOOR + 1.05, -15.4, 0.14, "brass", seg=8)
        elif k % 3 == 1:
            g.cylinder(x, -15.4, 0.11, FLOOR + 0.9, FLOOR + 1.2, "clay", seg=8)
        else:
            g.cylinder(x, -15.4, 0.09, FLOOR + 0.9, FLOOR + 1.15, "glass", seg=8)
    # the god-prints, taken from the comic's own drawing of that wall (b4-p001-2)
    g.quad([(x1 - T / 2 - 0.02, FLOOR + 1.4, -14.8), (x1 - T / 2 - 0.02, FLOOR + 1.4, -11.2),
            (x1 - T / 2 - 0.02, FLOOR + 3.2, -11.2), (x1 - T / 2 - 0.02, FLOOR + 3.2, -14.8)], (-1, 0, 0), "gods",
           uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    table(g, col, 15.4, -13.0, 0.5, 2.2, 1.0)  # the shelf of brass beneath them
    g.cylinder(15.4, -13.0, 0.06, FLOOR + 1.0, FLOOR + 1.15, "lamp", seg=8)
    g.cylinder(10.5, -13.2, 0.02, TOP - 1.0, TOP - 0.3, "iron", seg=4)  # the kerosene lantern
    g.cylinder(10.5, -13.2, 0.14, TOP - 1.3, TOP - 1.0, "lamp", seg=8)
    # the pantry's tins and pots (novel ¶195)
    for k in range(6):
        g.cylinder(11.0 + k * 0.45, -9.9, 0.16, FLOOR, FLOOR + 0.5, "iron" if k % 2 else "clay", seg=8)
    table(g, col, 13.25, -9.9, 5.0, 0.5, 0.9)
    # the store: trunks and furniture under sheets
    for k in range(3):
        g.box(14.0, 15.5, FLOOR, FLOOR + 0.6, 2 + k * 2.5, 3.2 + k * 2.5, "wood")
        col.box(14.0, 15.5, FLOOR, FLOOR + 0.6, 2 + k * 2.5, 3.2 + k * 2.5, "wood")
    g.box(11.5, 13.0, FLOOR, FLOOR + 1.3, 7.5, 9.5, "paper")
    col.box(11.5, 13.0, FLOOR, FLOOR + 1.3, 7.5, 9.5, "wood")
    # the washroom
    g.cylinder(14.8, -3.0, 0.4, FLOOR, FLOOR + 0.6, "brass", seg=10)
    # cane chairs and a low table on the verandah (comic b1-p012-2)
    for x in (-5.0, -3.6, 3.6, 5.0):
        chair(g, x, HALF + 1.5, math.pi)
    table(g, col, -4.3, HALF + 2.3, 0.8, 0.5, 0.45)
    # dust-ridden ceiling fans hanging from the sal crossbeams (novel ¶194), each its own
    # object so the game can turn its blades; in Dvij's room it hangs a long way down from
    # a heavy cast-iron beam (novel ¶93, comic b1-p004-2)
    for r in ("sitting", "dining", "study", "dvij-room", "bhavi-room", "prof-room"):
        x0, z0, x1, z1 = R[r]["rect"]
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        if r == "dvij-room":
            iron_beam(g, cx, z0, z1)
            ceiling_fan(r, cx, cz, TOP - 0.55, 1.75)
        else:
            bx, bz = beam_near(x0, z0, x1, z1, cx, cz)
            ceiling_fan(r, bx, bz, TOP - 0.3, 0.85)


# --- the grounds -------------------------------------------------------------

def build_grounds(g, col):
    gr = spec["grounds"]
    bx0, bz0, bx1, bz1 = gr["boundary"]["rect"]
    wh = gr["boundary"]["height"]
    gx, gz = gr["gate"]["at"]
    gw = gr["gate"]["width"] / 2
    bgx, bgz = gr["back_gate"]["at"]
    bgw = gr["back_gate"]["width"] / 2
    # the lawn, burnt and unkempt
    g.box(bx0, bx1, -0.02, 0.0, bz0, bz1, "lawn", faces=("+y",))
    # the boundary wall, its gate gaps, and the hedge inside it (novel ¶163)
    def wall(x0, x1, z0, z1):
        g.box(x0, x1, -0.3, wh, z0, z1, "whitewash-grey")
        g.box(x0 - 0.05, x1 + 0.05, wh, wh + 0.12, z0 - 0.05, z1 + 0.05, "whitewash")
        col.box(x0, x1, 0, wh, z0, z1, "whitewash")
    wall(bx0, gx - gw - 0.9, bz1 - 0.2, bz1 + 0.2)
    wall(gx + gw + 0.9, bx1, bz1 - 0.2, bz1 + 0.2)
    wall(bx0, bgx - bgw, bz0 - 0.2, bz0 + 0.2)
    wall(bgx + bgw, bx1, bz0 - 0.2, bz0 + 0.2)
    wall(bx0 - 0.2, bx0 + 0.2, bz0, bz1)
    wall(bx1 - 0.2, bx1 + 0.2, bz0, bz1)
    for x0, x1, z0, z1 in ((bx0 + 0.4, gx - gw - 1.4, bz1 - 1.6, bz1 - 0.6), (gx + gw + 1.4, bx1 - 0.4, bz1 - 1.6, bz1 - 0.6),
                           (bx0 + 0.4, bx0 + 1.4, bz0 + 0.6, bz1 - 0.6), (bx1 - 1.4, bx1 - 0.4, bz0 + 0.6, bz1 - 0.6)):
        g.box(x0, x1, 0, 1.3, z0, z1, "hedge")
        col.box(x0, x1, 0, 1.3, z0, z1, "wood")
    # the gate piers with their ball finials, and the iron gates standing open (comic b1-p008-2, b3-p030-1)
    for s in (-1, 1):
        px = gx + s * (gw + 0.45)
        g.box(px - 0.45, px + 0.45, -0.3, 3.0, gz - 0.45, gz + 0.45, "whitewash")
        g.box(px - 0.55, px + 0.55, 3.0, 3.2, gz - 0.55, gz + 0.55, "whitewash")
        g.sphere(px, 3.6, gz, 0.4, "whitewash", seg=10)
        col.box(px - 0.45, px + 0.45, 0, 3.2, gz - 0.45, gz + 0.45, "whitewash")
        leaf = Geo()
        for k in range(12):
            leaf.box(k * gw / 12, k * gw / 12 + 0.04, 0.05, 2.6, -0.02, 0.02, "iron")
        leaf.box(0, gw, 0.3, 0.38, -0.03, 0.03, "iron")
        leaf.box(0, gw, 2.2, 2.28, -0.03, 0.03, "iron")
        obj = leaf.to_object(f"gate:{'L' if s < 0 else 'R'}")
        obj.location = B(gx + s * gw, 0, gz)
        obj.rotation_euler = (0, 0, (math.pi if s > 0 else 0) + s * math.radians(-65))
    # the drive, its round planter, potted plants, and the path circling the house (novel ¶163; comic b1-p008-2)
    (dx0, dz0), (dx1, dz1) = gr["drive"]["from"], gr["drive"]["to"]
    dw = gr["drive"]["width"] / 2
    g.box(dx0 - dw, dx0 + dw, 0.0, 0.04, dz1, dz0, "gravel", faces=("+y",))
    px, pz = gr["drive"]["planter"]
    g.cylinder(px, pz, 2.4, 0.0, 0.45, "whitewash-grey", seg=18)
    g.cylinder(px, pz, 2.25, 0.4, 0.47, "clay", seg=18)
    for a in range(5):
        ang = a * 2 * math.pi / 5
        g.sphere(px + 1.2 * math.cos(ang), 0.9, pz + 1.2 * math.sin(ang), 0.5, "hedge", seg=8)
    col.box(px - 2.4, px + 2.4, 0, 0.6, pz - 2.4, pz + 2.4, "wood")
    zz = dz1 + 4
    while zz < dz0 - 3:
        if abs(zz - pz) > 3.5:
            for s in (-1, 1):
                x = s * (dw + 0.7)
                g.cylinder(x, zz, 0.28, 0, 0.5, "clay", seg=8)
                g.sphere(x, 0.75, zz, 0.32, "foliage", seg=8)
        zz += 6
    ring = HALF + 3
    # (the strips meet without overlapping: two faces in one place bake black)
    for x0, x1, z0, z1 in ((-ring, ring, -ring, -HALF - 1), (-ring, -1.6, HALF + 0.2, ring + 3.4), (1.6, ring, HALF + 0.2, ring + 3.4),
                           (-ring, -HALF - 1, -HALF - 1, HALF + 0.2), (HALF + 1, ring, -HALF - 1, HALF + 0.2)):
        g.box(x0, x1, 0.0, 0.03, z0, z1, "gravel", faces=("+y",))
    # the deep well with its slimy brick walls and fallen hoist (novel ¶168-169)
    wx, wz = gr["well"]["at"]
    wr = gr["well"]["radius"]
    g.cylinder(wx, wz, wr, -0.2, 0.8, "whitewash-grey", seg=20, cap=False)
    g.cylinder(wx, wz, wr - 0.3, -6.0, 0.8, "whitewash-grey", seg=20, cap=False)
    g.cylinder(wx, wz, wr - 0.3, -6.0, -5.9, "water", seg=20)
    for s in range(20):  # the narrow parapet she walks on
        a0, a1 = 2 * math.pi * s / 20, 2 * math.pi * (s + 1) / 20
        pts = [(wx + (wr - 0.3) * math.cos(a0), 0.8, wz + (wr - 0.3) * math.sin(a0)), (wx + wr * math.cos(a0), 0.8, wz + wr * math.sin(a0)),
               (wx + wr * math.cos(a1), 0.8, wz + wr * math.sin(a1)), (wx + (wr - 0.3) * math.cos(a1), 0.8, wz + (wr - 0.3) * math.sin(a1))]
        g.quad(pts, (0, 1, 0), "whitewash-grey")
    for s in (-1, 1):
        g.box(wx + s * 0.9 - 0.08, wx + s * 0.9 + 0.08, 0.8, 1.3 + 0.3 * s, wz - 0.08, wz + 0.08, "wood")  # broken stumps of the hoist
    col.box(wx - wr, wx + wr, 0, 0.8, wz - wr, wz + wr, "whitewash")
    # "What greeted him was a battered boundary wall with grey grass growing all over it" (novel ¶99,
    # comic b1-p004-6): close outside the west wing, blocking any view (the author, 21 Oct)
    import random
    rnd = random.Random(99)
    wx = -HALF - 4.8
    z = -HALF + 2
    while z < HALF - 2:  # in lengths of uneven height, its top broken
        z1 = min(HALF - 2, z + rnd.uniform(1.2, 2.6))
        h = rnd.uniform(3.0, 3.6)
        g.box(wx - 0.22, wx + 0.22, -0.3, h, z, z1, "whitewash-grey")
        for k in range(int((z1 - z) * 5)):  # grey grass in its top and its cracks
            gz = rnd.uniform(z, z1)
            gy = h if rnd.random() < 0.6 else rnd.uniform(0.4, h - 0.3)
            gx = wx + (0.0 if gy >= h else rnd.choice((-0.23, 0.23)))
            tall = rnd.uniform(0.12, 0.35)
            for s in (-1, 1):
                g.quad([(gx - 0.08, gy, gz + s * 0.02), (gx + 0.08, gy, gz - s * 0.02), (gx + 0.03, gy + tall, gz), (gx - 0.03, gy + tall, gz)], (s, 0, 1), "grass-grey")
        z = z1
    col.box(wx - 0.22, wx + 0.22, 0, 3.0, -HALF + 2, HALF - 2, "whitewash")
    # the servant quarters and Kurup's shed (novel ¶193, ¶1854)
    for key, roofmat in (("servant_quarters", "tiles"), ("kurup_shed", "iron")):
        x0, z0, x1, z1 = gr[key]["rect"]
        g.box(x0, x1, -0.3, 3.0, z0, z1, "whitewash")
        cz = (z0 + z1) / 2
        g.quad([(x0 - 0.4, 3.0, z1 + 0.4), (x1 + 0.4, 3.0, z1 + 0.4), (x1 + 0.4, 4.2, cz), (x0 - 0.4, 4.2, cz)], (0, 1, 1), roofmat)
        g.quad([(x0 - 0.4, 3.0, z0 - 0.4), (x1 + 0.4, 3.0, z0 - 0.4), (x1 + 0.4, 4.2, cz), (x0 - 0.4, 4.2, cz)], (0, 1, -1), roofmat)
        g.box((x0 + x1) / 2 - 0.5, (x0 + x1) / 2 + 0.5, 0, 2.1, z1, z1 + 0.04, "wood")
        col.box(x0, x1, 0, 3.0, z0, z1, "whitewash")
    # the back yard outside the kitchen door: wood pile, chopping stump, sink, clothes line (novel ¶195)
    yx, yz = gr["back_yard"]["at"]
    for k in range(14):
        g.cylinder(yx + (k % 7) * 0.32, yz + (k // 7) * 0.05, 0.15, 0.0 + (k // 7) * 0.3, 0.3 + (k // 7) * 0.3, "wood", seg=6)
    col.box(yx - 0.2, yx + 2.2, 0, 0.7, yz - 0.3, yz + 0.4, "wood")
    g.cylinder(yx + 3.2, yz + 1.5, 0.35, 0, 0.55, "wood", seg=10)
    g.box(yx - 1.5, yx - 0.3, 0, 0.85, yz + 2.5, yz + 3.3, "whitewash-grey")
    g.cylinder(yx - 0.9, yz + 2.9, 0.2, 0.85, 1.05, "iron", seg=8)
    for x in (yx + 4.5, yx + 9.5):
        g.box(x - 0.05, x + 0.05, 0, 2.0, yz - 1.0, yz - 0.9, "wood")
    g.box(yx + 4.5, yx + 9.5, 1.9, 1.92, yz - 0.97, yz - 0.93, "iron")


def build_back_wall_patch():
    """The green patch painted on the back wall (novel ¶1446-1451): a puzzle in
    the book, so the game shows it only to readers who have reached it."""
    patch = Geo()
    zb = -HALF - T / 2 - 0.02
    patch.quad([(-6, FLOOR + 1.0, zb), (6, FLOOR + 1.0, zb), (6, FLOOR + 3.6, zb), (-6, FLOOR + 3.6, zb)], (0, 0, -1), "green-patch")
    obj = patch.to_object("spoiler:back-wall-patch")
    obj["kind"] = "spoiler"
    obj["source"] = "novel ¶1446-1451"


def pot(g, x, z, r, y=None, mat="clay"):
    y0 = FLOOR if y is None else y
    g.sphere(x, y0 + r * 0.9, z, r, mat, seg=10)
    g.cylinder(x, z, r * 0.45, y0 + r * 1.6, y0 + r * 2.0, mat, seg=8, cap=False)


def plant(g, x, z, y=None, size=0.35):
    y0 = FLOOR if y is None else y
    g.cylinder(x, z, size * 0.7, y0, y0 + size * 1.2, "clay", seg=8)
    for a in range(5):
        ang = a * 2 * math.pi / 5
        g.sphere(x + size * 0.45 * math.cos(ang), y0 + size * 1.9, z + size * 0.45 * math.sin(ang), size * 0.6, "foliage", seg=6)


def from_the_comic(g, col):
    """Things the comic draws in each room that the plan's first pass left out
    (design §10.3). Each line names the panel it comes from."""
    # --- the study (comic b1-p004-8, b1-p007-2, b2-p027-9, b2-p033-11, b3-p016-6) ---
    # the veena leaning by the window (b1-p004-8, b1-p007-2): its own object, so a scene can
    # put its own in its place (Chapter 3 topples it)
    veena = Geo()
    veena.sphere(-14.9, FLOOR + 0.35, -11.4, 0.32, "wood", seg=10)
    veena.box(-14.97, -14.83, FLOOR + 0.5, FLOOR + 1.75, -11.47, -11.33, "wood")
    veena.sphere(-14.9, FLOOR + 1.85, -11.4, 0.14, "wood", seg=8)
    veena.to_object("veena")
    col.box(-15.25, -14.55, FLOOR, FLOOR + 0.8, -11.75, -11.05, "wood")
    # "It was as if the occupant had intended to cover every inch of available space with books" (novel ¶100,
    # comic b1-p004-9): another bookcase on the east wall, a low one along the south, and books in stacks
    # everywhere; specimens of flora and fauna in jars, not all labelled; small figurines of cast metal,
    # schist and clay crowding the shelves; large statues littering the floor; papers strewn about
    shelves(g, col, -5.5, -5.05, -15.5, -13.6)
    g.box(-14.3, -9.2, FLOOR, FLOOR + 1.2, -11.05, -10.73, "wood")
    g.quad([(-14.3, FLOOR + 0.08, -11.06), (-9.2, FLOOR + 0.08, -11.06), (-9.2, FLOOR + 1.1, -11.06), (-14.3, FLOOR + 1.1, -11.06)], (0, 0, -1), "books")
    col.box(-14.3, -9.2, FLOOR, FLOOR + 1.2, -11.05, -10.73, "wood")
    import random
    rnd = random.Random(100)
    for k in range(9):  # jars along the low bookcase's top
        jx = -14.0 + k * 0.5 + rnd.uniform(-0.08, 0.08)
        r = rnd.uniform(0.05, 0.09)
        h = rnd.uniform(0.16, 0.3)
        g.cylinder(jx, -10.9, r, FLOOR + 1.2, FLOOR + 1.2 + h, "glass", seg=10)
        g.cylinder(jx, -10.9, r * 0.9, FLOOR + 1.21, FLOOR + 1.2 + h * 0.75, "specimen", seg=10)
        g.cylinder(jx, -10.9, r * 1.05, FLOOR + 1.2 + h, FLOOR + 1.22 + h, "brass" if k % 3 else "clay", seg=10)
        if k % 2 == 0:
            g.box(jx - r * 0.6, jx + r * 0.6, FLOOR + 1.25, FLOOR + 1.29, -10.9 - r - 0.002, -10.9 - r, "paper")  # a label
    for k in range(8):  # figurines: cast metal, schist, clay (novel ¶100)
        fx_ = -13.9 + k * 0.6 + rnd.uniform(0.05, 0.2)
        m = ("brass", "schist", "clay")[k % 3]
        hh = rnd.uniform(0.12, 0.25)
        g.box(fx_ - 0.04, fx_ + 0.04, FLOOR + 1.2, FLOOR + 1.22, -10.84, -10.76, m)
        g.cylinder(fx_, -10.8, 0.025, FLOOR + 1.22, FLOOR + 1.22 + hh * 0.75, m, seg=6)
        g.sphere(fx_, FLOOR + 1.22 + hh * 0.85, -10.8, 0.025, m, seg=6)
    for x, z, mat, hh in ((-11.2, -14.3, "clay", 0.95), (-8.0, -11.8, "schist", 0.75), (-10.2, -11.6, "brass", 0.6)):
        # large statues, eroded, littering the floor (novel ¶100, comic b1-p004-9)
        g.cylinder(x, z, 0.16, FLOOR, FLOOR + 0.12, mat, seg=8)
        g.cylinder(x, z, 0.1, FLOOR + 0.12, FLOOR + hh * 0.8, mat, seg=8)
        g.sphere(x, FLOOR + hh * 0.88, z, 0.1, mat, seg=8)
        col.box(x - 0.18, x + 0.18, FLOOR, FLOOR + hh, z - 0.18, z + 0.18, "wood")
    for x, z, n in ((-10.3, -14.2, 7), (-6.2, -13.6, 5), (-9.6, -12.6, 4), (-14.0, -12.0, 6), (-12.0, -15.2, 8), (-7.4, -11.3, 3)):
        for k in range(n):  # more stacks of books, askew
            dx, dz = rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03)
            g.box(x - 0.17 + dx, x + 0.15 + dx, FLOOR + k * 0.065, FLOOR + (k + 1) * 0.065, z - 0.12 + dz, z + 0.12 + dz,
                  ("cloth", "wood", "paper", "cloth-pale")[rnd.randrange(4)])
        col.box(x - 0.2, x + 0.2, FLOOR, FLOOR + n * 0.065, z - 0.15, z + 0.15, "wood")
    for k in range(10):  # books lying on the desk and the couch
        bx_, bz_ = (rnd.uniform(-13.6, -12.0), rnd.uniform(-12.95, -12.3)) if k < 4 else (rnd.uniform(-7.35, -6.7), rnd.uniform(-13.4, -11.8))
        y = FLOOR + (0.83 if k < 4 else 0.46)
        g.box(bx_ - 0.09, bx_ + 0.09, y, y + 0.024, bz_ - 0.065, bz_ + 0.065, "paper")
        sheet(g, bx_, y + 0.026, bz_, 0.2, 0.15, rnd.uniform(0, 3), "cloth" if k % 2 else "wood")
    for k in range(26):  # working papers strewn all about: on the desk, on the floor round it
        if k < 9:
            sx_, sz_, y = rnd.uniform(-13.6, -12.0), rnd.uniform(-12.95, -12.25), FLOOR + 0.84 + k * 0.0012
        else:
            sx_, sz_, y = rnd.uniform(-14.6, -10.8), rnd.uniform(-13.9, -11.4), FLOOR + 0.017 + k * 0.0003
        sheet(g, sx_, y, sz_, 0.21, 0.297, rnd.uniform(0, math.pi), "paper")
    # clay pots on the floor (b1-p004-8, b1-p004-10)
    pot(g, -15.2, -14.0, 0.28)
    pot(g, -14.6, -14.3, 0.2)
    col.box(-15.5, -14.3, FLOOR, FLOOR + 0.6, -14.6, -13.6, "wood")
    # papers heaped on the desk, books stacked on the floor (b1-p004-8: "books everywhere")
    for k in range(4):
        g.box(-13.6 + k * 0.05, -13.1 + k * 0.03, FLOOR + 0.83 + k * 0.03, FLOOR + 0.86 + k * 0.03, -12.95, -12.55, "paper")
    for x, z, n in ((-8.8, -15.0, 6), (-7.6, -14.8, 4), (-11.0, -14.9, 5)):
        for k in range(n):
            g.box(x - 0.18 + 0.02 * (k % 2), x + 0.16, FLOOR + k * 0.07, FLOOR + (k + 1) * 0.07, z - 0.13, z + 0.13,
                  "cloth" if k % 3 == 0 else "wood" if k % 3 == 1 else "paper")
        col.box(x - 0.2, x + 0.2, FLOOR, FLOOR + n * 0.07, z - 0.15, z + 0.15, "wood")
    # drawers under the desk (b2-p027-9)
    g.box(-13.6, -13.0, FLOOR + 0.15, FLOOR + 0.72, -13.0, -12.2, "wood")
    # brass statues along the shelf tops (b1-p004-8, b3-p016-6)
    for x in (-9.0, -8.0, -7.0):
        g.cylinder(x, -15.45, 0.08, TOP - 0.4, TOP - 0.05, "brass", seg=6)
        g.sphere(x, TOP + 0.02, -15.45, 0.08, "brass", seg=6)
    # a rug under the desk (b1-p007-2)
    g.box(-14.6, -10.6, FLOOR + 0.005, FLOOR + 0.015, -13.8, -11.4, "rug", faces=("+y",))

    # --- the kitchen (novel ¶195; comic b1-p010-2, b4-p001-2) ---
    # an arched clay oven in the corner, a fire in its mouth (b1-p010-2)
    g.box(13.9, 15.6, FLOOR, FLOOR + 0.6, -15.6, -14.2, "clay")
    g.sphere(14.75, FLOOR + 0.6, -14.9, 0.75, "clay", seg=12)
    g.box(14.45, 15.05, FLOOR + 0.6, FLOOR + 1.0, -14.21, -14.15, "soot-dark")
    g.box(14.55, 14.95, FLOOR + 0.62, FLOOR + 0.85, -14.2, -14.12, "fire")
    col.box(13.9, 15.6, FLOOR, FLOOR + 1.3, -15.6, -14.1, "wood")
    # wall shelves of jars on the north wall (b1-p010-2)
    for k, y in enumerate((FLOOR + 1.5, FLOOR + 2.1)):
        g.box(6.0, 10.0, y, y + 0.04, -15.75, -15.45, "wood")
        for j in range(9):
            x = 6.2 + j * 0.44
            if (j + k) % 2:
                g.cylinder(x, -15.6, 0.1, y + 0.04, y + 0.32, "glass", seg=8)
                g.cylinder(x, -15.6, 0.11, y + 0.32, y + 0.36, "brass", seg=8)
            else:
                pot(g, x, -15.6, 0.12, y + 0.04, "brass" if j % 3 == 0 else "clay")
    # strings of chillies and garlic by the prints (b1-p010-2)
    for k in range(3):
        x, z = 15.7, -10.9 - k * 0.25
        g.cylinder(x, z, 0.01, FLOOR + 1.6, FLOOR + 2.6, "iron", seg=4, cap=False)
        for j in range(8):
            g.sphere(x, FLOOR + 1.7 + j * 0.11, z, 0.045, "chilli" if k != 1 else "garlic", seg=6)
    # earthen pots and a basket of vegetables on the floor (b1-p010-2)
    for x, z, r in ((6.0, -11.2, 0.3), (6.6, -11.0, 0.22), (11.8, -15.3, 0.26)):
        pot(g, x, z, r)
    col.box(5.6, 6.95, FLOOR, FLOOR + 0.6, -11.6, -10.6, "wood")
    g.cylinder(7.6, -11.1, 0.32, FLOOR, FLOOR + 0.25, "wood", seg=10)
    for j, m in enumerate(("chilli", "garlic", "foliage", "clay", "chilli")):
        g.sphere(7.6 + 0.15 * math.cos(j * 1.3), FLOOR + 0.3, -11.1 + 0.15 * math.sin(j * 1.3), 0.08, m, seg=6)
    # soot over the whole deep end and the ceiling above the fire (novel ¶195)
    g.box(5.3, 15.7, TOP - 1.4, TOP - 0.31, -15.75, -15.73, "soot-dark")
    g.box(15.7, 15.73, TOP - 1.4, TOP - 0.31, -15.75, -10.75, "soot")
    g.box(5.3, 15.7, TOP - 0.02, TOP - 0.01, -16, -10.5, "soot-dark", faces=("-y",))

    # --- the verandah (comic b1-p008-2, b1-p012-2, b3-p031-1): potted plants along its edge ---
    v = spec["verandah"]
    for x in (-6.4, -5.2, -2.6, 2.6, 5.2, 6.4):
        plant(g, x, HALF + v["depth"] - 0.6)
        col.box(x - 0.3, x + 0.3, FLOOR, FLOOR + 0.9, HALF + v["depth"] - 0.9, HALF + v["depth"] - 0.3, "wood")

    # --- the courtyard: pots by the pillars (comic b1-p004-7, b3-p031-1) ---
    for x, z in ((-6.4, -8.6), (6.4, -8.6), (-6.4, 8.6), (6.4, 8.6), (-8.6, 0), (8.6, 0)):
        plant(g, x, z, y=FLOOR, size=0.4)
        col.box(x - 0.35, x + 0.35, FLOOR, FLOOR + 1.0, z - 0.35, z + 0.35, "wood")

    # --- the sitting room (comic b2-p001-7): curtains at the front window, a rug ---
    for x in (-11.55, -9.45):
        g.box(x - 0.25, x + 0.25, FLOOR + 0.8, FLOOR + 3.0, 15.65, 15.72, "cloth")
    g.box(-14.0, -7.0, FLOOR + 0.005, FLOOR + 0.015, 11.5, 14.5, "rug", faces=("+y",))

    # --- the dining hall: a lamp on the table ---
    g.cylinder(10.5, 13.25, 0.06, FLOOR + 0.78, FLOOR + 1.1, "brass", seg=8)
    g.cylinder(10.5, 13.25, 0.12, FLOOR + 1.1, FLOOR + 1.3, "lamp", seg=8)


def markers():
    R = {r["id"]: r for r in spec["rooms"]}
    gr = spec["grounds"]
    gx, gz = gr["gate"]["at"]
    empty("arrive:gate", gx, 0, gz + 6, heading=0.0, label="The lodge gate")
    empty("arrive:verandah", 0, FLOOR, HALF + 5, heading=0.0, label="The verandah")
    for r in spec["rooms"]:
        x0, z0, x1, z1 = r["rect"]
        empty(f"room:{r['id']}", (x0 + x1) / 2, FLOOR + 1, (z0 + z1) / 2, kind="room", label=r["name"], rect=json.dumps(r["rect"]))
    empty("room:corridor", 0, FLOOR + 1, 0, kind="room", label="The pillared corridor", rect=json.dumps([-RING, -RING, RING, RING]))
    for lk in spec["looks"]:
        x, y, z = lk["at"]
        empty(f"look:{lk['id']}", x, y, z, kind="look", label=lk["label"], text=lk["text"], pages=lk["pages"])
    empty("spoiler:back-wall-patch", 0, FLOOR + 2.3, -HALF, kind="spoiler", page=spec["back_wall_patch"]["page"])


def collision_object(col):
    obj = col.to_object("collision")
    obj["kind"] = "collision"
    return obj


def render_views():
    """Renders from the comic's own viewpoints, for comparing with its panels."""
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = "Standard"  # show the textures' own colours, as the game does
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.82, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.color = (1.0, 0.92, 0.78)  # a warm low sun, as the comic paints it
    sun.rotation_euler = (math.radians(50), 0, math.radians(-130))
    scene.collection.objects.link(sun)
    views = {
        "gate": ((0, 1.7, 82), (0, 4.0, 0)),  # comic b1-p008-2
        "aerial": ((0, 46, 60), (0, 0, -2)),  # comic b3-p031-1
        "courtyard": ((-9.0, FLOOR + 1.6, 9.0), (4, FLOOR + 1.8, -4)),  # comic b1-p004-7
        "study": ((-6.5, FLOOR + 1.6, -11.2), (-14, FLOOR + 1.0, -14)),  # comic b2-p027-9
        "kitchen": ((7.0, FLOOR + 1.6, -11.0), (15.5, FLOOR + 1.6, -14.0)),  # comic b1-p010-2
        "verandah": ((-9, 1.6, 26), (0, 3.0, 16)),  # comic b1-p012-2
    }
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 24
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    hidden = [o for o in scene.objects if o.name == "collision"]
    for o in hidden:
        o.hide_render = True
    for name, (eye, look) in views.items():
        cam.location = B(*eye)
        d = Vector(B(*look)) - Vector(B(*eye))
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{RENDERS}/lodge-{name}.png"
        bpy.ops.render.render(write_still=True)
    for o in (sun, cam):
        bpy.data.objects.remove(o)


AO_SIZE = 2048  # one atlas for the whole lodge; the pipeline keeps it at this size
AO_DISTANCE = 1.2  # metres: corners, skirting lines, the eaves' undersides, beam joints, pillar feet
AO_SAMPLES = 512


def gpu_or_cpu():
    """Cycles on the GPU if there is one: the bake is many rays."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = "GPU"
                return kind
    except Exception as e:  # noqa: BLE001 (any failure: the CPU will do)
        print("no GPU for the bake:", e)
    scene.cycles.device = "CPU"
    return "CPU"


AO_PAD = 2  # texels of gutter round each quad, which the bake's margin fills
AO_MAX = 320  # texels: the lawn and the drive needn't be as sharp as a skirting line
AO_GAP = 10  # texels between one object's islands and the next's: more than the bake's margin


def lightmap_pack(objs):
    """Every quad (Geo makes each its own island) gets a rectangle of the atlas
    in proportion to its size in metres, shelf-packed, at the largest scale that
    fits. Blender's own unwrappers choke on this many separate islands."""
    rects = []  # (texel w and h at scale 1, object, polygon)
    for o in objs:
        me = o.data
        for poly in me.polygons:
            v = [Vector(me.vertices[i].co) for i in poly.vertices]
            w = max((v[1] - v[0]).length, (v[2] - v[3]).length)
            h = max((v[3] - v[0]).length, (v[2] - v[1]).length)
            rects.append((w, h, o, poly))

    def size(w, h, s):
        return max(2, min(AO_MAX, math.ceil(w * s))), max(2, min(AO_MAX, math.ceil(h * s)))

    index = {o.name: i for i, o in enumerate(objs)}

    def pack(s):
        """Shelves, tallest first, each object in shelves of its own: Cycles bakes the
        objects one at a time, and each one's margin would paint over the edges of the
        others' islands if they were near."""
        order = sorted(range(len(rects)), key=lambda k: (index[rects[k][2].name], -size(rects[k][0], rects[k][1], s)[1]))
        at = [None] * len(rects)
        x = y = shelf = 0
        last = None
        for k in order:
            w, h = size(rects[k][0], rects[k][1], s)
            W, H = w + 2 * AO_PAD, h + 2 * AO_PAD
            if rects[k][2] is not last and last is not None:
                x, y, shelf = 0, y + shelf + AO_GAP, 0
            last = rects[k][2]
            if x + W > AO_SIZE:
                x, y, shelf = 0, y + shelf, 0
            if y + H > AO_SIZE:
                return None
            at[k] = (x + AO_PAD, y + AO_PAD, w, h)
            x += W
            shelf = max(shelf, H)
        return at

    lo, hi = 0.5, 200.0  # texels per metre
    best = pack(lo)
    for _ in range(18):
        mid = (lo + hi) / 2
        got = pack(mid)
        if got:
            lo, best = mid, got
        else:
            hi = mid
    print(f"AO atlas: {len(rects)} quads at {lo:.1f} texels per metre")
    for (w, h, o, poly), (x, y, pw, ph) in zip(rects, best):
        uv = o.data.uv_layers["AO"].data
        corners = [(x, y), (x + pw, y), (x + pw, y + ph), (x, y + ph)]
        for li, (u, v) in zip(poly.loop_indices, corners):
            uv[li].uv = (u / AO_SIZE, v / AO_SIZE)


def bake_ao(baked):
    """Ambient occlusion, baked with Cycles into one atlas on a second UV set,
    and handed to glTF as each material's occlusion texture (the game reads it
    as aoMap on uv channel 1). The door leaves move, so they're left out of the
    bake: they and the hidden collision copy point their second UVs at a texel
    that saw open sky."""
    others = [o for o in scene.objects if o.type == "MESH" and o not in baked]
    for o in baked + others:
        o.data.uv_layers.new(name="AO")
    lightmap_pack(baked)

    img = bpy.data.images.new("lodge-ao", AO_SIZE, AO_SIZE, alpha=False)
    img.generated_color = (1, 1, 1, 1)
    mats = {s.material for o in baked + others for s in o.material_slots if s.material}
    mats.discard(MATS.get("green-patch"))  # the spoiler patch: hidden at first, and flat on a wall
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    for m in mats:
        nt = m.node_tree
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "AO"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        nt.nodes.active = tex  # the bake writes into the active image node
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        out = nt.nodes.new("ShaderNodeGroup")
        out.node_tree = group
        nt.links.new(sep.outputs["Red"], out.inputs["Occlusion"])

    scene.render.engine = "CYCLES"
    print("AO bake on", gpu_or_cpu())
    scene.cycles.samples = AO_SAMPLES
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake")
    scene.world.light_settings.distance = AO_DISTANCE
    hidden = [o for o in scene.objects if o.type == "MESH" and o not in baked]
    for o in hidden:  # the doors (they swing), the collision copy (it would shade everything), the patch
        o.hide_render = True
    for o in scene.objects:
        o.select_set(o in baked)
    bpy.context.view_layer.objects.active = baked[0]
    bpy.ops.object.bake(type="AO", margin=6, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES", uv_layer="AO")
    for o in hidden:
        o.hide_render = False
    img.filepath_raw = f"{TEX}/lodge-ao.png"
    img.file_format = "PNG"
    img.save()
    if RENDERS != "-":
        img.save_render(f"{RENDERS}/lodge-ao.png")

    # a texel in open sky for the things left out of the bake
    import numpy as np
    px = np.empty(AO_SIZE * AO_SIZE * 4, np.float32)
    img.pixels.foreach_get(px)
    ao = px.reshape(AO_SIZE, AO_SIZE, 4)[:, :, 0]
    r = 6
    ok = ao > 0.995
    for dy in (-r, r):  # white across a block, so mipmaps and the 1024 fallback keep it white
        ok &= np.roll(ok, dy, 0)
    for dx in (-r, r):
        ok &= np.roll(ok, dx, 1)
    ys, xs = np.nonzero(ok[r:-r, r:-r])
    if len(ys):
        u, v = (xs[0] + r + 0.5) / AO_SIZE, (ys[0] + r + 0.5) / AO_SIZE
    else:
        k = int(np.argmax(ao))
        u, v = (k % AO_SIZE + 0.5) / AO_SIZE, (k // AO_SIZE + 0.5) / AO_SIZE
    print(f"AO open-sky texel at {u:.4f}, {v:.4f}; mean AO {ao.mean():.3f}")
    for o in others:
        for d in o.data.uv_layers["AO"].data:
            d.uv = (u, v)


def bake_surface(baked, what):
    """Each atlas texel's position or normal (the plan's frame), as a float image:
    an emission bake of the geometry, for wear_masks to work from."""
    import numpy as np
    img = bpy.data.images.new(f"lodge-{what}", AO_SIZE, AO_SIZE, alpha=True, float_buffer=True)
    undo = []
    for m in {s.material for o in baked for s in o.material_slots if s.material}:
        nt = m.node_tree
        tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name == "lodge-ao")
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        before = [l.from_socket for l in out.inputs["Surface"].links]
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        emit = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(geo.outputs["Position" if what == "position" else "Normal"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        tex.image = img
        nt.nodes.active = tex
        undo.append((nt, tex, out, before, (geo, emit)))
    samples = scene.cycles.samples
    scene.cycles.samples = 1
    for o in scene.objects:
        o.select_set(o in baked)
    bpy.context.view_layer.objects.active = baked[0]
    bpy.ops.object.bake(type="EMIT", margin=6, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES", uv_layer="AO")
    scene.cycles.samples = samples
    for nt, tex, out, before, made in undo:
        for n in made:
            nt.nodes.remove(n)
        for s in before:
            nt.links.new(s, out.inputs["Surface"])
        tex.image = bpy.data.images["lodge-ao"]
    px = np.empty(AO_SIZE * AO_SIZE * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(AO_SIZE, AO_SIZE, 4)
    # Blender (x, y north, z up) -> the plan (x, y up, z south); alpha marks texels the bake reached
    return np.stack([px[:, :, 0], px[:, :, 2], -px[:, :, 1]], -1), px[:, :, 3] > 0.5


def wear_masks(baked):
    """Where the house has decayed (lodge.yaml `character`), as three masks over the
    occlusion atlas, written to lodge-wear.png; the game draws the detail (streaks,
    flakes, spots) with noise where they say:
        red    grime: the feet of walls, tight corners, the kitchen's soot
        green  damp: mould below the roof line and under the windows, damp rising
               at the walls' feet; the back wall worst (novel ¶164, ¶1446)
        blue   wear: paint peeling about the windows, doors and pillars (novel ¶164)
               on walls; rust dripped from the courtyard's bars on the floor (¶193)"""
    import numpy as np
    P, covered = bake_surface(baked, "position")
    N, _ = bake_surface(baked, "normal")
    ao = np.empty(AO_SIZE * AO_SIZE * 4, np.float32)
    bpy.data.images["lodge-ao"].pixels.foreach_get(ao)
    ao = ao.reshape(AO_SIZE, AO_SIZE, 4)[:, :, 0]
    X, Y, Z = P[..., 0], P[..., 1], P[..., 2]
    wall = np.abs(N[..., 1]) < 0.5
    up = N[..., 1] > 0.7

    def ramp(v, a, b):  # 0 at a, 1 at b
        return np.clip((v - a) / (b - a), 0, 1)

    # grime: the feet of walls (outside on the ground, inside on the floor, in the court a step down)
    h = np.full(X.shape, 9.0, np.float32)
    for base in (0.0, FLOOR, FLOOR - 0.3):
        d = Y - base
        h = np.where((d > -0.03) & (d < h), d, h)
    grime = np.where(wall, (1 - ramp(h, 0, 0.5)) ** 1.5 * 0.8, 0)
    grime = np.maximum(grime, (1 - ao) ** 2 * 0.9)
    # soot: the hearth and oven blacken the kitchen's deep end and the ceiling over them (novel ¶195)
    for hx, hy, hz, r in ((14.75, FLOOR + 0.8, -14.6, 3.2), (10.5, TOP - 1.1, -13.2, 1.2)):
        d = np.sqrt((X - hx) ** 2 + ((Y - hy) * 0.6) ** 2 + (Z - hz) ** 2)
        grime = np.maximum(grime, (1 - ramp(d, 0, r)) * np.where(Y > hy - 0.4, 1.0, 0.4))
    kitchen = (X > 5) & (X < 16) & (Z > -16) & (Z < -10.5)
    grime = np.maximum(grime, np.where(kitchen, ramp(Y, TOP - 1.8, TOP) * 0.7, 0))

    # damp: under the roof line on the outer walls, under the windows, rising at the feet
    outer = wall & ((np.abs(X) > HALF - 0.05) | (np.abs(Z) > HALF - 0.05)) & (Y < TOP + 1.5)
    damp = np.where(outer, ramp(Y, TOP - 2.0, TOP - 0.2) * 0.9, 0)
    damp = np.maximum(damp, np.where(wall, (1 - ramp(h, 0, 0.9)) * 0.45, 0))
    damp = np.where(outer & (Z < -HALF + 0.05), np.maximum(damp, 0.35), damp)  # the grey stained back wall
    ops = openings()
    for orient, line, c, w, bottom, top, kind, room, n, raw in ops:
        along, across = (X, Z) if orient == "h" else (Z, X)
        near_wall = np.abs(across - line) < T / 2 + 0.06
        if kind == "window":
            under = near_wall & (np.abs(along - c) < w / 2 + 0.08) & (Y < bottom)
            damp = np.maximum(damp, np.where(under, 1 - ramp(bottom - Y, 0, 1.5), 0))

    # wear: peeling paint about the openings and the pillars' feet and heads
    wear = np.zeros(X.shape, np.float32)
    for orient, line, c, w, bottom, top, kind, room, n, raw in ops:
        along, across = (X, Z) if orient == "h" else (Z, X)
        near_wall = np.abs(across - line) < T / 2 + 0.06
        du = np.maximum(np.abs(along - c) - w / 2, 0)
        dv = np.maximum(np.maximum(bottom - Y, Y - top), 0)
        d = np.sqrt(du ** 2 + dv ** 2)
        facing = np.abs(N[..., 2] if orient == "h" else N[..., 0]) > 0.7  # the wall's own faces, not the opening's reveals
        wear = np.maximum(wear, np.where(near_wall & facing, (1 - ramp(d, 0, 0.5)) * 0.85, 0))
    p = H["pillars"]
    for k in np.arange(-COURT, COURT + 1e-3, p["spacing"]):
        for px_, pz in ((k, -COURT), (k, COURT), (-COURT, k), (COURT, k)):
            d = np.sqrt((X - px_) ** 2 + (Z - pz) ** 2)
            ends = np.minimum(np.abs(Y - FLOOR), np.abs(Y - TOP))
            wear = np.maximum(wear, np.where(d < p["diameter"] / 2 + 0.2, (1 - ramp(ends, 0, 0.7)) * 0.8, 0))
    # the ceilings: "yellowed out paint had peeled off around the edges of the unusually high walls" (novel ¶93)
    down = (N[..., 1] < -0.7) & (np.abs(Y - TOP) < 0.05)
    for r in spec["rooms"]:
        x0, z0, x1, z1 = r["rect"]
        inside = down & (X > x0) & (X < x1) & (Z > z0) & (Z < z1)
        d = np.minimum(np.minimum(X - x0 - T / 2, x1 - T / 2 - X), np.minimum(Z - z0 - T / 2, z1 - T / 2 - Z))
        wear = np.maximum(wear, np.where(inside, (1 - ramp(d, 0, 0.6)) * 0.8, 0))
        # "marks around the corners told tales of cobwebs recently dusted off" (novel ¶93): grey smudges
        # where two walls meet the ceiling
        dx = np.minimum(X - x0 - T / 2, x1 - T / 2 - X)
        dz = np.minimum(Z - z0 - T / 2, z1 - T / 2 - Z)
        corner = (1 - ramp(np.sqrt(dx ** 2 + dz ** 2), 0, 0.55)) * 0.85
        grime = np.maximum(grime, np.where(inside, corner, 0))
    # rust: dripped from the bars over the court, on its floor
    court = up & (np.abs(X) < COURT) & (np.abs(Z) < COURT) & (Y < FLOOR)
    bars = np.full(X.shape, 9.0, np.float32)
    for i in range(-7, 8, 2):
        bars = np.minimum(bars, np.minimum(np.abs(X - i), np.abs(Z - i)))
    wear = np.where(court, (1 - ramp(bars, 0, 0.35)) * 0.9, wear)

    rgb = np.stack([grime, damp, wear], -1)
    rgb = np.where(covered[..., None], np.clip(rgb, 0, 1), 0)
    out = bpy.data.images.new("lodge-wear", AO_SIZE, AO_SIZE, alpha=False)
    out.pixels.foreach_set(np.concatenate([rgb, np.ones(X.shape + (1,))], -1).astype(np.float32).ravel())
    out.filepath_raw = f"{TEX}/lodge-wear.png"
    out.file_format = "PNG"
    out.save()
    print(f"AO wear masks: grime {grime[covered].mean():.3f}, damp {damp[covered].mean():.3f}, wear {wear[covered].mean():.3f}")


def main():
    setup_materials()
    house, grounds, furniture, col = Geo(), Geo(), Geo(), Geo()
    build_walls(house, col)
    build_floors(house, col)
    build_pillars(house, col)
    build_court_cover(house, col)
    build_roof(house)
    build_verandah(house, col)
    build_windows_and_doors(house, furniture)
    furnish(furniture, col)
    from_the_comic(furniture, col)
    build_grounds(grounds, col)
    baked = [house.to_object("house"), furniture.to_object("furniture"), grounds.to_object("grounds")]
    baked += [o for o in scene.objects if o.name.startswith("gate:")]  # the iron gates stand open for good
    if PANES:
        PANES[0].to_object("window-glass")
        PANES[1].to_object("window-frames")
    build_back_wall_patch()
    markers()
    collision_object(col)
    if RENDERS != "-":
        render_views()
    bake_ao(baked)
    wear_masks(baked)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, export_image_format="WEBP", use_selection=False)
    json.dump(MARKERS, open(OUT + ".markers.json", "w", encoding="utf-8"), indent=1)
    print(f"LODGE OK {OUT}")


main()
