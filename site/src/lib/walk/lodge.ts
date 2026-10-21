// The Professor's lodge in the walkable valley (design §10.3): the Blender model
// standing on its levelled grounds, solid where it should be, with doors that
// open and close. Nothing here is lodge-specific except the file it loads, so
// the next building you can walk into uses the same code.
//
// The model's own frame is the game's (x east, y up, z south) with its origin
// at the courtyard's centre; it is placed by translation only.
import {
  Box3, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, Object3D, Ray, Sphere, Vector3,
  type Material, type Scene,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { MeshBVH } from "three-mesh-bvh";

export type Marker = {
  name: string; at: [number, number, number]; label?: string; heading?: number; kind?: string; rect?: string;
  room?: string; text?: string; pages?: string[]; page?: string;
};
export type Look = { id: string; label: string; text: string; pages: string[] };
export type LodgeInfo = {
  url: string;
  at: { x: number; y: number; z: number };
  half: number; // the house is a square this far from its centre each way
  court: number; // the open courtyard, likewise
  markers: Marker[];
};

type Door = {
  name: string;
  leaf: Object3D;
  closed: number; // rotation about y when shut
  swing: number; // +/- radians to open
  centre: Vector3; // the doorway's middle, in the model's frame
  box: Box3; // the doorway when shut, in the model's frame
  open: boolean;
  t: number; // 0 shut, 1 open
};

export type Lodge = {
  root: Group;
  /** The floor under (x, z) within a step of feet height, in world metres; null if none. */
  floorAt: (x: number, z: number, feet: number) => number | null;
  /** Would someone of radius r standing at (x, z) with their feet at `feet` touch the model? */
  hits: (x: number, z: number, feet: number, r: number) => boolean;
  /** Under the roof, rather than outside or in the open courtyard. */
  indoors: (x: number, z: number) => boolean;
  /** The doorway within reach of (x, z), if any, and whether its door is open. */
  doorNear: (x: number, z: number) => { name: string; open: boolean } | null;
  toggleDoor: (name: string) => void;
  /** Something to look at within reach of (x, z), if any (lodge.yaml `looks`). */
  lookNear: (x: number, z: number) => Look | null;
  /** Show the back wall's painted patch: a puzzle, for readers who have reached it. */
  showPatch: (on: boolean) => void;
  patchVisible: () => boolean;
  /** Moves the doors on (and turns the fans); true if a door moved. */
  update: (dt: number) => boolean;
  /** The ceiling fans: where each hangs (world metres) and how fast it turns (turns a second). */
  fans: () => { room: string; at: Vector3; speed: number }[];
  /** Switch a room's fan on (turns a second) or off (0). */
  setFan: (room: string, speed: number) => void;
  dispose: () => void;
};

const STEP_UP = 0.6; // rays start this far above the feet, so steps are found and roofs are not
const KNEE = 0.75; // the body is two spheres, at these heights above the feet
const CHEST = 1.45;
const SWING = 1.5;
// Which fans run, and how fast, unless the story says otherwise: the one over Dvij's bed creaks
// round slowly (novel ¶93), the study's whirrs gently (¶1567); the rest hang still under their dust (¶194).
const FANS: Record<string, number> = { "dvij-room": 0.55, study: 1.1 };

/** Every triangle under `obj`, as plain floats in the model's frame. (A glTF node
 * with several materials loads as a group of meshes, and meshopt files quantise
 * positions, so the collision copy is rebuilt as one simple geometry.) */
function bake(obj: Object3D, rootInverse: Object3D): BufferGeometry {
  obj.updateWorldMatrix(true, true);
  const out: number[] = [];
  const v = new Vector3();
  obj.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position");
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld).applyMatrix4(rootInverse.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(out), 3));
  return g;
}

