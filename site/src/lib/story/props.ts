// The things a scene needs beyond the lodge's own furniture (design §10.4):
// the glass on the stool, the Professor's spectacles, the boarded shutters, the
// study's clutter that falls when Dvij faints. Simple shapes in the lodge's
// colours, placed in the lodge's own frame and parented to it.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, SphereGeometry, TorusGeometry, Vector3, type Material,
} from "three";

export type PropSpec = {
  id: string; kind: string; at?: [number, number]; on?: string; state?: string; window?: string; room?: string;
  /** the ground it stands on, in the lodge's frame: the plinth (0.6) indoors, 0 out on the lawn */
  floor?: number;
  /** a point it faces (a chair turned to the others) */
  facing?: [number, number];
};
type Made = { obj: Object3D; set: (state: string) => void; point: () => [number, number, number] };

const PLINTH = 0.6; // the lodge's plinth: rooms' floors stand this high (lodge.yaml house.plinth)
let FLOOR = PLINTH; // the floor of the prop being made (see make)
const mat = (hex: string, opts: Partial<MeshStandardMaterial> = {}) => new MeshStandardMaterial({ color: new Color(hex), roughness: 0.8, ...opts });
const WOOD = mat("#5c3a22"), BRASS = mat("#b08a3a", { metalness: 0.7, roughness: 0.35 });
// real glass: it bends and tints what lies behind it
const GLASS = new MeshPhysicalMaterial({ color: new Color("#dfeeed"), transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0, specularIntensity: 1, envMapIntensity: 2.5 });
const PAPER = mat("#e6d8b4"), CLOTH = mat("#7a2e20"), CLAY = mat("#8a4a2a"), PLANK = mat("#6b4a2c"), IRON = mat("#3a332c");
/** Which of the lodge's own materials (blender/build_lodge.py) each stands for, and the
 * metres one repeat of its texture covers there: a prop made of wood looks like the lodge's wood. */
const LODGE: [MeshStandardMaterial, string, number][] = [
  [WOOD, "wood", 2.0], [PLANK, "wood", 2.0], [BRASS, "brass", 1], [PAPER, "paper", 1], [CLOTH, "cloth", 1],
  [CLAY, "clay", 1], [IRON, "iron", 1],
];

/** UVs in metres, laid flat along whichever axis each face looks down, so a texture
 * keeps the lodge's scale whatever the shape. */
function metreUVs(g: BufferGeometry, tile: number) {
  const pos = g.getAttribute("position"), nrm = g.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const [a, b] = Math.abs(n.y) >= Math.max(Math.abs(n.x), Math.abs(n.z)) ? [x, z] : Math.abs(n.x) >= Math.abs(n.z) ? [z, y] : [x, y];
    uv[i * 2] = a / tile;
    uv[i * 2 + 1] = b / tile;
  }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
}

function at(o: Object3D, x: number, y: number, z: number) {
  o.position.set(x, y, z);
  return o;
}

