"""The lifelike pilot's additions to a person (blender/build_human.py calls these when the spec asks):

  - paint_skin: the skin's colour zones painted into its texture (the nose, cheeks and ears ruddier, the skin round the
    eyes darker and cooler, a blue-grey beard shadow on the men, freckles and a flush where the comic draws them), and
    a roughness map beside it (an oilier forehead and nose, matte cheeks, glossy lips), read by the game's skin
    (src/lib/story/skin.ts) as the glTF's roughness.
  - hair_cards: hair, moustaches and brows as cards, as games make them: strips grown from the scalp along each lock's
    path (curling, falling, combed), kept off the body, with a strand texture drawn here (alpha, root to tip
    darkening, each strand's own tone). The game draws them soft-edged with the multisampling and a hair's long
    highlight (src/lib/story/hair.ts).

Everything comes from the build's own body: `G` is build_human.py's globals (the body, its points, the measures).
Deterministic: each person's randomness is seeded by their name.
"""
import math
import random

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree


# ---------------------------------------------------------------- painting into the skin's UVs
def _splat(G, size, weight, rad_frac=0.012):
    """A mask (h, w) over the skin's UV square: each body point's weight spread as a soft disc where it maps."""
    body = G["body"]
    w, h = size
    mask = np.zeros((h, w), dtype=np.float32)
    rad = max(2, int(w * rad_frac))
    yy, xx = np.mgrid[-rad:rad + 1, -rad:rad + 1]
    disk = np.clip(1 - np.sqrt(xx ** 2 + yy ** 2) / rad, 0, 1)
    uvl = body.data.uv_layers.active.data
    cache = {}
    for poly in body.data.polygons:
        for li in poly.loop_indices:
            vi = body.data.loops[li].vertex_index
            k = cache.get(vi)
            if k is None:
                k = cache[vi] = weight(vi)
            if k <= 0:
                continue
            u, v = uvl[li].uv
            cx, cy = int(u * w) % w, int(v * h) % h
            y0, y1, x0, x1 = max(cy - rad, 0), min(cy + rad + 1, h), max(cx - rad, 0), min(cx + rad + 1, w)
            mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], disk[y0 - cy + rad:y1 - cy + rad, x0 - cx + rad:x1 - cx + rad] * k)
    return mask


def regions(G):
    """The face's parts, as weights (0..1) on body points, from the build's own measures."""
    V, in_body, dominant, member = G["V"], G["in_body"], G["dominant"], G["member"]
    EYE_L, EYE_R, MOUTH, BROW, LIP_TOP = G["EYE_L"], G["EYE_R"], G["MOUTH"], G["BROW"], G["LIP_TOP"]
    eye_y = (EYE_L.y + EYE_R.y) / 2
    eye_z = (EYE_L.z + EYE_R.z) / 2
    head = lambda i: i in in_body and dominant[i] == "head"  # noqa: E731
    front = lambda i: V[i].y < eye_y + 0.004  # noqa: E731 (the body faces -y)
    nose_pts = [V[i] for i in in_body if dominant[i] == "head" and MOUTH.z < V[i].z < eye_z and abs(V[i].x) < 0.01]
    nose_tip = min(nose_pts, key=lambda p: p.y) if nose_pts else Vector((0, eye_y - 0.03, (eye_z + MOUTH.z) / 2))
    cheeks = [(EYE_L + MOUTH) / 2 + Vector((0.014, -0.004, 0.004)), (EYE_R + MOUTH) / 2 - Vector((0.014, 0.004, -0.004))]

    def fall(d, r0, r1):
        return 1.0 if d < r0 else max(0.0, 1 - (d - r0) / (r1 - r0))

    return {
        "nose": lambda i: fall((V[i] - nose_tip).length, 0.008, 0.026) if head(i) and front(i) else 0.0,
        "cheeks": lambda i: max(fall((V[i] - c).length, 0.012, 0.038) for c in cheeks) if head(i) and front(i) else 0.0,
        "ears": lambda i: 1.0 if "ears" in member[i] else 0.0,
        "eyes": lambda i: (max(fall((V[i] - e).length, 0.016, 0.03) for e in (EYE_L, EYE_R)) if head(i) and front(i) else 0.0),
        "lips": lambda i: 1.0 if "lips" in member[i] else 0.0,
        "tzone": lambda i: ((1.0 if abs(V[i].x) < 0.03 and BROW + 0.002 < V[i].z < BROW + 0.06 else 0.0) * (1.0 if front(i) else 0.0)
                            if head(i) else 0.0),
        "beard": lambda i: (fall(abs(V[i].z - (LIP_TOP - 0.02)), 0.022, 0.04) * (1.0 if V[i].y < eye_y - 0.005 else 0.0)
                            * (0.0 if "lips" in member[i] else 1.0) * (1.0 if V[i].z < nose_tip.z - 0.006 else 0.0)) if head(i) else 0.0,
    }


