"""One of the valley's people, made with MakeHuman (MPFB) and dressed as the novel and the comic have
them (design §10.4, graphics phase 5; the character sheet is .downloads/graphics-people/characters.md).

  - The body: MPFB's base mesh shaped by its macro sliders (sex, age, build, height, ancestry)
    and a few face targets, with its "game_engine" skeleton (the same bone names as Quaternius's
    clips).
  - The face: shape keys a mouth and eyes can move with (a blink, the jaw, a smile, the brows), from
    MakeHuman's own expression units, carried over to the brows and lashes.
  - Skin, eyes, brows, lashes and hair: MakeHuman's CC0 system assets, the skin's texture toned to the
    person's own.
  - The clothes, made here from the body itself: a shell of the body's own faces for what fits
    (a shirt, a kurta's body, a wrap, a turban), MakeHuman's skirt and tights helpers for what hangs
    (a dhoti, a lungi, a kurta's skirts, a salwar, pyjamas), bands round the body (a shawl, the janeyu,
    a sash, a gamchha). Each keeps the body's own skinning, so it moves as the body does. Under a
    fitted shell the body's faces go.
  - Small things: a moustache, spectacles, a choti, the tilak, rudraksha beads.
  - The clips: Quaternius's CC0 Universal Animation Library, retargeted onto this skeleton (both are
    stood in a T-pose, each bone's turn from the one to the other kept, every frame baked).

Run by pipeline/build_people.py, never by hand (it gives Blender a user folder of its own, with MPFB):
    blender --background --factory-startup --python blender/build_human.py -- <spec.json>
"""
import json
import math
import random
import sys

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

spec = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402
from bl_ext.user_default.mpfb.services.faceservice import FaceService  # noqa: E402

MPFB_DATA = spec["mpfb_data"]
MH = spec["mh"]  # MakeHuman's system assets
rnd = random.Random(spec["who"])


def srgb(c):
    """A colour as written (sRGB, 0..1) -> linear, as Blender's materials want it."""
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c[:3])


# ---------------------------------------------------------------- the body
macro = TargetService.get_default_macro_info_dict()
for k, v in spec["macro"].items():
    if k == "race":
        macro["race"].update(v)
    else:
        macro[k] = v
body = HumanService.create_human(mask_helpers=False, macro_detail_dict=macro)
import os  # noqa: E402
for path, w in spec.get("targets", {}).items():
    full = f"{MPFB_DATA}/targets/{path}.target.gz"
    if not os.path.exists(full):
        print(f"PEOPLE WARNING: no target {path}")
        continue
    TargetService.load_target(body, full, weight=w)
TargetService.bake_targets(body)
lowest = min((body.matrix_world @ v.co).z for v in body.data.vertices)
body.location.z -= lowest
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# the face's shape keys, from MakeHuman's expression units (named as ARKit's, which MPFB carries to the brows and lashes)
UNITS = f"{MPFB_DATA}/targets/expression/units/caucasian"
body.shape_key_add(name="Basis", from_mix=False)
for unit, name, w in [("eye-left-closure", "eyeBlinkLeft", 1.0), ("eye-right-closure", "eyeBlinkRight", 1.0), ("mouth-open", "jawOpen", 0.8),
                      ("mouth-corner-puller", "mouthSmileLeft", 0.8), ("eyebrows-left-up", "browInnerUp", 0.5),
                      ("mouth-depression", "mouthFrownLeft", 0.7),
                      # the lips' shapes for speech: rounded (oo, oh), drawn wide (ee, ay), pressed shut (m, b, p)
                      ("mouth-pursing", "mouthPucker", 0.8), ("mouth-retraction", "mouthStretchLeft", 0.7),
                      ("mouth-compression", "mouthClose", 0.6)]:
    TargetService.load_target(body, f"{UNITS}/{unit}.target.gz", weight=0.0, name=name)
if spec.get("brows_both", True) and "browInnerUp" in body.data.shape_keys.key_blocks:
    # (a brow raised on one side looks like doubt: both go up together)
    TargetService.load_target(body, f"{UNITS}/eyebrows-right-up.target.gz", weight=0.0, name="browOuterUpRight")
for kb in body.data.shape_keys.key_blocks:
    kb.slider_max = 1.0

# the skeleton: MPFB's "game engine" rig (pelvis, spine_01..03, ... the names Quaternius's clips use)
HumanService.add_builtin_rig(body, "game_engine")
rig = body.parent
rig.name = spec["who"]

# ---------------------------------------------------------------- what MakeHuman gives: eyes, brows, lashes, hair
def mhclo(kind, name):
    path = f"{MH}/{kind}/{name}/{name}.mhclo"
    before = set(bpy.data.objects)
    HumanService.add_mhclo_asset(path, body, asset_type={"eyes": "Eyes", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "hair": "Hair"}[kind],
                                 subdiv_levels=0, material_type="MAKESKIN")
    obj = next(o for o in bpy.data.objects if o not in before and o.type == "MESH")
    obj.name = f"{kind}"
    return obj


def mhmat_texture(kind, name):
    """The diffuse texture an asset's .mhmat names."""
    import os
    folder = f"{MH}/{kind}/{name}"
    for f in os.listdir(folder):
        if f.endswith(".mhmat"):
            for line in open(f"{folder}/{f}", encoding="utf-8", errors="ignore"):
                if line.startswith("diffuseTexture"):
                    return f"{folder}/{line.split()[1].split('/')[-1]}"
    return None


def material(name, color=(1, 1, 1), rough=0.85, image=None, alpha=False, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if alpha:
        m.surface_render_method = "DITHERED"  # (the game cuts it out at half: src/lib/story/cast.ts)
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        bsdf.inputs["Emission Strength"].default_value = 0.4
    return m


def image(name, pixels):
    """A Blender image from an (h, w, 4) array of sRGB 0..1."""
    h, w = pixels.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.flipud(pixels).astype(np.float32).ravel())
    img.pack()
    return img