/** One prop, by kind. Unknown kinds become a small marked box, so a script never breaks the scene. */
function make(p: PropSpec): Made {
  FLOOR = p.floor ?? PLINTH;
  const [x, z] = p.at ?? [0, 0];
  const g = new Group();
  let state = p.state ?? "";
  let top = FLOOR + 0.5; // where things on it rest
  const set: (s: string) => void = (s) => { state = s; };
  switch (p.kind) {
    case "stool": {
      g.add(at(new Mesh(new CylinderGeometry(0.22, 0.22, 0.05, 14), WOOD), 0, FLOOR + 0.48, 0));
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        g.add(at(new Mesh(new BoxGeometry(0.04, 0.46, 0.04), WOOD), Math.cos(a) * 0.15, FLOOR + 0.23, Math.sin(a) * 0.15));
      }
      break;
    }
    case "glass": {
      const glass = at(new Mesh(new CylinderGeometry(0.035, 0.03, 0.11, 12), GLASS), 0, (p.on ? FLOOR + 0.5 : FLOOR) + 0.055, 0);
      const water = at(new Mesh(new CylinderGeometry(0.03, 0.028, 0.05, 12), mat("#7fa7b0", { transparent: true, opacity: 0.7 })), 0, glass.position.y - 0.02, 0);
      g.add(glass, water);
      return {
        obj: at(g, x, 0, z),
        set: (s) => {
          state = s;
          g.visible = s !== "gone";
          water.visible = s !== "rolled-off" && s !== "empty";
          if (s === "rolled-off") { g.position.set(x - 0.4, 0, z - 0.3); glass.rotation.z = Math.PI / 2; glass.position.y = FLOOR + 0.035; }
          if (s === "gone") g.visible = false;
        },
        point: () => [g.position.x, glass.position.y, g.position.z],
      };
    }
    case "spectacles": {
      for (const s of [-0.035, 0.035]) g.add(at(new Mesh(new TorusGeometry(0.025, 0.004, 6, 16), IRON), s, FLOOR + 0.505, 0));
      g.children.forEach((c) => (c.rotation.x = Math.PI / 2));
      break;
    }
    case "deck-chair": {
      // an old cane deck chair, leaning back (novel ¶249: "sitting on a deck chair in a clearing")
      const CANE = mat("#a07a44");
      const seat = at(new Mesh(new BoxGeometry(0.55, 0.04, 0.9), CANE), 0, FLOOR + 0.32, 0);
      seat.rotation.x = -0.35;
      const back = at(new Mesh(new BoxGeometry(0.55, 0.04, 0.6), CANE), 0, FLOOR + 0.6, 0.48);
      back.rotation.x = -1.0;
      g.add(seat, back);
      for (const sx of [-0.27, 0.27]) {
        g.add(at(new Mesh(new BoxGeometry(0.04, 0.5, 0.04), WOOD), sx, FLOOR + 0.25, -0.35));
        g.add(at(new Mesh(new BoxGeometry(0.04, 0.8, 0.04), WOOD), sx, FLOOR + 0.4, 0.55));
        g.add(at(new Mesh(new BoxGeometry(0.04, 0.04, 0.6), WOOD), sx, FLOOR + 0.52, 0.05)); // the arm
      }
      if (p.facing) g.rotation.y = Math.atan2(p.facing[0] - x, p.facing[1] - z) + Math.PI;
      top = FLOOR + 0.6;
      break;
    }
    case "open-book": {
      const b = at(new Mesh(new BoxGeometry(0.22, 0.03, 0.15), CLOTH), 0, FLOOR + 0.515, 0);
      b.rotation.y = 0.4;
      g.add(b);
      break;
    }
    case "rocking-chair": {
      g.add(at(new Mesh(new BoxGeometry(0.5, 0.06, 0.5), WOOD), 0, FLOOR + 0.42, 0));
      g.add(at(new Mesh(new BoxGeometry(0.5, 0.6, 0.05), WOOD), 0, FLOOR + 0.75, 0.24));
      for (const s of [-0.22, 0.22]) {
        const rocker = at(new Mesh(new TorusGeometry(0.4, 0.02, 4, 12, Math.PI / 2.5), WOOD), s, FLOOR + 0.42, 0);
        rocker.rotation.set(0, Math.PI / 2, Math.PI + Math.PI / 5);
        g.add(rocker);
      }
      break;
    }
    case "shutters": {
      // planks nailed across the inside of the window (novel ¶97 "heavily boarded")
      const planks = new Group();
      for (let k = 0; k < 6; k++) planks.add(at(new Mesh(new BoxGeometry(0.05, 0.28, 1.6), PLANK), 0, FLOOR + 1.05 + k * 0.31, 0));
      g.add(planks);
      return {
        obj: at(g, x, 0, z),
        set: (s) => { state = s; planks.visible = s !== "open"; },
        point: () => [x, FLOOR + 1.85, z],
      };
    }
    case "clutter": {
      // books, figurines and a small brass pot on the study floor by the west window: what he knocks over
      const items: Mesh[] = [];
      for (let k = 0; k < 7; k++) {
        const m = k % 3 === 0 ? new Mesh(new CylinderGeometry(0.06, 0.08, 0.32, 8), CLAY)
          : k % 3 === 1 ? new Mesh(new BoxGeometry(0.2, 0.06, 0.28), [CLOTH, PAPER][k % 2])
          : new Mesh(new SphereGeometry(0.08, 8, 6), BRASS);
        items.push(at(m, (k % 4) * 0.22 - 0.3, FLOOR + 0.16, Math.floor(k / 4) * 0.35 - 0.15) as Mesh);
        g.add(m);
      }
      const upright = items.map((m) => m.position.clone());
      return {
        obj: at(g, x, 0, z),
        set: (s) => {
          state = s;
          items.forEach((m, k) => {
            if (s === "knocked") {
              m.position.set(upright[k].x + Math.sin(k * 2.1) * 0.5, FLOOR + 0.05, upright[k].z + Math.cos(k * 1.7) * 0.5);
              m.rotation.set(Math.PI / 2, k, 0);
            } else {
              m.position.copy(upright[k]);
              m.rotation.set(0, 0, 0);
            }
          });
        },
        point: () => [x, FLOOR + 0.2, z],
      };
    }
    default: {
      g.add(at(new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshLambertMaterial({ color: "#a08060" })), 0, FLOOR + 0.1, 0));
      top = FLOOR + 0.2;
    }
  }
  void state;
  return { obj: at(g, x, 0, z), set, point: () => [x, top, z] };
}