def paint_skin(G, spec):
    """Colour zones into the skin's texture, and a roughness map for it (spec["zones"])."""
    z = spec.get("zones", {})
    img = G["skin_img"]
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    R = regions(G)

    def tint(mask, col, k):
        m = (mask * k)[..., None]
        px[..., :3] = px[..., :3] * (1 - m) + px[..., :3] * np.array(col, dtype=np.float32) * m

    masks = {name: _splat(G, (w, h), R[name]) for name in ("nose", "cheeks", "ears", "eyes", "lips", "tzone", "beard")}
    tint(masks["nose"], (1.07, 0.9, 0.86), z.get("nose", 0.45))
    tint(masks["cheeks"], (1.06, 0.9, 0.87), z.get("cheeks", 0.4))
    tint(masks["ears"], (1.08, 0.9, 0.86), z.get("ears", 0.5))
    tint(masks["eyes"], (0.88, 0.86, 0.9), z.get("eyes", 0.5))
    if z.get("beard"):
        tint(masks["beard"], (0.8, 0.82, 0.88), z["beard"])
    if z.get("freckles"):  # small, irregular, mostly over the nose's bridge and the cheeks' tops (Bhavi, b1-p012-28)
        r = random.Random(spec["who"] + "freckles")
        V, in_body = G["V"], G["in_body"]
        spots = [i for i in in_body if (R["nose"](i) > 0.2 or R["cheeks"](i) > 0.3) and V[i].z > G["MOUTH"].z + 0.015]
        chosen = set(r.sample(spots, min(len(spots), z["freckles"])))
        fm = _splat(G, (w, h), lambda i: r.uniform(0.5, 1.0) if i in chosen else 0.0, rad_frac=0.0035)
        tint(fm, (0.78, 0.66, 0.58), 0.7)
    np.clip(px, 0, 1, out=px)
    img.pixels.foreach_set(px.ravel())
    img.pack()
    # the roughness: skin's general, oilier in the T-zone and on the nose, matte cheeks, glossy lips
    rough = np.full((h, w), z.get("rough", 0.55), dtype=np.float32)
    for name, val in (("tzone", 0.4), ("nose", 0.36), ("cheeks", 0.62), ("lips", 0.28)):
        m = masks[name]
        rough = rough * (1 - m) + val * m
    rimg = G["image"]("skin-rough", np.dstack([rough, rough, rough, np.ones_like(rough)]))
    rimg.colorspace_settings.name = "Non-Color"
    nt = G["body"].data.materials[0].node_tree
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = rimg
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tn.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], nt.nodes["Principled BSDF"].inputs["Roughness"])
    print("PEOPLE skin zones painted")


# ---------------------------------------------------------------- hair cards
def strand_texture(name, root, tip, strands=34, wave=0.0, w=128, h=512, seed=1, light=0.0, fill=0.55, thick=(2.5, 5.5)):
    """Strands on a card (sRGB RGBA, v=0 at the root): each its own tone, thinning to its tip; the alpha is the strands."""
    r = np.random.default_rng(seed)
    px = np.zeros((h, w, 4), dtype=np.float32)
    v = np.linspace(0, 1, h)[:, None]
    for _ in range(strands):
        x0 = r.uniform(0.06, 0.94) * w
        width = r.uniform(*thick)
        end = r.uniform(0.82, 1.0)  # (some strands shorter than the card)
        phase, freq = r.uniform(0, 6.3), r.uniform(2, 5)
        xs = x0 + (np.sin(v * freq * 2 * math.pi + phase) * wave * w * 0.12) + (x0 - w / 2) * (-0.25 * v)  # (gathered towards the tip)
        xx = np.arange(w)[None, :]
        thick_ = width * np.clip(1 - (v / end) ** 6, 0, 1)
        a = np.clip(1.6 * (1 - np.abs(xx - xs) / np.maximum(thick_, 1e-3)), 0, 1) * (v < end)
        tone = r.uniform(0.7, 1.15)  # (each strand its own shade: grey hair is many greys)
        col = (np.array(root)[None, None, :] * (1 - v[..., None]) + np.array(tip)[None, None, :] * v[..., None]) * tone
        col = col + light * np.exp(-((v[..., None] - 0.35) / 0.08) ** 2)  # (a lighter band where the light catches it)
        px[..., :3] = np.where(a[..., None] > px[..., 3:4], col, px[..., :3])
        px[..., 3] = np.maximum(px[..., 3], a)
    # a fuller core down the card's middle: a lock is dense where its strands overlap, thin at its edges and tip
    xx = (np.arange(w)[None, :] / w - 0.5) / 0.28
    core = fill * np.exp(-xx ** 2) * np.clip(1 - v ** 2.5, 0, 1)
    under = np.array(root)[None, None, :] * (1 - v[..., None]) * 0.85 + np.array(tip)[None, None, :] * v[..., None] * 0.85
    px[..., :3] = np.where(px[..., 3:4] < core[..., None], under, px[..., :3])
    px[..., 3] = np.maximum(px[..., 3], core)
    return np.clip(px, 0, 1)