def toned(path, tone, name, contrast=0.85):
    """A texture recoloured: its light and shade kept, its colour the person's."""
    src = bpy.data.images.load(path)
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    lum = px[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mean = float(np.median(lum[lum > 0.05])) if (lum > 0.05).any() else 0.5
    rel = np.clip(lum / mean, 0, 3) ** contrast
    out = np.empty_like(px)
    for i in range(3):
        out[..., i] = np.clip(tone[i] * rel, 0, 1)
    out[..., 3] = px[..., 3]
    bpy.data.images.remove(src)
    return image(name, np.flipud(out))


def replace_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


skin = spec["skin"]
skin_img = toned(f"{MH}/skins/{skin['texture']}/{mhmat_texture('skins', skin['texture']).split('/')[-1]}", [c * 0.84 for c in skin["tone"]], "skin")  # (under the sun the tones read lighter than written)
replace_material(body, material("skin", image=skin_img, rough=0.62))

eyes = mhclo("eyes", "low-poly")
replace_material(eyes, material("eyes", image=bpy.data.images.load(f"{MH}/eyes/materials/{spec.get('iris', 'brown')}_eye.png"), rough=0.12))
for kind in ("eyebrows", "eyelashes"):
    name = spec.get(kind) or {"eyebrows": "eyebrow001", "eyelashes": "eyelashes01"}[kind]
    o = mhclo(kind, name)
    tex = mhmat_texture(kind, name)
    img = toned(tex, spec.get("brow_color", spec.get("hair_color", [0.06, 0.05, 0.05])), kind, 0.5) if tex else None
    replace_material(o, material(kind, image=img, alpha=True, rough=0.8))
hair_obj = None
if spec.get("hair"):
    o = hair_obj = mhclo("hair", spec["hair"])
    tex = mhmat_texture("hair", spec["hair"])
    img = toned(tex, spec.get("hair_color", [0.05, 0.04, 0.035]), "hair", 0.7) if tex else None
    replace_material(o, material("hair", image=img, alpha=True, rough=0.55))

# the face's keys over to the brows and lashes (MakeHuman's fitting tells how each of their points rides on the body)
FaceService.interpolate_targets(body)

# ---------------------------------------------------------------- where things are on this body
vg = {g.index: g.name for g in body.vertex_groups}
BONES = {b.name for b in rig.data.bones}
V = [body.matrix_world @ v.co for v in body.data.vertices]
N = [(body.matrix_world.to_3x3() @ v.normal).normalized() for v in body.data.vertices]
member = {}  # vertex -> set of named groups it is in
dominant = {}  # vertex -> the bone that moves it most
for v in body.data.vertices:
    best, bw = None, 0
    names = set()
    for g in v.groups:
        n = vg[g.group]
        names.add(n)
        if n in BONES and g.weight > bw:
            best, bw = n, g.weight
    member[v.index] = names
    dominant[v.index] = best


def joint(name):
    """The middle of one of the base mesh's joint helpers (world)."""
    pts = [V[i] for i, s in member.items() if name in s]
    return sum(pts, Vector()) / len(pts)


def bone_head(name):
    return rig.matrix_world @ rig.data.bones[name].head_local


in_body = {i for i, s in member.items() if "body" in s}
HEAD_TOP = max(V[i].z for i in in_body)
NECK = bone_head("neck_01").z
WAIST = bone_head("spine_01").z + 0.02
KNEE = bone_head("calf_l").z
ANKLE = bone_head("foot_l").z
SHOULDER = bone_head("upperarm_l").z
EYE_L, EYE_R = joint("helper-l-eye"), joint("helper-r-eye")
BROW = max(EYE_L.z, EYE_R.z) + 0.022
lips = [V[i] for i, s in member.items() if "lips" in s]
LIP_TOP = max(p.z for p in lips)
MOUTH = sum(lips, Vector()) / len(lips)
FRONT = min(p.y for p in lips)  # (the body faces -y)
TORSO_BONES = {"pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r"}
print("PEOPLE MEASURES", dict(top=HEAD_TOP, neck=NECK, waist=WAIST, knee=KNEE, ankle=ANKLE, brow=BROW, lip=LIP_TOP))


def blush(where, color, strength):
    """Paint a flush into the skin's texture where body vertices pass `where` (Vaidji's ruddy cheeks and feet, ¶104, ¶127)."""
    w, h = skin_img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    skin_img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    uvl = body.data.uv_layers.active.data
    mask = np.zeros((h, w), dtype=np.float32)
    rad = max(2, int(w * 0.012))
    yy, xx = np.mgrid[-rad:rad + 1, -rad:rad + 1]
    disk = np.clip(1 - np.sqrt(xx ** 2 + yy ** 2) / rad, 0, 1)
    for poly in body.data.polygons:
        for li in poly.loop_indices:
            vi = body.data.loops[li].vertex_index
            k = where(vi)
            if k <= 0:
                continue
            u, v = uvl[li].uv
            cx, cy = int(u * w) % w, int(v * h) % h
            y0, y1, x0, x1 = max(cy - rad, 0), min(cy + rad + 1, h), max(cx - rad, 0), min(cx + rad + 1, w)
            mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], disk[y0 - cy + rad:y1 - cy + rad, x0 - cx + rad:x1 - cx + rad] * k)
    m = (mask * strength)[..., None]
    px[..., :3] = px[..., :3] * (1 - m) + px[..., :3] * np.array(srgb(color)) * 1.6 * m
    skin_img.pixels.foreach_set(px.ravel())
    skin_img.pack()


if hair_obj is not None and spec.get("hair_length"):
    # longer, down the back: the strands behind the neck drawn down (Bhavi's "cascaded down ... to almost her mid-ribs", ¶166)
    k = spec["hair_length"]
    back = bone_head("neck_01").y
    for v in hair_obj.data.vertices:
        w = hair_obj.matrix_world @ v.co
        if w.z < NECK and w.y > back - 0.02:
            drop = (NECK - w.z) * (k - 1)
            w2 = Vector((w.x * 0.97, w.y + drop * 0.12, w.z - drop))  # (falling a little out, over the shoulder blades)
            v.co = hair_obj.matrix_world.inverted() @ w2
    if hair_obj.data.shape_keys:
        for kb in hair_obj.data.shape_keys.key_blocks:
            kb.data.foreach_set("co", [c for v in hair_obj.data.vertices for c in v.co]) if kb.name == "Basis" else None

if spec.get("blush"):
    bl = spec["blush"]
    cheek_c = [(EYE_L + MOUTH) / 2 + Vector((0.012, 0, 0)), (EYE_R + MOUTH) / 2 - Vector((0.012, 0, 0))]
    blush(lambda i: max(max(0.0, 1 - (V[i] - c).length / 0.035) for c in cheek_c) if dominant[i] == "head" else 0.0, bl["color"], bl["cheeks"])
    if bl.get("feet"):
        blush(lambda i: 1.0 if dominant[i] in ("foot_l", "foot_r", "ball_l", "ball_r") else 0.0, bl["color"], bl["feet"])


def arm_t(i, side):
    """How far down the arm a vertex is: 0 at the shoulder, 1 at the elbow, 2 at the wrist."""
    sh, el, wr = bone_head(f"upperarm_{side}"), bone_head(f"lowerarm_{side}"), bone_head(f"hand_{side}")
    p = V[i]
    a = (p - sh).dot((el - sh).normalized()) / (el - sh).length
    if a <= 1:
        return max(a, 0)
    return 1 + (p - el).dot((wr - el).normalized()) / (wr - el).length


