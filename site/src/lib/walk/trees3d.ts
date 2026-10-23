// Trees in the round near you (the far ones stay the painting's cut-outs, cutouts.ts, which give way to these within
// their reach). Three kinds, made here from a few shapes: a neem's round crown, an acacia's flat one, a tall narrow
// tree. Each stands where the painting has a tree, its height the painting's, turned and tinted a little its own way;
// those within reach of you are gathered every couple of seconds into one instanced draw per kind.
import {
  BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4,
  MeshStandardMaterial, Quaternion, Vector3, type Scene,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type TreeSpot = { x: number; y: number; z: number; height: number };

/** A seeded random, so each tree is the same tree every time. */
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function tinted(g: BufferGeometry, c: Color, vary: number, r: () => number): BufferGeometry {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    // darker underneath and inside, lighter on top, mottled
    const k = (1 - vary) + vary * (0.6 + 0.4 * Math.min(1, Math.max(0, p.getY(i)))) * (0.85 + 0.3 * r());
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** A crown of leaves: blobs of a lumpy sphere about a centre, each pushed about so no two are alike. */
function crown(blobs: [number, number, number, number][], seed: number, leaf: Color): BufferGeometry {
  const r = rand(seed);
  const parts = blobs.map(([x, y, z, s]) => {
    const g = new IcosahedronGeometry(s, 1);
    const p = g.attributes.position;
    const seed2 = r() * 100;
    for (let i = 0; i < p.count; i++) {
      // pushed in or out by where the point is (its copies on the faces that share it move together: no cracks)
      const h = Math.sin(p.getX(i) * 91.7 + p.getY(i) * 47.3 + p.getZ(i) * 13.1 + seed2) * 43758.5453;
      const k = 0.85 + 0.3 * (h - Math.floor(h));
      p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k * 0.85 + y, p.getZ(i) * k + z);
    }
    g.deleteAttribute("uv");
    g.computeVertexNormals();
    return tinted(g, leaf, 0.45, r);
  });
  return mergeGeometries(parts)!;
}

function trunk(h: number, r0: number, lean: number, bark: Color, seed: number): BufferGeometry {
  const g = new CylinderGeometry(r0 * 0.6, r0, h, 7, 3).toNonIndexed(); // (as the crown's blobs are: so they merge)
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + lean * (p.getY(i) / h) ** 2); // (bent a little as it rises)
  g.deleteAttribute("uv");
  return tinted(g, bark, 0.3, rand(seed));
}

/** The three kinds, each 1 m tall (scaled to the painting's height). */
function kinds(): BufferGeometry[] {
  const leaf = new Color("#4f6a2c"), dry = new Color("#6b7434"), dark = new Color("#3c5526"), bark = new Color("#5a4632");
  // a neem: a short trunk, a broad round crown
  const neem = mergeGeometries([trunk(0.45, 0.035, 0.03, bark, 1),
    crown([[0, 0.62, 0, 0.26], [0.18, 0.55, 0.05, 0.2], [-0.17, 0.57, -0.06, 0.21], [0.05, 0.56, 0.19, 0.19], [-0.04, 0.58, -0.2, 0.2], [0.02, 0.8, 0, 0.2]], 2, leaf)])!;
  // an acacia: a leaning trunk, a wide flat crown high up
  const acacia = mergeGeometries([trunk(0.7, 0.025, 0.08, bark, 3),
    crown([[0.08, 0.8, 0, 0.2], [0.3, 0.78, 0.08, 0.17], [-0.14, 0.79, -0.06, 0.18], [0.12, 0.8, 0.22, 0.15], [0.1, 0.81, -0.22, 0.16]], 4, dry)])!;
  acacia.scale(1, 1.1, 1); // (squashed crowns: their blobs flattened by the crown()'s 0.85 already)
  // a tall narrow tree
  const tall = mergeGeometries([trunk(0.35, 0.025, 0.0, bark, 5),
    crown([[0, 0.45, 0, 0.16], [0, 0.62, 0, 0.15], [0, 0.78, 0, 0.12], [0.06, 0.55, 0.05, 0.12], [-0.05, 0.7, -0.04, 0.11], [0, 0.9, 0, 0.08]], 6, dark)])!;
  return [neem, acacia, tall];
}

export type Trees3d = {
  /** Gather the trees within reach of (x, z) into the draws (call as you move; cheap when nothing's changed). */
  update: (x: number, z: number) => void;
  /** How far they reach (m); 0 for none (the cut-outs everywhere). */
  setReach: (m: number) => void;
  reach: () => number;
  dispose: () => void;
};

export function trees3d(scene: Scene, spots: TreeSpot[]): Trees3d {
  const geos = kinds();
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const MAX = 900;
  const meshes = geos.map((g) => {
    const m = new InstancedMesh(g, mat, MAX);
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  // each tree's own kind, turn, slant of its lean and tint, by where it stands
  const own = spots.map((s) => {
    const r = rand(Math.floor(s.x * 73 + s.z * 151));
    return { kind: Math.floor(r() * 3), turn: r() * Math.PI * 2, wide: 0.85 + r() * 0.35, tint: 0.85 + r() * 0.3 };
  });
  let reach = 0, cx = Infinity, cz = Infinity;
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), at = new Vector3(), sc = new Vector3(), col = new Color();
  const gather = (x: number, z: number) => {
    const n = [0, 0, 0];
    if (reach > 0) {
      spots.forEach((s, i) => {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d > reach + 10) return; // (a little past the reach: the cut-outs fade out over it)
        const o = own[i], k = o.kind;
        if (n[k] >= MAX) return;
        q.setFromAxisAngle(up, o.turn);
        sc.set(s.height * o.wide, s.height, s.height * o.wide);
        meshes[k].setMatrixAt(n[k], m4.compose(at.set(s.x, s.y - 0.1, s.z), q, sc));
        meshes[k].setColorAt(n[k], col.setScalar(o.tint));
        n[k]++;
      });
    }
    meshes.forEach((m, k) => {
      m.count = n[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    cx = x; cz = z;
  };
  return {
    update: (x, z) => { if (Math.hypot(x - cx, z - cz) > 8) gather(x, z); },
    setReach: (m) => { reach = m; gather(cx === Infinity ? 0 : cx, cz === Infinity ? 0 : cz); cx = Infinity; },
    reach: () => reach,
    dispose: () => { for (const m of meshes) { scene.remove(m); m.dispose(); } for (const g of geos) g.dispose(); mat.dispose(); },
  };
}
