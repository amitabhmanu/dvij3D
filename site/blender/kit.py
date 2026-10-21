"""Shared building kit for the valley's models made in Blender (design §10.3): the plan frame,
materials from generated textures, quads with UVs in metres, and named markers.

The same pieces as blender/build_lodge.py (which keeps its own copy, so the lodge's model is
not rebuilt by a change here). Frame: the plan's own, metres, +x east, +z south, y up;
Blender's is +x east, +y north, z up, so a plan point (x, y, z) is Blender (x, -z, y), and the
glTF export turns that back into the game's frame.
"""
import json
import math

import bpy
from mathutils import Vector


def B(x, y, z):
    """Plan frame -> Blender frame."""
    return (x, -z, y)


class Kit:
    def __init__(self, tex_dir, tile):
        self.tex = tex_dir
        self.tile = tile  # metres one repeat of each texture covers
        self.mats = {}
        self.markers = []

    def material(self, name, tex=None, color=None, rough=0.9, metal=0.0, alpha=False, emit=0.0):
        if name in self.mats:
            return self.mats[name]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.use_backface_culling = False
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if tex:
            node = m.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images.load(f"{self.tex}/{tex}.png")
            m.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
            if alpha:
                m.node_tree.links.new(node.outputs["Alpha"], bsdf.inputs["Alpha"])
                if hasattr(m, "blend_method"):
                    m.blend_method = "CLIP"
                    m.alpha_threshold = 0.5
        else:
            bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*color, 1)
            bsdf.inputs["Emission Strength"].default_value = emit
        self.mats[name] = m
        return m

    def geo(self):
        return Geo(self)

    def empty(self, name, x, y, z, **props):
        # glTF optimisation prunes empty nodes, so the game reads markers from a sidecar too
        self.markers.append({"name": name, "at": [round(x, 3), round(y, 3), round(z, 3)], **props})
        e = bpy.data.objects.new(name, None)
        e.location = B(x, y, z)
        for k, v in props.items():
            e[k] = v if not isinstance(v, (list, dict)) else json.dumps(v)
        bpy.context.scene.collection.objects.link(e)
        return e


class Geo:
    """Quads with UVs in metres, grouped by material, turned into one Blender object."""

    def __init__(self, kit):
        self.kit = kit
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

    def planar(self, pts, normal, mat):
        s = self.kit.tile.get(mat, 3.0)
        nx, ny, nz = (abs(c) for c in normal)
        if ny >= max(nx, nz):
            return [(p.x / s, p.z / s) for p in pts]
        if nx >= nz:
            return [(p.z / s, p.y / s) for p in pts]
        return [(p.x / s, p.y / s) for p in pts]

    def box(self, x0, x1, y0, y1, z0, z1, mat, top=None):
        X0, X1, Y0, Y1, Z0, Z1 = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1)
        if X1 - X0 < 1e-4 or Y1 - Y0 < 1e-4 or Z1 - Z0 < 1e-4:
            return
        for pts, n in (
            ([(X0, Y1, Z0), (X1, Y1, Z0), (X1, Y1, Z1), (X0, Y1, Z1)], (0, 1, 0)),
            ([(X0, Y0, Z0), (X1, Y0, Z0), (X1, Y0, Z1), (X0, Y0, Z1)], (0, -1, 0)),
            ([(X1, Y0, Z0), (X1, Y1, Z0), (X1, Y1, Z1), (X1, Y0, Z1)], (1, 0, 0)),
            ([(X0, Y0, Z0), (X0, Y1, Z0), (X0, Y1, Z1), (X0, Y0, Z1)], (-1, 0, 0)),
            ([(X0, Y0, Z1), (X1, Y0, Z1), (X1, Y1, Z1), (X0, Y1, Z1)], (0, 0, 1)),
            ([(X0, Y0, Z0), (X1, Y0, Z0), (X1, Y1, Z0), (X0, Y1, Z0)], (0, 0, -1)),
        ):
            self.quad(pts, n, top if (top and n == (0, 1, 0)) else mat)

    def cylinder(self, x, z, r, y0, y1, mat, seg=12, cap=True, r1=None):
        r1 = r if r1 is None else r1
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            am = (a0 + a1) / 2
            p0 = (x + r * math.cos(a0), y0, z + r * math.sin(a0))
            p1 = (x + r * math.cos(a1), y0, z + r * math.sin(a1))
            q1 = (x + r1 * math.cos(a1), y1, z + r1 * math.sin(a1))
            q0 = (x + r1 * math.cos(a0), y1, z + r1 * math.sin(a0))
            self.quad([p0, p1, q1, q0], (math.cos(am), 0, math.sin(am)), mat)
            if cap:
                self.quad([(x, y1, z), (x, y1, z), q1, q0], (0, 1, 0), mat)

    def sphere(self, x, y, z, r, mat, seg=10, squash=1.0):
        rings = seg // 2
        for j in range(rings):
            t0, t1 = math.pi * j / rings - math.pi / 2, math.pi * (j + 1) / rings - math.pi / 2
            for i in range(seg):
                a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
                pts = [(x + r * math.cos(t) * math.cos(a), y + r * squash * math.sin(t), z + r * math.cos(t) * math.sin(a))
                       for t, a in ((t0, a0), (t0, a1), (t1, a1), (t1, a0))]
                c = [sum(p[k] for p in pts) / 4 for k in range(3)]
                self.quad(pts, (c[0] - x, c[1] - y, c[2] - z), mat)

    def to_object(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        uv = mesh.uv_layers.new(name="UVMap")
        for poly, quad in zip(mesh.polygons, self.uvs):
            for li, (u, v) in zip(poly.loop_indices, quad):
                uv.data[li].uv = (u, v)
        for m in self.names:
            mesh.materials.append(self.kit.mats[m])
        for poly, mi in zip(mesh.polygons, self.mats):
            poly.material_index = mi
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def render(views, out_prefix, hide=("collision",)):
    """Renders from the comic's own viewpoints, for comparing with its panels."""
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.82, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.color = (1.0, 0.94, 0.82)  # the midday sun the comic paints (b1-p011-4)
    sun.rotation_euler = (math.radians(35), 0, math.radians(-150))
    scene.collection.objects.link(sun)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 24
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for o in scene.objects:
        if o.name in hide:
            o.hide_render = True
    for name, (eye, look) in views.items():
        cam.location = B(*eye)
        d = Vector(B(*look)) - Vector(B(*eye))
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{out_prefix}-{name}.png"
        bpy.ops.render.render(write_still=True)
    for o in (sun, cam):
        bpy.data.objects.remove(o)
