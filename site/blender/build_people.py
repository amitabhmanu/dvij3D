"""One of the valley's people, rigged and with their moves (design §10.4, graphics phase 5).

A body (glTF, on the UE-style skeleton Quaternius's characters use) is given the clips it needs
from Quaternius's CC0 Universal Animation Library, which is made for that skeleton. It is
exported as one glb: the body, its skeleton and its clips.

Run by pipeline/build_people.py, never by hand:
    blender --background --factory-startup --python blender/build_people.py -- <spec.json>
spec: {"body": <gltf>, "ual": <glb>, "clips": [names], "out": <glb>, "height": metres,
       "keep": [mesh names to keep, or empty for all]}
"""
import json
import sys

import bpy

spec = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
bpy.ops.wm.read_factory_settings(use_empty=True)

# the clips, on the library's own mannequin
bpy.ops.import_scene.gltf(filepath=spec["ual"])
lib_objects = set(bpy.data.objects)
lib_arm = next(o for o in lib_objects if o.type == "ARMATURE")
wanted = set(spec["clips"])
for act in list(bpy.data.actions):
    name = act.name.split("|")[-1]  # (the importer may prefix the armature's name)
    if name in wanted:
        act.name = name
        act.use_fake_user = True
    else:
        bpy.data.actions.remove(act)
missing = wanted - {a.name for a in bpy.data.actions}
if missing:
    raise SystemExit(f"PEOPLE FAILED: the library has no {sorted(missing)}")
for o in lib_objects:
    bpy.data.objects.remove(o, do_unlink=True)

# the body
bpy.ops.import_scene.gltf(filepath=spec["body"])
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for mat in bpy.data.materials:  # textures the pack doesn't ship (some hair, an eye normal): their nodes go
    if not mat.use_nodes:
        continue
    for node in list(mat.node_tree.nodes):
        if node.type == "TEX_IMAGE" and (node.image is None or not node.image.has_data):
            if node.image is not None:
                node.image.reload()
            if node.image is None or not node.image.has_data:
                mat.node_tree.nodes.remove(node)
keep = set(spec.get("keep") or [])
for o in list(bpy.data.objects):
    if o.type == "MESH" and keep and o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

# to the character's height: the whole rig scales, the clips with it
from mathutils import Vector
tallest = max((o.matrix_world @ Vector(c)).z for o in bpy.data.objects if o.type == "MESH" for c in o.bound_box)
k = spec["height"] / tallest
arm.scale = (arm.scale[0] * k, arm.scale[1] * k, arm.scale[2] * k)  # (kept on the node: the clips' hip heights scale with it)

# each clip as a track of its own, so the exporter writes them all
arm.animation_data_create()
for act in bpy.data.actions:
    tr = arm.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, int(act.frame_range[0]), act)
arm.animation_data.action = None

bpy.ops.export_scene.gltf(filepath=spec["out"], export_format="GLB", export_skins=True, export_image_format="WEBP",
                          export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                          export_frame_step=2, use_selection=False)
print(f"PEOPLE OK {spec['out']} {len(bpy.data.actions)} clips, scale {k:.3f}")