/** Where a window's shutters go: the window's middle on its wall. */
const WINDOWS: Record<string, [number, number]> = {
  "dvij-room:0": [-15.75, 5.25], // the west window of the room where he wakes (lodge.yaml)
};
/** Where a room's clutter lies. */
const CLUTTER: Record<string, [number, number]> = {
  study: [-14.6, -13.0], // by the west window, where he falls (novel ¶102)
};

export class Props {
  readonly group = new Group();
  private made = new Map<string, Made>();
  private owned: Material[] = [];

  /** `lodge`: the lodge's model, whose materials the props borrow (by name) if given. */
  constructor(specs: PropSpec[], lodge?: Object3D | null) {
    for (const p of specs) {
      const spec = { ...p, at: p.at ?? (p.window ? WINDOWS[p.window] : p.room ? CLUTTER[p.room] : undefined) };
      const m = make(spec);
      if (p.state) m.set(p.state);
      this.made.set(p.id, m);
      this.group.add(m.obj);
    }
    // the lodge's own materials, without its occlusion atlas and decay (props have no
    // atlas UVs): a copy of each, once
    const borrowed = new Map<Material, [Material, number]>();
    if (lodge) {
      const named = new Map<string, Material>();
      lodge.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) for (const x of ([] as Material[]).concat(m.material)) named.set(x.name, x);
      });
      for (const [plain, name, tile] of LODGE) {
        const theirs = named.get(name);
        if (!(theirs instanceof MeshStandardMaterial)) continue;
        const mine = theirs.clone();
        mine.aoMap = null;
        mine.onBeforeCompile = () => {};
        mine.customProgramCacheKey = () => "prop";
        borrowed.set(plain, [mine, tile]);
        this.owned.push(mine);
      }
    }
    // in the sun's shadows like the lodge's own furniture (glass and water let it through)
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const swap = borrowed.get(m.material as Material);
      if (swap) {
        metreUVs(m.geometry, swap[1]);
        m.material = swap[0];
      }
      m.receiveShadow = true;
      const look = m.material as MeshPhysicalMaterial;
      m.castShadow = !(look.transparent || look.transmission > 0);
    });
  }

  has(id: string) {
    return this.made.has(id);
  }

  set(id: string, state: string) {
    this.made.get(id)?.set(state);
  }

  /** A prop's middle, in the lodge's frame. */
  point(id: string): [number, number, number] | null {
    return this.made.get(id)?.point() ?? null;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.owned) m.dispose();
  }
}