def region(name, i):
    """Is body vertex i in a garment's region? (names below; parameters in the garment's spec)."""
    return name(i)


# ---------------------------------------------------------------- cloth and colour
def pattern(kind, base, ink, size=256):
    """A cloth's print as an image (sRGB): plain, a floral, checks, stripes, a border."""
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., :3] = base
    yy, xx = np.mgrid[0:size, 0:size] / size
    r = random.Random(kind)
    if kind == "floral":  # small red flowers scattered (Bhavi's kurta, b1-p008-4; her gown, b1-p012-2)
        for _ in range(26):
            cx, cy, s = r.random(), r.random(), 0.018 + r.random() * 0.012
            for k in range(5):
                a = k * 2 * math.pi / 5
                d = ((xx - cx - math.cos(a) * s) % 1) ** 2 + ((yy - cy - math.sin(a) * s) % 1) ** 2
                d = np.minimum(d, ((xx - cx - math.cos(a) * s + 0.5) % 1 - 0.5) ** 2 + ((yy - cy - math.sin(a) * s + 0.5) % 1 - 0.5) ** 2)
                px[d < (s * 0.7) ** 2, :3] = ink
    elif kind == "checks":  # a gamchha's checks (Maharaj's, b1-p010-2)
        band = ((xx * 8) % 1 < 0.45) | ((yy * 8) % 1 < 0.45)
        both = ((xx * 8) % 1 < 0.45) & ((yy * 8) % 1 < 0.45)
        px[band, :3] = np.array(base) * 0.4 + np.array(ink) * 0.6
        px[both, :3] = ink
    elif kind == "stripes":  # a shawl's stripes (Vaidji's, b1-p014-5)
        s = ((xx * 6) % 1 < 0.12) | (((xx * 6) % 1 > 0.2) & ((xx * 6) % 1 < 0.26))
        px[s, :3] = ink
    elif kind == "hair":  # short strands on nothing: a beard, a moustache, the skin showing between (cut out by the game)
        px[..., 3] = 0
        for _ in range(900):
            x0, y0 = r.random() * size, r.random() * size
            a = math.pi / 2 + (r.random() - 0.5) * 0.9
            for t in range(int(4 + r.random() * 6)):
                xi, yi = int(x0 + math.cos(a) * t) % size, int(y0 + math.sin(a) * t) % size
                px[yi, xi] = (*ink, 1.0)
                px[yi, (xi + 1) % size] = (*ink, 1.0)
    elif kind == "border":  # a plain cloth with a coloured border at one edge
        px[yy > 0.9, :3] = ink
    # a weave: a little light and shade, row by row
    px[..., :3] *= (0.94 + 0.06 * ((np.sin(xx * size * 1.6) * np.sin(yy * size * 1.6)) > 0))[..., None]
    return px


def cloth(name, color, kind="plain", ink=(0.6, 0.1, 0.08), rough=0.92):
    if kind == "hair":
        return material(name, image=image(f"{name}-hair", pattern("hair", color, color)), alpha=True, rough=0.8)
    if kind == "plain":  # one colour: carried in the mesh (merged with the person's other plain things, below)
        m = material(name, color=color, rough=rough)
        m["plain"] = True
        return m
    return material(name, image=image(f"{name}-print", pattern(kind, color, ink)), rough=rough)


