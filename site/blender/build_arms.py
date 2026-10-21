"""Dvij's own arms, for first person (design §10.4): from Quaternius's CC0 Universal Base
Characters (the Superhero male base, rigged, with fingers), cut down to the arms and dressed as the
novel has him: "an oversize gown constantly slipped over his shoulders" (novel ¶98), and his right
arm "covered in a plaster from beyond the elbow" (¶96; right, the author 21 Oct).

Run by pipeline/build_arms.py, never by hand:
    blender --background --factory-startup --python blender/build_arms.py -- <base.gltf> <out.glb>
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
for o in list(bpy.data.objects):  # the face, eyes and hair: not seen from inside the head
    if o.type == "MESH" and o is not body:
        bpy.data.objects.remove(o)

SIDES = ("l", "r")
ARM_BONES = {f"{b}_{s}" for s in SIDES for b in ("upperarm", "lowerarm", "hand")} | {
    f"{f}_{k:02d}_{s}" for s in SIDES for f in ("index", "middle", "pinky", "ring", "thumb") for k in (1, 2, 3)}

# keep only what is mostly the arms: from part way down the upper arm to the fingertips
groups = {g.index: g.name for g in body.vertex_groups}
me = body.data
keep = set()
for v in me.vertices:
    w_arm = sum(g.weight for g in v.groups if groups.get(g.group) in ARM_BONES)
    w_all = sum(g.weight for g in v.groups) or 1
    if w_arm / w_all > 0.75:
        keep.add(v.index)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for v in me.vertices:
    v.select = v.index not in keep
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.delete(type="VERT")
bpy.ops.object.mode_set(mode="OBJECT")
body.name = "arms-skin"


def bone_head_tail(name):
    b = arm.data.bones[name]
    return arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local


def tube(name, a, b, r0, r1, mat, groups_at, seg=14, flare=0.0):
    """A loose tube from a to b (world), its radius r0 to r1, weighted to bones along it:
    groups_at = [(bone, weight at a, weight at b), ...]."""
    axis = (b - a)
    length = axis.length
    axis.normalize()
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = axis.cross(Vector((0, 1, 0)))
    side.normalize()
    up = side.cross(axis).normalized()
    rings = 6
    verts, faces = [], []
    for i in range(rings + 1):
        t = i / rings
        r = r0 + (r1 - r0) * t + flare * t ** 3
        c = a + axis * (length * t)
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            verts.append(c + (side * math.cos(ang) + up * math.sin(ang)) * r * (1 + 0.06 * math.sin(ang * 3 + t * 4)))
    for i in range(rings):
        for k in range(seg):
            a0, a1 = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a0, a1, a1 + seg, a0 + seg))
    m = bpy.data.meshes.new(name)
    m.from_pydata([tuple(v) for v in verts], [], faces)
    m.materials.append(mat)
    for p in m.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, m)
    bpy.context.scene.collection.objects.link(o)
    for bone, wa, wb in groups_at:
        g = o.vertex_groups.new(name=bone)
        for i in range(rings + 1):
            t = i / rings
            g.add([i * seg + k for k in range(seg)], wa + (wb - wa) * t, "REPLACE")
    o.parent = arm
    o.matrix_parent_inverse = arm.matrix_world.inverted()  # (its vertices are in the world's frame)
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return o


def material(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


GOWN = material("gown", (0.62, 0.6, 0.53), 0.95)  # a faded, borrowed cotton gown
PLASTER = material("plaster-cast", (0.78, 0.75, 0.68), 1.0)  # "much like the plaster exposed in the patches on the walls" (¶96)

for s in SIDES:
    sh, el = bone_head_tail(f"upperarm_{s}")
    el2, wr = bone_head_tail(f"lowerarm_{s}")
    # the gown's sleeve: loose, from the shoulder to below the elbow, wider at its end
    fore = (wr - el2)
    tube(f"sleeve_{s}", sh, el2 + fore * 0.35, 0.07, 0.085, GOWN,
         [(f"upperarm_{s}", 1.0, 0.0), (f"lowerarm_{s}", 0.0, 1.0)], flare=0.02)
    if s == "r":  # the cast, from above the elbow to the wrist, the hand left free
        up = el - sh
        tube("cast_r", el - up * 0.3, wr - fore * 0.04, 0.052, 0.042, PLASTER,
             [(f"upperarm_{s}", 1.0, 0.0), (f"lowerarm_{s}", 0.0, 1.0)], seg=16)

# only the arm bones' chain is wanted, but the export keeps the skeleton whole: the game moves the arms' bones
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_skins=True, export_image_format="WEBP",
                          use_selection=False, export_animations=False)
print(f"ARMS OK {OUT} {len(keep)} skin vertices")