export async function loadLodge(info: LodgeInfo, scene: Scene): Promise<Lodge> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(info.url);
  const root = new Group();
  root.add(gltf.scene);
  root.updateMatrixWorld(true);
  const inverse = new Object3D();
  inverse.matrixWorld.copy(root.matrixWorld).invert();

  // what you bump into: the collision copy, hidden
  const col = root.getObjectByName("collision");
  if (!col) throw new Error("lodge: no collision mesh in the model");
  const geo = bake(col, inverse);
  const bvh = new MeshBVH(geo);
  col.visible = false;

  // the back wall's painted patch is a puzzle in the book; hidden until the story layer shows it (L4)
  // (three's loader drops the ":" from node names: "spoiler:back-wall-patch" loads as "spoilerback-wall-patch")
  const patch = root.getObjectByName("spoilerback-wall-patch");
  if (patch) patch.visible = false;

  const doors: Door[] = [];
  const leaves: Object3D[] = [];
  root.traverse((o) => {
    // a leaf with two materials loads as a group of two meshes: take the outermost node
    if (/^door.+\d[LR]?$/.test(o.name) && !(o.parent && o.parent.name === o.name)) leaves.push(o);
  });
  for (const o of leaves) {
    const box = new Box3().setFromObject(o).applyMatrix4(inverse.matrixWorld);
    const side = /\dR$/.test(o.name) ? -1 : 1;
    doors.push({ name: o.name, leaf: o, closed: o.rotation.y, swing: side * SWING, centre: box.getCenter(new Vector3()), box, open: true, t: 1 });
    o.rotation.y = o.rotation.y + side * SWING; // they start open: the house is lived in
  }

  // the ceiling fans: their blades turn (blender/build_lodge.py ceiling_fan)
  type Fan = { room: string; body: Object3D; blades: Object3D; speed: number; turn: number; t: number };
  const fans: Fan[] = [];
  root.traverse((o) => {
    const m = /^fan-(.+)-blades$/.exec(o.name);
    if (m && o.parent) fans.push({ room: m[1], body: o.parent, blades: o, speed: FANS[m[1]] ?? 0, turn: FANS[m[1]] ?? 0, t: Math.random() * 10 });
  });
  for (const f of fans) f.body.traverse((o) => { o.userData.noShadow = true; }); // (their shadows would redraw the map every frame)

  root.position.set(info.at.x, info.at.y, info.at.z);
  scene.add(root);
  root.updateMatrixWorld(true);

  const local = (x: number, z: number) => [x - info.at.x, z - info.at.z] as const;
  const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
  const sphere = new Sphere();
  const reach = info.half + 60; // nothing of the model lies beyond this

  return {
    root,
    floorAt: (x, z, feet) => {
      const [lx, lz] = local(x, z);
      if (Math.abs(lx) > reach || Math.abs(lz) > reach) return null;
      const from = Number.isFinite(feet) ? feet - info.at.y + STEP_UP : 50;
      ray.origin.set(lx, from, lz);
      const hit = bvh.raycastFirst(ray, DoubleSide as unknown as Material);
      return hit && from - hit.point.y < STEP_UP + 3 ? hit.point.y + info.at.y : null;
    },
    hits: (x, z, feet, r) => {
      const [lx, lz] = local(x, z);
      if (Math.abs(lx) > reach || Math.abs(lz) > reach) return false;
      const fy = feet - info.at.y;
      for (const h of [KNEE, CHEST]) {
        sphere.set(new Vector3(lx, fy + h, lz), r);
        if (bvh.intersectsSphere(sphere)) return true;
      }
      for (const d of doors) {
        if (d.t > 0.15) continue; // an open door is out of the way
        const b = d.box;
        const cx = Math.max(b.min.x, Math.min(lx, b.max.x)), cz = Math.max(b.min.z, Math.min(lz, b.max.z));
        if (Math.hypot(lx - cx, lz - cz) < r && fy < b.max.y && fy + 1.8 > b.min.y) return true;
      }
      return false;
    },
    indoors: (x, z) => {
      const [lx, lz] = local(x, z);
      const ax = Math.abs(lx), az = Math.abs(lz);
      return ax < info.half && az < info.half && !(ax < info.court && az < info.court);
    },
    doorNear: (x, z) => {
      const [lx, lz] = local(x, z);
      let best: Door | null = null, bestD = 2.2;
      for (const d of doors) {
        const dd = Math.hypot(lx - d.centre.x, lz - d.centre.z);
        if (dd < bestD) { best = d; bestD = dd; }
      }
      if (!best) return null;
      // double doors open and shut together
      const pair = best.name.replace(/(\d)[LR]$/, "$1");
      return { name: pair, open: best.open };
    },
    lookNear: (x, z) => {
      const [lx, lz] = local(x, z);
      let best: Marker | null = null, bestD = Infinity;
      for (const m of info.markers) {
        if (m.kind !== "look") continue;
        const reachOf = Math.abs(m.at[0]) > info.half || Math.abs(m.at[2]) > info.half ? 4.5 : 2.8; // things outdoors are seen from further
        const d = Math.hypot(lx - m.at[0], lz - m.at[2]);
        if (d < reachOf && d < bestD) { best = m; bestD = d; }
      }
      return best ? { id: best.name.slice(5), label: best.label ?? "", text: best.text ?? "", pages: best.pages ?? [] } : null;
    },
    showPatch: (on) => {
      if (patch) patch.visible = on;
    },
    patchVisible: () => !!patch?.visible,
    toggleDoor: (name) => {
      for (const d of doors) if (d.name === name || d.name.replace(/(\d)[LR]$/, "$1") === name) d.open = !d.open;
    },
    update: (dt) => {
      for (const f of fans) {
        // spin up and run down like a real motor, and wobble a little on the downrod
        f.turn += (f.speed - f.turn) * Math.min(1, dt * 0.6);
        f.blades.rotation.y -= f.turn * dt * Math.PI * 2;
        f.t += dt;
        const w = 0.012 * Math.min(1, f.turn);
        f.body.rotation.x = Math.sin(f.t * 5.1) * w;
        f.body.rotation.z = Math.cos(f.t * 4.3) * w;
      }
      let moved = false;
      for (const d of doors) {
        const target = d.open ? 1 : 0;
        if (d.t === target) continue;
        d.t = Math.max(0, Math.min(1, d.t + Math.sign(target - d.t) * dt * 2.2));
        d.leaf.rotation.y = d.closed + d.swing * d.t;
        moved = true;
      }
      return moved;
    },
    fans: () => fans.map((f) => ({ room: f.room, at: f.blades.getWorldPosition(new Vector3()), speed: f.turn })),
    setFan: (room, speed) => { for (const f of fans) if (f.room === room) f.speed = speed; },
    dispose: () => {
      scene.remove(root);
      geo.dispose();
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          for (const mat of ([] as Material[]).concat(m.material)) mat.dispose();
        }
      });
    },
  };
}