def wrap_uv(obj, around=8.0, tall=9.0):
    """UVs that go round the body (u: the angle about its upright axis) and up it: a print stays the same size everywhere."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            us.append(math.atan2(co.x, -co.y) / (2 * math.pi))
        # (a face across the seam at the back keeps its corners on one side of it)
        if max(us) - min(us) > 0.5:
            us = [u + 1 if u < 0 else u for u in us]
        for li, u in zip(poly.loop_indices, us):
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (u * around, co.z * tall)


# ---------------------------------------------------------------- garments from the body
cut = set()  # body faces a garment covers: they go


def shell(name, keep, offset, mat, remove_under=True, swell=None, smooth=0, keys=False, drape=None):
    """A garment from the body's own faces whose corners all pass `keep`, pushed out `offset` along the normals.
    Its edge is straightened along itself (not a staircase of faces); its inside smoothed `smooth` times (cloth
    doesn't cling to every hollow); near its edge, where the skin goes on, it keeps clear of it. Under it the
    skin goes, all but a band at its edge (so no gap shows when the edge is straightened)."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    src_layer = bm.verts.layers.int.new("src")  # (which body vertex each came from, for hang)
    for v in bm.verts:
        v[src_layer] = v.index
    faces = [f for f in bm.faces if all(keep(v.index) for v in f.verts)]
    chosen = set(faces)
    if remove_under:
        rim = {v for f in faces for v in f.verts if any(g not in chosen for g in v.link_faces)}
        ring2 = rim | {e.other_vert(v) for v in rim for e in v.link_edges}
        cut.update(f.index for f in faces if not any(v in ring2 for v in f.verts))
    gone = [f for f in bm.faces if f not in chosen]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    src = {v: (v.co.copy(), v.normal.copy()) for v in bm.verts}
    edge = [v for v in bm.verts if v.is_boundary]
    for _ in range(8 if smooth else 3):  # the edge along itself
        moved = {}
        for v in edge:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                moved[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
        for v, co in moved.items():
            v.co = co
    if smooth:
        inside = [v for v in bm.verts if not v.is_boundary]
        for _ in range(smooth):
            bmesh.ops.smooth_vert(bm, verts=inside, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    if drape:
        hang(bm, *drape, src_layer)
        bm.normal_update()
    # near the edge (three rings in), clear of the skin left there
    near, front = set(edge), set(edge)
    for _ in range(3):
        front = {e.other_vert(v) for v in front for e in v.link_edges} - near
        near |= front
    for v in bm.verts:
        extra = swell(v.co) if swell else 0
        v.co += v.normal * (offset + extra)
        if v in near:
            co, n = src[v]
            d = (v.co - co).dot(n)
            if d < offset:
                v.co += n * (offset - d)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for g in body.vertex_groups:  # (the weights came over with the faces; their groups' names must too, in order)
        obj.vertex_groups.new(name=g.name)
    if me.shape_keys and not keys:  # (the face's keys don't belong to clothes; the teeth keep them, to open with the jaw)
        obj.shape_key_clear()
    finish(obj, mat)
    return obj


def convex_hull(pts):
    """A 2D convex hull, counter-clockwise (Andrew's monotone chain)."""
    p = sorted(map(tuple, pts))
    if len(p) < 3:
        return np.array(p)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0:
            hi.pop()
        hi.append(q)
    return np.array(lo[:-1] + hi[:-1])


def hang(bm, zlo, zhi, folds=0.004, src_layer=None):
    """Cloth hangs: between zlo and zhi it falls from what juts out above it (a chest, a belly, the shoulder blades)
    instead of tucking in under it, and fills the hollows across (no cleavage in a kurta); where it hangs free of
    the body it folds. Worked round the trunk's upright axis, face by face of the angle."""
    cy = bone_head("spine_02").y
    trunk = TORSO_BONES | {"thigh_l", "thigh_r"}  # (not the sleeves: the cloth falls from the chest, not from the arms)
    vs = [v for v in bm.verts if zlo <= v.co.z <= zhi and (src_layer is None or dominant.get(v[src_layer]) in trunk)]
    if len(vs) < 10:
        return
    P = np.array([(v.co.x, v.co.y - cy, v.co.z) for v in vs])
    th = np.arctan2(P[:, 0], P[:, 1])
    r = np.hypot(P[:, 0], P[:, 1])
    z = P[:, 2]
    new = r.copy()
    for i in range(len(vs)):
        dth = np.abs(np.angle(np.exp(1j * (th - th[i]))))
        near = dth < 0.22
        above = near & (z > z[i]) & (z < z[i] + 0.35)
        if above.any():  # falling from the widest point above, a little in as it goes down
            new[i] = max(new[i], min(np.max(r[above] - 0.25 * (z[above] - z[i]) - dth[above] * r[above] * 0.35), r[i] + 0.05))
        across = near & (np.abs(z - z[i]) < 0.03)
        if across.any():  # spanning the hollows between neighbours
            new[i] = max(new[i], np.max(r[across] * np.cos(dth[across])) - 0.004)
    # cloth spans the hollows: each level of it out to its convex hull (between the breasts, the spine's groove)
    for zc in np.arange(z.min(), z.max() + 0.01, 0.012):
        band = np.abs(z - zc) < 0.012
        if band.sum() < 6:
            continue
        xy = np.stack([np.sin(th[band]) * new[band], np.cos(th[band]) * new[band]], axis=1)
        hull = convex_hull(xy)
        ring = []
        for a_, b_ in zip(hull, np.roll(hull, -1, axis=0)):
            for t in np.linspace(0, 1, 12, endpoint=False):
                ring.append(a_ + (b_ - a_) * t)
        ring = np.array(ring)
        hth, hr = np.arctan2(ring[:, 0], ring[:, 1]), np.hypot(ring[:, 0], ring[:, 1])
        for i in np.nonzero(np.abs(z - zc) < 0.006)[0]:
            near = np.abs(np.angle(np.exp(1j * (hth - th[i])))) < 0.04
            if near.any():
                new[i] = max(new[i], hr[near].max() - 0.002)
    if spec["macro"].get("gender", 0.5) > 0.5:
        # a man's shirt or kurta stands off the chest: the radii smoothed over a hand's breadth (the skin under it is gone,
        # so nothing shows through)
        sm = new.copy()
        for i in range(len(vs)):
            dth = np.abs(np.angle(np.exp(1j * (th - th[i]))))
            nb = (dth < 0.35) & (np.abs(z - z[i]) < 0.07)
            sm[i] = new[nb].mean()
        new = np.maximum(sm, np.minimum(new, sm + 0.004))
        new = np.where(z < WAIST + 0.15, np.maximum(new, r), new)  # (never in at the hem, where it lies over a lungi or a dhoti)
    free = np.clip((new - r) / 0.03, 0, 1)
    new += folds * free * np.sin(th * 16 + z * 6)
    for v, t, rr in zip(vs, th, new):
        v.co.x, v.co.y = math.sin(t) * rr, cy + math.cos(t) * rr


def finish(obj, mat, weights_from_body=False):
    """Skin a garment to the rig (its own copied weights, or the body's nearest) and dress it."""
    me = obj.data
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    wrap_uv(obj)
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    if weights_from_body:
        for g in body.vertex_groups:
            if g.name in BONES and g.name not in obj.vertex_groups:
                obj.vertex_groups.new(name=g.name)
        dt = obj.modifiers.new("weights", "DATA_TRANSFER")
        dt.object = body
        dt.use_vert_data = True
        dt.data_types_verts = {"VGROUP_WEIGHTS"}
        dt.vert_mapping = "POLYINTERP_NEAREST"
        dt.layers_vgroup_select_src = "ALL"
        dt.layers_vgroup_select_dst = "NAME"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=dt.name)
    for g in list(obj.vertex_groups):  # only the bones' groups ride along
        if g.name not in BONES:
            obj.vertex_groups.remove(g)
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig


def helper(name, group, zmin, zmax, offset, mat, pleats=0.0, flare=0.0, bottom=None):
    """A garment from one of MakeHuman's helpers (the skirt, the tights): the part between zmin and zmax."""
    gi = next(g.index for g in body.vertex_groups if g.name == group)
    keep = {v.index for v in body.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups) and zmin - 0.02 <= V[v.index].z <= zmax}
    obj = shell(name, lambda i: i in keep, 0.0, mat, remove_under=False)
    zlo = min(v.co.z for v in obj.data.vertices) if bottom is None else bottom
    for v in obj.data.vertices:
        down = max(0.0, (zmax - v.co.z) / max(zmax - zlo, 0.01))
        a = math.atan2(v.co.x, -v.co.y)
        radial = Vector((v.co.x, v.co.y, 0))
        radial = radial.normalized() if radial.length > 1e-6 else Vector((0, -1, 0))
        # out from the body, a little more as it falls, in soft vertical folds
        v.co += v.normal * offset + radial * (flare * down ** 1.5 + pleats * down * math.sin(a * 14))
    return obj


def band(name, start, end, width, offset, mat, keep=None):
    """A band round the torso on the slant from `start` to `end` (a shawl, the janeyu, a sash), over what's there."""
    axis = (end - start).normalized()
    n = axis.cross(Vector((0, 1, 0))).normalized()  # (its plane holds the slant and the front-to-back line)
    ok = keep or (lambda i: dominant[i] in TORSO_BONES and i in in_body and V[i].z < NECK - 0.03)
    return shell(name, lambda i: ok(i) and abs((V[i] - start).dot(n)) < width / 2, offset, mat, remove_under=False, smooth=6)


def tube_mesh(name, pts, r, mat, bone, seg=8, closed=False):
    """A tube along points (world), all of it moving with one bone (spectacles' frames, a cord, beads)."""
    verts, faces = [], []
    n = len(pts)
    for k, p in enumerate(pts):
        a = pts[(k + 1) % n] - pts[k - 1] if closed else pts[min(k + 1, n - 1)] - pts[max(k - 1, 0)]
        a.normalize()
        s = a.cross(Vector((0, 0, 1)))
        if s.length < 1e-3:
            s = a.cross(Vector((0, 1, 0)))
        s.normalize()
        u = s.cross(a)
        for j in range(seg):
            t = 2 * math.pi * j / seg
            verts.append(p + (s * math.cos(t) + u * math.sin(t)) * r)
    for k in range(n if closed else n - 1):
        k2 = (k + 1) % n
        for j in range(seg):
            faces.append((k * seg + j, k * seg + (j + 1) % seg, k2 * seg + (j + 1) % seg, k2 * seg + j))
    return rigid(name, verts, faces, mat, bone)


def rigid(name, verts, faces, mat, bone):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(verts))), 1.0, "REPLACE")
    finish(obj, mat)
    return obj