def _push_out(kd, normals, p, clear):
    """Keep a point `clear` outside the body: moved out along the nearest skin point's normal if it is nearer."""
    for _ in range(2):
        co, idx, d = kd.find(p)
        n = normals[idx]
        depth = (p - co).dot(n)
        if depth < clear:
            p = p + n * (clear - depth)
    return p


def _cards(name, paths, widths, ups, mat, G, bone=None):
    """One mesh of strips along paths (lists of world points), each `widths[k]` wide, its face turned to `ups[k]`."""
    verts, faces, uvs = [], [], []
    for path, wd, up in zip(paths, widths, ups):
        base = len(verts)
        n = len(path)
        for j, p in enumerate(path):
            a = path[min(j + 1, n - 1)] - path[max(j - 1, 0)]
            a = a.normalized() if a.length > 1e-6 else Vector((0, 0, -1))
            side = a.cross(up)
            side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
            taper = 1.0 - 0.35 * (j / max(n - 1, 1))
            for s in (-1, 1):
                verts.append(p + side * s * wd * 0.5 * taper)
                uvs.append(((s + 1) / 2, 1 - j / max(n - 1, 1)))
        for j in range(n - 1):
            k = base + j * 2
            faces.append((k, k + 1, k + 3, k + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[me.loops[li].vertex_index]
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if bone:
        obj.vertex_groups.new(name=bone).add(list(range(len(verts))), 1.0, "REPLACE")
    G["finish"](obj, mat, weights_from_body=not bone, keep_uv=True)
    for poly in me.polygons:  # (flat strips: both faces seen, the game draws them two-sided)
        poly.use_smooth = True
    return obj


def _spaced(G, pts, gap, seed):
    """Body points thinned to about one every `gap` metres, in a seeded order."""
    V = G["V"]
    r = random.Random(seed)
    pts = list(pts)
    r.shuffle(pts)
    placed, out = {}, []
    for i in pts:
        key = tuple(int(c // gap) for c in V[i])
        if any((V[i] - V[j]).length < gap for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)
               for j in placed.get((key[0] + dx, key[1] + dy, key[2] + dz), ())):
            continue
        placed.setdefault(key, []).append(i)
        out.append(i)
    return out


def _body_kd(G):
    V, N, in_body = G["V"], G["N"], G["in_body"]
    idx = sorted(in_body)
    kd = KDTree(len(idx))
    for k, i in enumerate(idx):
        kd.insert(V[i], k)
    kd.balance()
    normals = [N[i] for i in idx]
    return kd, normals


def hair_cards(G, g):
    """Hair as cards. g["style"]: "curly" (the Professor's loose grey curls, Dvij's dark ones), "long" (Bhavi's),
    "moustache" (drooping, uneven), "brows"."""
    style = g["style"]
    V, N, in_body, dominant = G["V"], G["N"], G["in_body"], G["dominant"]
    EYE_L, EYE_R, BROW, HEAD_TOP, LIP_TOP, MOUTH = G["EYE_L"], G["EYE_R"], G["BROW"], G["HEAD_TOP"], G["LIP_TOP"], G["MOUTH"]
    nm = g.get("name", "hair-cards")
    r = random.Random(nm + style)
    root_c, tip_c = g.get("root", g["color"]), g.get("tip", g["color"])
    tex = strand_texture(nm, root_c, tip_c, strands=g.get("strands", 34), wave=g.get("wave", 0.0), seed=len(nm), light=g.get("light", 0.04))
    mat = G["material"](f"hair-cards-{nm}", image=G["image"](nm, tex), alpha=True, rough=0.45)
    kd, normals = _body_kd(G)
    down = Vector((0, 0, -1))
    eye_y = (EYE_L.y + EYE_R.y) / 2
    hc = Vector((0, eye_y + 0.075, (EYE_L.z + HEAD_TOP) / 2))  # (the skull's middle)
    paths, widths, ups = [], [], []

    if style in ("curly", "long"):
        keep = G["scalp"](g.get("lowest", EYE_L.z - 0.02))
        line = BROW + g.get("hairline", 0.03)
        above = BROW + g["above"] if "above" in g else None  # (in front, only this far over the brow: over Dvij's bandage)
        roots = [i for i in in_body if keep(i) and (V[i].y > eye_y + 0.03 or V[i].z > line)
                 and min((V[i] - EYE_L).length, (V[i] - EYE_R).length) > 0.045
                 and (above is None or V[i].z > above or V[i].y > eye_y + 0.06)]
        roots = _spaced(G, roots, g.get("gap", 0.011), nm)
    if style == "curly":
        for i in roots:
            p0, n = V[i], N[i]
            side = min(1.0, abs(p0.x) / 0.07)
            behind = max(0.0, min(1.0, (p0.y - eye_y) / 0.1))
            vol = g.get("volume", 0.03) * (0.8 + 0.3 * max(side, behind)) * r.uniform(0.7, 1.15)
            L = g.get("length", 0.05) * r.uniform(0.75, 1.2)
            u = n.cross(Vector((0, 0, 1)))
            u = u.normalized() if u.length > 1e-4 else Vector((1, 0, 0))
            w_ = n.cross(u).normalized()
            turns, rc, ph = g.get("turns", 1.1) * r.uniform(0.8, 1.2), g.get("curl", 0.009) * r.uniform(0.8, 1.25), r.uniform(0, 6.3)
            path = []
            for j in range(9):
                t = j / 8
                a = ph + t * turns * 2 * math.pi
                p = p0 + n * (0.003 + vol * t) + (u * math.cos(a) + w_ * math.sin(a)) * rc * min(1.0, t * 2.5) + down * L * 0.25 * t * t
                path.append(_push_out(kd, normals, p, 0.004))
            paths.append(path)
            widths.append(g.get("width", 0.016) * r.uniform(0.8, 1.2))
            ups.append((p0 - hc).normalized())
        obj = _cards(nm, paths, widths, ups, mat, G, bone="head")
    elif style == "long":
        length = g.get("length", 0.5)
        # the face's half-width at each height (1 cm steps), in front of the ears: long hair falls beside it, not across it
        ear_y = eye_y + 0.075
        half = {}
        for i in in_body:
            if dominant[i] in ("head", "neck_01") and V[i].y < eye_y + 0.03:
                k = int(V[i].z * 100)
                half[k] = max(half.get(k, 0.0), abs(V[i].x))

        def clear_of_face(p, framing):
            k = int(p.z * 100)
            if p.y < ear_y and k in half and p.z > MOUTH.z - 0.09:
                need = half[k] + (0.006 if framing else 0.022)
                if abs(p.x) < need:
                    p = Vector((math.copysign(need, p.x if abs(p.x) > 1e-4 else 1.0), p.y, p.z))
            return p
        for i in roots:
            p0, n = V[i], N[i]
            sx = 1.0 if p0.x >= 0 else -1.0
            crown = max(0.0, (p0.z - (HEAD_TOP - 0.05)) / 0.05)
            front_ = p0.y < eye_y + 0.02
            framing = front_ and abs(p0.x) > 0.045 and r.random() < g.get("framing", 0.35)  # (strands at the temples that frame the face)
            L = length * r.uniform(0.85, 1.1) * (0.75 if framing else 1.0)
            vol = g.get("volume", 0.022) * (0.6 + 0.4 * crown + 0.4 * min(1.0, abs(p0.x) / 0.07))
            p = p0 + n * 0.003
            # combed along the scalp, away from the parting and back (the front locks swept back off the face), lifted a
            # little off it for the volume, then falling
            comb = Vector((sx * 0.7, 0.9 if not framing else -0.15, -0.35 if not framing else -0.8))
            comb = (comb - n * comb.dot(n)).normalized()
            d = (comb + n * 0.35).normalized()
            path = [p.copy()]
            seg = 0.025
            travelled = 0.0
            while travelled < L:
                fall = min(1.0, travelled / max(vol * 2.2, 0.035))
                want = (d * (1 - fall) + (down + Vector((sx * 0.05, 0.08 if not framing else -0.06, 0))) * fall).normalized()
                p = p + want * seg
                p += Vector((sx, 0, 0)) * math.sin(travelled * 18 + i) * g.get("wave", 0.002)  # (mostly straight: a slight wave)
                p = _push_out(kd, normals, p, 0.008 + vol * (1 - fall) * 0.4)
                p = clear_of_face(p, framing)
                path.append(p.copy())
                travelled += seg
            paths.append(path)
            widths.append(g.get("width", 0.024) * r.uniform(0.85, 1.15))
            ups.append(Vector((p0.x - hc.x, p0.y - hc.y, 0)).normalized() if (p0 - hc).length > 1e-4 else Vector((0, 1, 0)))
        # flyaways: a few fine single strands standing off the mass
        for _ in range(g.get("flyaways", 18)):
            i = r.choice(roots)
            p0, n = V[i], N[i]
            if p0.y < eye_y + 0.04:
                continue  # (not over the face)
            path = [p0 + n * 0.01]
            dd = (n * 0.6 + Vector((r.uniform(-0.5, 0.5), r.uniform(0.0, 0.5), r.uniform(-0.6, 0.1)))).normalized()
            for j in range(3):
                path.append(path[-1] + dd * 0.012 + down * 0.008 * j)
            paths.append(path)
            widths.append(0.004)
            ups.append(n)
        obj = _cards(nm, paths, widths, ups, mat, G)  # (skinned from the body nearest: the head, the neck, the back)
    elif style == "moustache":
        # drooping, a little uneven, its ends hanging past the mouth's corners (the Professor's, b1-p012-6)
        sz = g.get("size", 1.0)
        corner = max(abs(p.x) for p in G["lips"])
        for k in range(g.get("count", 46)):
            t = (k + 0.5) / g.get("count", 46) * 2 - 1  # (-1 .. 1 across the lip)
            sx = 1 if t >= 0 else -1
            x = t * (corner + 0.004) * sz
            z = LIP_TOP + 0.006 * sz - abs(t) * 0.004
            near = min((i for i in in_body if dominant[i] == "head" and abs(V[i].x - x) < 0.006 and abs(V[i].z - z) < 0.006), key=lambda i: V[i].y, default=None)
            if near is None:
                continue
            p0 = V[near]
            drop = (0.012 + 0.012 * abs(t) ** 1.5) * sz * r.uniform(0.85, 1.2) * (1.12 if sx > 0 else 0.92)  # (uneven: one side longer)
            path = []
            for j in range(6):
                s = j / 5
                # out over the lip first, then hanging: a soft curve, not a straight spike
                p = p0 + Vector((sx * abs(t) * 0.01 * s, -0.003 - 0.006 * math.sin(s * math.pi * 0.6), -drop * s ** 1.4))
                path.append(_push_out(kd, normals, p, 0.0025))
            paths.append(path)
            widths.append(g.get("width", 0.01) * sz)
            ups.append(Vector((0, -1, 0)))
        obj = _cards(nm, paths, widths, ups, mat, G, bone="head")
    elif style == "brows":
        for e in (EYE_L, EYE_R):
            sx = 1 if e.x > 0 else -1
            for k in range(g.get("count", 26)):
                t = k / (g.get("count", 26) - 1)  # (0 at the nose end, 1 at the tail)
                x = e.x + sx * (-0.018 + t * 0.042)
                arch = g.get("arch", 0.004) * math.sin(min(1.0, t * 1.4) * math.pi)
                z = BROW + 0.002 + arch - t * 0.004
                near = min((i for i in in_body if dominant[i] == "head" and abs(V[i].x - x) < 0.005 and abs(V[i].z - z) < 0.005), key=lambda i: V[i].y, default=None)
                if near is None:
                    continue
                p0 = V[near] + N[near] * 0.0008
                d = Vector((sx * (0.5 + t * 0.6), 0, 0.6 - t * 0.9)).normalized()  # (up at the nose end, out along the tail)
                L = g.get("length", 0.011) * r.uniform(0.8, 1.2)
                path = [p0, _push_out(kd, normals, p0 + d * L * 0.5, 0.0012), _push_out(kd, normals, p0 + d * L, 0.0014)]
                paths.append(path)
                widths.append(g.get("width", 0.005))
                ups.append(N[near])
        obj = _cards(nm, paths, widths, ups, mat, G, bone="head")
    print(f"PEOPLE hair cards {nm} ({style}): {len(paths)} cards")
    return obj