def sphere_mesh(name, centre, r, mat, bone, scale=(1, 1, 1), seg=12):
    verts, faces = [], []
    rings = seg // 2
    for i in range(rings + 1):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            verts.append(centre + Vector((math.sin(th) * math.cos(ph) * r * scale[0], math.sin(th) * math.sin(ph) * r * scale[1], math.cos(th) * r * scale[2])))
    for i in range(rings):
        for j in range(seg):
            faces.append((i * seg + j, i * seg + (j + 1) % seg, (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j))
    return rigid(name, verts, faces, mat, bone)


# the regions a garment can be made of
def in_group_set(name):
    gi = next(g.index for g in body.vertex_groups if g.name == name)
    return {v.index for v in body.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}


def torso(zlo, zhi, sleeve=0.0):
    """The trunk between two heights, and the arms down to `sleeve` (1: the elbow, 2: the wrist)."""
    def keep(i):
        if i not in in_body or not (zlo <= V[i].z <= zhi):
            return False
        d = dominant[i]
        if d in TORSO_BONES or (d in ("thigh_l", "thigh_r") and V[i].z > zlo):
            return True
        for s in ("l", "r"):
            if d in (f"upperarm_{s}", f"lowerarm_{s}"):
                return arm_t(i, s) <= sleeve
        return False
    return keep


def legs(zlo, zhi):
    return lambda i: i in in_body and zlo <= V[i].z <= zhi and dominant[i] in ("pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r")


def scalp(zlo, back_only=False):
    def keep(i):
        if i not in in_body or dominant[i] not in ("head", "neck_01") or V[i].z < zlo:
            return False
        if "ears" in member[i]:
            return False
        if back_only:
            return V[i].y > EYE_L.y + 0.035 and V[i].z < HEAD_TOP - 0.05
        return V[i].y > EYE_L.y - 0.01 or V[i].z > BROW + 0.015
    return keep


def moustache_region(i, size=1.0):
    p = V[i]
    return (i in in_body and dominant[i] == "head" and LIP_TOP - 0.004 * size < p.z < LIP_TOP + 0.016 * size
            and abs(p.x) < (0.03 + (p.z - LIP_TOP) * 0.5) * (0.85 + 0.15 * size) and p.y < FRONT + 0.02)


def beard_region(i):
    p = V[i]
    if i not in in_body or dominant[i] not in ("head", "neck_01") or "lips" in member[i] or "ears" in member[i]:
        return False
    cheek = p.z < MOUTH.z + 0.035 and p.y < EYE_L.y + 0.045 and p.z > NECK - 0.02
    return cheek and not (abs(p.x) < 0.026 and abs(p.z - MOUTH.z) < 0.012)


for g in spec.get("garments", []):
    k = g["kind"]
    mat = cloth(g.get("name", k), g["color"], g.get("print", "hair" if k in ("beard", "moustache", "fringe") else "plain"), g.get("ink", (0.6, 0.1, 0.08)))
    nm = g.get("name", k)
    if k == "top":  # a shirt, a kurta's body, a vest, a wrap: from the waist (or lower) to the neck
        shell(nm, torso(g.get("from", WAIST - 0.1), NECK - g.get("neckline", 0.02), g.get("sleeve", 0.0)), g.get("offset", 0.014), mat,
              swell=lambda co: g.get("loose", 0.0) * max(0.0, (SHOULDER - co.z)) * 0.3 + (0.012 if co.z < WAIST + 0.06 else 0.0),  # (over what's tied at the waist)
              smooth=g.get("smooth", 14),
              drape=(g.get("from", WAIST - 0.1), SHOULDER - 0.02, 0.005))
    elif k == "skirt":  # a dhoti, a lungi, a kurta's skirts, a gown's: MakeHuman's skirt, cut at a height
        helper(nm, "helper-skirt", g.get("to", ANKLE + 0.06), g.get("top", WAIST + 0.04), g.get("offset", 0.012), mat,
               pleats=g.get("pleats", 0.006), flare=g.get("flare", 0.03))
    elif k == "dhoti":  # a dhoti as it is worn: both legs wrapped loose, the pleats gathered and tucked in front at the waist
        helper(nm, "helper-tights", g.get("to", ANKLE + 0.04), g.get("top", WAIST + 0.04), g.get("offset", 0.018), mat,
               pleats=0.008, flare=g.get("flare", 0.05))
        sk = in_group_set("helper-skirt")
        o = shell(nm + "-pleats", lambda i: i in sk and V[i].y < -0.02 and abs(V[i].x) < 0.06 and max(g.get("to", ANKLE + 0.04) + 0.1, KNEE - 0.05) <= V[i].z <= WAIST + 0.04,
                  0.0, mat, remove_under=False)
        for v in o.data.vertices:  # (the gathered pleats in front, close over the legs, ridged)
            v.co.y -= 0.004 + 0.004 * abs(math.sin(v.co.x * 260))
    elif k == "trousers":  # pyjamas, a salwar, shorts: MakeHuman's tights, cut at a height
        helper(nm, "helper-tights", g.get("to", ANKLE + 0.02), g.get("top", WAIST + 0.03), g.get("offset", 0.012), mat,
               pleats=g.get("pleats", 0.003), flare=g.get("flare", 0.0))
    elif k == "legs":  # shorts fitted from the body's own legs
        shell(nm, legs(g.get("to", KNEE + 0.08), g.get("top", WAIST + 0.03)), g.get("offset", 0.016), mat, smooth=4)
    elif k == "socks":
        shell(nm, lambda i: i in in_body and dominant[i] in ("calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r") and V[i].z < g.get("top", ANKLE + 0.14),
              0.003, mat)
    elif k == "band":  # over the left shoulder, down to the right hip (a shawl, the janeyu, a sash worn so)
        side = 1 if g.get("over", "l") == "l" else -1
        sh = bone_head(f"clavicle_{'l' if side > 0 else 'r'}") + Vector((side * 0.06, 0, 0.05))
        hip = bone_head(f"thigh_{'r' if side > 0 else 'l'}") + Vector((0, 0, 0.05))
        band(nm, sh, hip, g.get("width", 0.12), g.get("offset", 0.02), mat)
    elif k == "waistband":  # a sash, a gamchha tied round the waist
        shell(nm, lambda i: i in in_body and dominant[i] in TORSO_BONES | {"thigh_l", "thigh_r"} and abs(V[i].z - g.get("at", WAIST)) < g.get("width", 0.08) / 2,
              g.get("offset", 0.024), mat, remove_under=False)
    elif k == "stole":  # a shawl over both shoulders, its ends hanging in front (Vaidji's)
        shell(nm, lambda i: i in in_body and (dominant[i] in ("clavicle_l", "clavicle_r", "spine_03") and V[i].z > SHOULDER - 0.06
                                              or (dominant[i] in TORSO_BONES and V[i].y < 0 and 0.07 < abs(V[i].x) < 0.15 and V[i].z > WAIST))
              , g.get("offset", 0.022), mat, remove_under=False)
    elif k == "turban":  # a white wrap round the head (Maharaj, b1-p012-4)
        hc = Vector((0, (EYE_L.y + EYE_R.y) / 2 + 0.07, 0))
        # wound round and round, each turn on the slant, the cloth standing proud of the one under it
        o = shell(nm, scalp(BROW + 0.012), 0.032, mat, remove_under=True, smooth=3,
                  swell=lambda co: (0.011 * abs(math.sin((co.z - HEAD_TOP) * 70 + math.atan2(co.x, co.y - hc.y) * 1.0))
                                    + max(0.0, co.z - (HEAD_TOP - 0.06)) * 0.45))
    elif k == "bandage":  # "a heavily bandaged head" (¶101): gauze wound round and round it, over the brow
        hc = Vector((0, (EYE_L.y + EYE_R.y) / 2 + 0.07, 0))
        # gauze crossed over and over: two windings on opposite slants
        shell(nm, scalp(BROW - 0.004), 0.024, mat, remove_under=True, smooth=2,
              swell=lambda co: (0.006 * max(abs(math.sin(co.z * 110 + math.atan2(co.x, co.y - hc.y) * 2.0)),
                                            abs(math.sin(co.z * 110 - math.atan2(co.x, co.y - hc.y) * 2.0)))
                                + max(0.0, co.z - (HEAD_TOP - 0.08)) * 0.25))
    elif k == "cast":  # "a plaster from beyond the elbow" on the right arm (¶96; right: the author, 21 Oct)
        shell(nm, lambda i: i in in_body and (dominant[i] == "lowerarm_r" or (dominant[i] == "upperarm_r" and arm_t(i, "r") > 0.7)),
              0.02, mat, remove_under=True, smooth=4)
    elif k == "cap":  # a boat-shaped cotton cap (the villagers', b1-p015-1)
        top = HEAD_TOP - 0.035
        o = shell(nm, scalp(top - 0.035), 0.012, mat, remove_under=True)
        for v in o.data.vertices:
            v.co.z = min(v.co.z, top + 0.035 - abs(v.co.x) * 0.25)
    elif k == "fringe":  # what's left of the hair: a band round the back of the head (Vaidji, ¶127; b1-p006-7)
        shell(nm, scalp(EYE_L.z - 0.01, back_only=True), 0.007, mat, remove_under=False)
    elif k == "stubble":  # a shaved head's shadow
        shell(nm, scalp(BROW + 0.02), 0.0015, mat, remove_under=False)
    elif k == "moustache":
        sz = g.get("size", 1.0)
        shell(nm, lambda i: moustache_region(i, sz), 0.004, mat, remove_under=False, swell=lambda co: 0.002 * sz)
    elif k == "beard":
        shell(nm, beard_region, 0.004, mat, remove_under=False)
    elif k == "tilak":  # three lines of ash and a red mark (Mahant, ¶106; b1-p014-2)
        px = np.zeros((64, 128, 4), dtype=np.float32)
        for y0 in (20, 30, 40):
            px[y0:y0 + 4, 10:118] = (0.93, 0.92, 0.88, 1)
        px[16:48, 60:68] = (0.75, 0.08, 0.06, 1)
        mt = material(nm, image=image(nm, px), alpha=True, rough=0.9)
        o = shell(nm, lambda i: i in in_body and dominant[i] == "head" and BROW + 0.004 < V[i].z < BROW + 0.05 and abs(V[i].x) < 0.05 and V[i].y < EYE_L.y - 0.005,
                  0.0012, mt, remove_under=False)
        me = o.data
        uv = me.uv_layers.active.data
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv[li].uv = ((co.x + 0.05) / 0.1, (co.z - BROW - 0.004) / 0.046)
    elif k == "choti":  # the tuft of hair tied in a knot at the back of the head (¶106, ¶298)
        c = Vector((0, max(V[i].y for i in in_body if V[i].z > HEAD_TOP - 0.03) - 0.02, HEAD_TOP - 0.02))
        sphere_mesh(nm, c, 0.026, mat, "head", scale=(1, 0.9, 0.8))
        tube_mesh(nm + "-tuft", [c + Vector((0, 0.01, 0.01)), c + Vector((0, 0.035, -0.02)), c + Vector((0, 0.05, -0.06))], 0.008, mat, "head")
    elif k == "spectacles":  # round wire spectacles (the Professor, ¶136; b1-p007-2)
        for e, nmx in ((EYE_L, "l"), (EYE_R, "r")):
            c = e + Vector((0, -0.024, 0))
            ring = [c + Vector((math.cos(t) * 0.021, 0, math.sin(t) * 0.018)) for t in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
            tube_mesh(f"{nm}-{nmx}", ring, 0.0026, mat, "head", seg=6, closed=True)
            s = 1 if e.x > 0 else -1
            tube_mesh(f"{nm}-arm-{nmx}", [c + Vector((s * 0.021, 0, 0.004)), c + Vector((s * 0.03, 0.02, 0.006)), c + Vector((s * 0.034, 0.09, 0.0))], 0.002, mat, "head", seg=5)
        mid = (EYE_L + EYE_R) / 2 + Vector((0, -0.026, 0.004))
        tube_mesh(f"{nm}-bridge", [mid + Vector((-0.012, 0, 0)), mid + Vector((0, -0.003, 0.004)), mid + Vector((0.012, 0, 0))], 0.0015, mat, "head", seg=5)
    elif k == "beads":  # a rudraksha mala at the throat, hanging to the chest (b1-p014-2, b1-p015-6)
        nk = bone_head("neck_01")
        pts = []
        for t in np.linspace(0, 2 * math.pi, g.get("count", 54), endpoint=False):
            front = max(0.0, -math.cos(t))  # (t = 0 at the back)
            pts.append(nk + Vector((math.sin(t) * 0.075, math.cos(t) * 0.06 - front * 0.02, -0.02 - front ** 2 * g.get("drop", 0.16))))
        for j, p in enumerate(pts):
            sphere_mesh(f"{nm}-{j}", p, 0.0075, mat, "spine_03", seg=6)
    elif k == "ear-hair":  # "large ... ears ... with white hair in and around them" (the Professor, ¶136)
        for side in (1, -1):
            pts = [V[i] for i in in_body if "ears" in member[i] and V[i].x * side > 0]
            c = sum(pts, Vector()) / len(pts)
            c = c + Vector((-side * 0.004, -0.006, -0.004))
            r = random.Random(side)
            for j in range(9):
                d = Vector((side * (0.6 + r.random()), -0.3 + r.random() * 0.6, -0.2 + r.random() * 0.8)).normalized()
                tube_mesh(f"{nm}-{side}-{j}", [c, c + d * (0.006 + r.random() * 0.006)], 0.0009, mat, "head", seg=4)
    elif k == "clogs":  # khadau: a wooden sole, "toes tightly gripping the only knob" (Mahant, ¶104)
        for s_ in ("l", "r"):
            fv = [V[i] for i in in_body if dominant[i] in (f"foot_{s_}", f"ball_{s_}")]
            x0, x1 = min(p.x for p in fv) - 0.006, max(p.x for p in fv) + 0.006
            y0, y1 = min(p.y for p in fv) - 0.008, max(p.y for p in fv) + 0.004
            vs = [Vector((x, y, z)) for z in (-0.03, -0.002) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
            fs = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
            rigid(f"{nm}-{s_}", vs, fs, mat, f"foot_{s_}")
            inner = x1 - 0.022 if s_ == "l" else x0 + 0.022  # (between the big toe and the next)
            knob = Vector((inner, y0 + 0.035, -0.002))
            tube_mesh(f"{nm}-post-{s_}", [knob, knob + Vector((0, 0, 0.022))], 0.004, mat, f"foot_{s_}", seg=6)
            sphere_mesh(f"{nm}-knob-{s_}", knob + Vector((0, 0, 0.026)), 0.007, mat, f"foot_{s_}", seg=8)
    elif k == "sole":  # chappals: a leather sole under each foot (Baldev, ¶104)
        for s in ("l", "r"):
            fv = [V[i] for i in in_body if dominant[i] in (f"foot_{s}", f"ball_{s}")]
            x0, x1 = min(p.x for p in fv) - 0.008, max(p.x for p in fv) + 0.008
            y0, y1 = min(p.y for p in fv) - 0.01, max(p.y for p in fv) + 0.005
            vs = [Vector((x, y, z)) for z in (-0.002, 0.014) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
            fs = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
            rigid(f"{nm}-{s}", vs, fs, mat, f"foot_{s}")

# the mouth's inside, seen when it opens to speak: MakeHuman's teeth and tongue (Mahant's teeth red with paan, breakdown
# ch9), and a dark hollow behind them, all moving with the head (the lower teeth drop with the jaw's shape key)
def in_group(name):
    gi = next(g.index for g in body.vertex_groups if g.name == name)
    return {v.index for v in body.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}


def with_head(obj):
    for gr in list(obj.vertex_groups):
        obj.vertex_groups.remove(gr)
    obj.vertex_groups.new(name="head").add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")


teeth_mat = material("teeth", color=spec.get("teeth", [0.86, 0.82, 0.72]), rough=0.35)
for part, mat in (("helper-upper-teeth", teeth_mat), ("helper-lower-teeth", teeth_mat),
                  ("helper-tongue", material("tongue", color=[0.62, 0.28, 0.26], rough=0.5))):
    keep_set = in_group(part)
    o = shell(part.replace("helper-", ""), lambda i, k=keep_set: i in k, 0.0, mat, remove_under=False, keys=True)
    with_head(o)
hollow = sphere_mesh("mouth-hollow", MOUTH + Vector((0, 0.03, -0.004)), 0.024, material("mouth-hollow", color=[0.12, 0.05, 0.05], rough=0.9),
                     "head", scale=(1.2, 1.0, 0.8))

# the body: the skin under fitted clothes goes, and all MakeHuman's helpers
bm = bmesh.new()
bm.from_mesh(body.data)
bm.faces.ensure_lookup_table()
gone = [bm.faces[i] for i in cut]
bm.verts.ensure_lookup_table()
helpers = [v for v in bm.verts if v.index not in in_body]
bmesh.ops.delete(bm, geom=gone, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in helpers if v.is_valid], context="VERTS")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(body.data)
bm.free()
for m in list(body.modifiers):
    if m.type == "MASK":
        body.modifiers.remove(m)
for g in list(body.vertex_groups):
    if g.name not in BONES:
        body.vertex_groups.remove(g)
body.name = "skin"

# ---------------------------------------------------------------- the clips, onto this skeleton
bpy.ops.import_scene.gltf(filepath=spec["ual"])
ual = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not rig)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is ual:
        bpy.data.objects.remove(o, do_unlink=True)
wanted = set(spec["clips"])
for act in list(bpy.data.actions):
    nm = act.name.split("|")[-1]
    if nm in wanted:
        act.name = "src:" + nm
    elif not act.name.startswith(spec["who"]):
        bpy.data.actions.remove(act)

src_names = {b.name.lower(): b.name for b in ual.data.bones}
pairs = [(b.name, src_names[b.name.lower()]) for b in rig.data.bones if b.name.lower() in src_names and b.name.lower() != "root"]
order = [b.name for b in rig.data.bones if any(b.name == p[0] for p in pairs)]  # (parents before children: Blender lists them so)
order.sort(key=lambda n: len(rig.data.bones[n].parent_recursive))
src_of = dict(pairs)

ual.animation_data_create()
ual.animation_data.action = None
bpy.context.view_layer.update()


def world_rot(arm, pb):
    return arm.matrix_world.to_quaternion() @ pb.matrix.to_quaternion()


# stand this body as the library's stands at rest: its arms raised from MakeHuman's A-pose to the library's T-pose.
# (only the arms: the other bones are drawn differently in the two skeletons, but the bodies stand alike, and their
# difference is kept in each bone's offset below; turning them too would bend the body at the hips)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
for n in order:
    rig.pose.bones[n].rotation_mode = "QUATERNION"
for n in order:
    if not n.startswith(("upperarm_", "lowerarm_", "hand_")):
        continue
    pb = rig.pose.bones[n]
    sb = ual.data.bones[src_of[n]]
    want = (ual.matrix_world.to_3x3() @ (sb.tail_local - sb.head_local)).normalized()
    bpy.context.view_layer.update()
    now = (rig.matrix_world.to_3x3() @ (pb.tail - pb.head)).normalized()
    turn = now.rotation_difference(want)
    pb.rotation_mode = "QUATERNION"
    world = turn @ world_rot(rig, pb)
    parent_world = world_rot(rig, pb.parent) if pb.parent else rig.matrix_world.to_quaternion()
    rest_rel = (pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local).to_quaternion() if pb.parent else pb.bone.matrix_local.to_quaternion()
    pb.rotation_quaternion = (parent_world @ rest_rel).inverted() @ world
bpy.context.view_layer.update()
offset = {n: world_rot(ual, ual.pose.bones[src_of[n]]).inverted() @ world_rot(rig, rig.pose.bones[n]) for n in order}
hips_ratio = bone_head("pelvis").z / (ual.matrix_world @ ual.data.bones[src_of["pelvis"]].head_local).z
src_pelvis_rest = ual.matrix_world @ ual.data.bones[src_of["pelvis"]].head_local
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = Vector()

rig.animation_data_create()
step = spec.get("frame_step", 2)
for src_act in [a for a in bpy.data.actions if a.name.startswith("src:")]:
    clip = src_act.name[4:]
    ual.animation_data.action = src_act
    if hasattr(ual.animation_data, "action_slot") and src_act.slots:
        ual.animation_data.action_slot = src_act.slots[0]
    act = bpy.data.actions.new(clip)
    rig.animation_data.action = act
    f0, f1 = int(src_act.frame_range[0]), int(src_act.frame_range[1])
    for f in list(range(f0, f1 + 1, step)) + ([f1] if (f1 - f0) % step else []):
        bpy.context.scene.frame_set(f)
        world = {}
        for n in order:
            pb = rig.pose.bones[n]
            want = world_rot(ual, ual.pose.bones[src_of[n]]) @ offset[n]
            parent = pb.parent
            parent_world = world[parent.name] if parent and parent.name in world else (world_rot(rig, parent) if parent else rig.matrix_world.to_quaternion())
            rest_rel = (parent.bone.matrix_local.inverted() @ pb.bone.matrix_local).to_quaternion() if parent else pb.bone.matrix_local.to_quaternion()
            pb.rotation_quaternion = (parent_world @ rest_rel).inverted() @ want
            world[n] = want
            pb.keyframe_insert("rotation_quaternion", frame=f)
        # the hips go up and down, forward and back as the library's do, scaled to this body
        sp = ual.matrix_world @ ual.pose.bones[src_of["pelvis"]].head
        move = (sp - src_pelvis_rest) * hips_ratio
        pp = rig.pose.bones["pelvis"]
        rest_m = pp.bone.matrix_local
        pp.location = (rest_m.to_3x3().inverted() @ (rig.matrix_world.to_3x3().inverted() @ move))
        pp.keyframe_insert("location", frame=f)
    act.use_fake_user = True
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = Vector()
bpy.ops.object.mode_set(mode="OBJECT")
for o in list(bpy.data.objects):
    if o is ual or o.parent is ual:
        bpy.data.objects.remove(o, do_unlink=True)
for act in list(bpy.data.actions):
    if act.name.startswith("src:"):
        bpy.data.actions.remove(act)

# each clip a track of its own, so the exporter writes them all
for act in [a for a in bpy.data.actions if a.name in wanted]:
    tr = rig.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, int(act.frame_range[0]), act)

# fewer things to draw: everything plain-coloured and without face shapes (clothes, soles, beads, spectacles, the
# mouth's hollow) merged into one mesh, each part's colour kept in its vertices, one material for them all
def plain_colour(o):
    mats = [m for m in o.data.materials if m]
    if len(mats) != 1 or o.data.shape_keys:
        return None
    m = mats[0]
    if not (m.get("plain") or m.name.split(".")[0] in ("mouth-hollow",) or not any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes)):
        return None
    if any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes):
        return None
    return tuple(m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value)


merge = [(o, plain_colour(o)) for o in rig.children if o.type == "MESH" and o is not body]
merge = [(o, c) for o, c in merge if c is not None]
if len(merge) > 1 and not spec.get("no_merge"):
    for o, c in merge:
        ca = o.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for d in ca.data:
            d.color = c
    clothes_mat = bpy.data.materials.new("clothes")
    clothes_mat.use_nodes = True
    nt = clothes_mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.88
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    for o, _ in merge:
        o.data.materials.clear()
        o.data.materials.append(clothes_mat)
        for mod in list(o.modifiers):
            o.modifiers.remove(mod)
    bpy.ops.object.select_all(action="DESELECT")
    for o, _ in merge:
        o.select_set(True)
    bpy.context.view_layer.objects.active = merge[0][0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "clothes"
    mod = joined.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    print(f"PEOPLE merged {len(merge)} plain things into one")

# a crowd's people are seen from further off: fewer faces, no face shapes
if spec.get("lod"):
    for o in [c for c in rig.children if c.type == "MESH" and c.name.split(".")[0] in ("eyebrows", "eyelashes", "upper-teeth", "lower-teeth", "tongue")]:
        bpy.data.objects.remove(o, do_unlink=True)  # (too small to see from where they sit)
    for o in [c for c in rig.children if c.type == "MESH"]:
        if o.data.shape_keys:
            o.shape_key_clear()
        if len(o.data.polygons) > 200:
            d = o.modifiers.new("lod", "DECIMATE")
            d.ratio = spec["lod"]
            bpy.context.view_layer.objects.active = o
            o.modifiers.move(len(o.modifiers) - 1, 0)
            bpy.ops.object.modifier_apply(modifier=d.name)

# to the person's height (the clips' hips scale with the node)
tallest = max((o.matrix_world @ Vector(c)).z for o in rig.children if o.type == "MESH" for c in o.bound_box)
k = spec["height"] / tallest
rig.scale = (k, k, k)

for o in list(bpy.data.objects):
    if o is not rig and o.parent is not rig:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=spec["out"], export_format="GLB", export_skins=True, export_morph=True, export_image_format="WEBP",
                          export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                          export_frame_step=1, use_selection=False, export_yup=True)
tris = sum(len(p.vertices) - 2 for o in rig.children if o.type == "MESH" for p in o.data.polygons)
print(f"PEOPLE OK {spec['out']} {len([a for a in bpy.data.actions if a.name in wanted])} clips, {tris} triangles, "
      f"keys {len(body.data.shape_keys.key_blocks) if body.data.shape_keys else 0}, scale {k:.3f}")
