// The story's own things that the lodge model doesn't have (design §10.4), each
// built to its real size from what the novel and the comic say of it:
//   veena        the study's veena, toppled when Dvij falls, set upright again (novel ¶140-142, comic b1-p007-4)
//   figurine     Varahi: small, pot-bellied, chlorite, her fourth arm broken off (¶147, ¶149, b1-p007-5)
//   manuscript   birch-bark leaves frayed at the edges, in a forgotten script (¶151, ¶153, b1-p007-8)
//   tea-pot      tea on a small stove beside them, that boils over (¶209, b1-p010-7)
//   tulsi-pedestal  a tall pedestal with the young tulsi growing on it (¶213, b1-p010-10)
//   steel-tumbler   a steel tumbler of frothy panchamrita (¶258, b1-p012-7)
//   pitcher      the pitcher Maharaj brings it in (¶257)
//   pipe         the Professor's pipe (comic b1-p012-2)
//   flower-bed   the Professor's parched bed on the front lawn, a low brick edge round dry earth (¶103, b1-p005-1)
//   sapling      "the sapling's only leaf": planted, then crushed under Baldev's foot (¶104, b1-p005-2/3)
//   watering-can a galvanised can, knocked over by Mahant (¶108, b1-p005-6)
//   scroll       the Maharaj's invitation, rolled and tied, then opened (¶111-118, b1-p005-8/11)
// Shapes in metres; the materials are props.ts's, which take on the lodge's own.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, LatheGeometry, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, SphereGeometry,
  SRGBColorSpace, TorusGeometry, Vector2, type Material,
} from "three";

export type Mats = { WOOD: Material; BRASS: Material; PAPER: Material; CLOTH: Material; CLAY: Material; IRON: Material; PLASTER: Material };
export type Thing = {
  obj: Object3D; set: (state: string) => void; point: () => [number, number, number];
  /** what a hand picks up of it (a cup), if anything */
  handle?: Object3D;
  update?: (dt: number) => void; dispose?: () => void;
};

const std = (hex: string, o: Partial<MeshStandardMaterial> = {}) => new MeshStandardMaterial({ color: new Color(hex), roughness: 0.8, ...o });
const at = <T extends Object3D>(o: T, x: number, y: number, z: number) => { o.position.set(x, y, z); return o; };
const lathe = (pts: [number, number][], seg = 24) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), seg);

/** Birch bark, written on: pale tan, darker toward its frayed and torn edges, rows of dark script. */
function barkTexture(seed: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 192;
  const g = c.getContext("2d")!;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#cdb48a";
  g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 160; k++) { // the bark's own horizontal lenticels
    g.fillStyle = `rgba(90,60,30,${0.08 + rnd() * 0.12})`;
    g.fillRect(rnd() * c.width, rnd() * c.height, 8 + rnd() * 30, 1 + rnd() * 2);
  }
  g.strokeStyle = "rgba(40,25,15,0.85)";
  g.lineWidth = 2;
  for (let row = 0; row < 7; row++) { // script: hooked strokes hung from a line, not any real alphabet
    const y = 30 + row * 21;
    for (let x = 30; x < c.width - 30; x += 9 + rnd() * 6) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rnd() * 5, y + 6 + rnd() * 6);
      if (rnd() > 0.5) g.lineTo(x + 4 + rnd() * 3, y + 3);
      g.stroke();
    }
  }
  // frayed: darker and eaten away toward the edges
  const edge = g.createLinearGradient(0, 0, c.width, 0);
  edge.addColorStop(0, "rgba(70,45,20,0.6)"); edge.addColorStop(0.08, "rgba(70,45,20,0)");
  edge.addColorStop(0.92, "rgba(70,45,20,0)"); edge.addColorStop(1, "rgba(70,45,20,0.6)");
  g.fillStyle = edge;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-out";
  for (let k = 0; k < 90; k++) {
    const side = rnd() < 0.5, x = side ? rnd() * 40 : c.width - rnd() * 40, y = rnd() * c.height;
    g.beginPath();
    g.arc(side ? x - 10 : x + 10, y, 4 + rnd() * 12, 0, Math.PI * 2);
    g.fill();
  }
  for (let k = 0; k < 40; k++) {
    const y = rnd() < 0.5 ? rnd() * 10 : c.height - rnd() * 10;
    g.beginPath();
    g.arc(rnd() * c.width, y, 3 + rnd() * 7, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft white puff, for steam. */
function puffTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Steam rising off something hot: a few puffs that rise, swell and fade, over and over. */
function steam(rate: number) {
  const tex = puffTexture();
  const material = new MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, color: 0xffffff, emissive: 0x222222, blending: AdditiveBlending, side: DoubleSide });
  const group = new Group();
  const puffs = Array.from({ length: 10 }, (_, k) => {
    const m = new Mesh(new PlaneGeometry(0.08, 0.08), material.clone());
    m.userData.t = k / 10;
    group.add(m);
    return m;
  });
  let strength = 0;
  return {
    group,
    set: (s: number) => { strength = s; },
    update: (dt: number, camera?: Object3D) => {
      for (const m of puffs) {
        m.userData.t = (m.userData.t + dt * rate) % 1;
        const t = m.userData.t;
        m.position.set(Math.sin(t * 9 + m.id) * 0.03 * t, t * 0.35, Math.cos(t * 7 + m.id) * 0.03 * t);
        m.scale.setScalar(0.5 + t * 2.2);
        (m.material as MeshStandardMaterial).opacity = strength * 0.45 * Math.sin(Math.PI * t);
        if (camera) m.quaternion.copy(camera.quaternion);
        else m.rotation.y += dt;
      }
    },
    dispose: () => { tex.dispose(); for (const m of puffs) { m.geometry.dispose(); (m.material as Material).dispose(); } },
  };
}

export function makeThing(kind: string, x: number, z: number, floor: number, state: string, M: Mats): Thing | null {
  const g = new Group();
  switch (kind) {
    case "veena": {
      // a Saraswati veena, about 1.3 m: the great round resonator, the fretted neck, the
      // second gourd under it, the dragon's head (yali) at the end, four strings
      const v = new Group();
      const kudam = at(new Mesh(new SphereGeometry(0.21, 20, 14), M.WOOD), 0, 0, 0);
      kudam.scale.set(1, 0.85, 0.75);
      const top = at(new Mesh(new CylinderGeometry(0.17, 0.17, 0.012, 20), M.WOOD), 0, 0, 0.152);
      top.rotation.x = Math.PI / 2;
      const neck = at(new Mesh(new BoxGeometry(0.88, 0.075, 0.06), M.WOOD), 0.58, 0, 0.11);
      v.add(kudam, top, neck);
      for (let k = 0; k < 22; k++) v.add(at(new Mesh(new BoxGeometry(0.004, 0.07, 0.012), M.BRASS), 0.22 + k * 0.034, 0, 0.145)); // the frets
      v.add(at(new Mesh(new SphereGeometry(0.11, 14, 10), M.CLAY), 0.82, 0, -0.06)); // the gourd under the neck
      const yali = at(new Mesh(new TorusGeometry(0.07, 0.025, 8, 12, Math.PI), M.WOOD), 1.04, 0.0, 0.07);
      yali.rotation.x = Math.PI / 2;
      v.add(yali, at(new Mesh(new SphereGeometry(0.035, 10, 8), M.WOOD), 1.1, 0, 0.0));
      const strings = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(
        [-0.12, -0.012, 0.16, 1.0, -0.012, 0.15, -0.12, -0.004, 0.16, 1.0, -0.004, 0.15, -0.12, 0.004, 0.16, 1.0, 0.004, 0.15, -0.12, 0.012, 0.16, 1.0, 0.012, 0.15], 3));
      const lines = new Line(strings, new LineBasicMaterial({ color: 0xc8b890 }));
      v.add(lines);
      g.add(v);
      const pose = (s: string) => {
        if (s === "toppled") { // on its side on the floor (¶140)
          v.position.set(0, floor + 0.16, 0);
          v.rotation.set(Math.PI / 2, 0, 0.3);
        } else { // pulled upright and stacked against the writing desk (¶142): standing on its resonator, leaning
          v.position.set(0, floor + 0.2, 0);
          v.rotation.set(0, 0.4, 1.25);
        }
      };
      pose(state);
      return { obj: at(g, x, 0, z), set: pose, point: () => [x, floor + 0.3, z] };
    }
    case "figurine": {
      // Varahi: a small chlorite figure, 17 cm, pot-bellied, boar-faced; her fourth arm broken off (¶147)
      const stone = std("#3a3f37", { roughness: 0.42, metalness: 0.05 });
      const f = new Group();
      f.add(at(new Mesh(new BoxGeometry(0.075, 0.018, 0.05), stone), 0, 0.009, 0)); // the plinth
      f.add(at(new Mesh(lathe([[0, 0], [0.024, 0.005], [0.022, 0.03], [0.012, 0.05], [0, 0.05]], 12), stone), 0, 0.018, 0)); // legs, folded
      const belly = at(new Mesh(new SphereGeometry(0.026, 14, 10), stone), 0, 0.085, 0.006);
      belly.scale.set(1, 0.95, 0.9);
      f.add(belly, at(new Mesh(new CylinderGeometry(0.014, 0.02, 0.035, 10), stone), 0, 0.12, 0)); // the chest
      f.add(at(new Mesh(new SphereGeometry(0.014, 10, 8), stone), 0, 0.147, 0)); // the head
      const snout = at(new Mesh(new CylinderGeometry(0.004, 0.009, 0.018, 8), stone), 0, 0.143, 0.016); // a boar's snout
      snout.rotation.x = Math.PI / 2;
      f.add(snout, at(new Mesh(new CylinderGeometry(0.006, 0.011, 0.018, 8), stone), 0, 0.165, 0)); // the crown
      for (const [sx, a, len] of [[-1, 0.5, 0.04], [1, -0.5, 0.04], [-1, 1.1, 0.035], [1, -1.1, 0.012]] as const) { // four arms, the last a stump
        const arm = at(new Mesh(new CylinderGeometry(0.004, 0.005, len, 6), stone), sx * 0.022, 0.12 - len / 2 + 0.01, 0.004);
        arm.rotation.z = a;
        f.add(arm);
      }
      g.add(at(f, 0, floor, 0));
      return { obj: at(g, x, 0, z), set: () => {}, point: () => [x, floor + 0.1, z], handle: f }; // (the Professor picks her up: handling.ts)
    }
    case "manuscript": {
      // birch-bark leaves (¶153), loosely stacked, frayed at the edges
      const leaves: Material[] = [];
      const stack = new Group(); // (picked up together: handling.ts)
      g.add(stack);
      for (let k = 0; k < 7; k++) {
        const m = new MeshStandardMaterial({ map: barkTexture(11 + k * 7), roughness: 0.9, alphaTest: 0.5, side: DoubleSide });
        leaves.push(m);
        const leaf = at(new Mesh(new PlaneGeometry(0.3, 0.11), m), (k % 3 - 1) * 0.006, floor + 0.785 + k * 0.0025, (k % 2) * 0.004);
        leaf.rotation.set(-Math.PI / 2, 0, (k - 3) * 0.02);
        leaf.castShadow = false;
        stack.add(leaf);
      }
      return { obj: at(g, x, 0, z), set: () => {}, point: () => [x, floor + 0.8, z], handle: stack, dispose: () => leaves.forEach((m) => { (m as MeshStandardMaterial).map?.dispose(); m.dispose(); }) };
    }
    case "tea-pot": {
      // a small brass kerosene stove, its burner's blue ring, an aluminium pan of milky tea on it (¶209)
      const ALU = std("#a9a9a4", { metalness: 0.8, roughness: 0.35 });
      const TEA = std("#b08d62", { roughness: 0.25 });
      const FROTH = std("#e2d2b6", { roughness: 0.95 });
      const s = new Group();
      s.add(at(new Mesh(new CylinderGeometry(0.1, 0.11, 0.09, 18), M.BRASS), 0, 0.045, 0)); // the tank
      s.add(at(new Mesh(new CylinderGeometry(0.03, 0.035, 0.06, 10), M.IRON), 0, 0.12, 0)); // the burner
      const flame = at(new Mesh(new TorusGeometry(0.03, 0.006, 6, 16), new MeshStandardMaterial({ color: 0x2244ff, emissive: 0x3355ff, emissiveIntensity: 2 })), 0, 0.152, 0);
      flame.rotation.x = Math.PI / 2;
      s.add(flame);
      for (let k = 0; k < 3; k++) { // the pan supports
        const a = (k / 3) * Math.PI * 2;
        const leg = at(new Mesh(new BoxGeometry(0.012, 0.1, 0.012), M.IRON), Math.cos(a) * 0.09, 0.14, Math.sin(a) * 0.09);
        s.add(leg);
      }
      const pan = at(new Mesh(lathe([[0, 0], [0.085, 0], [0.09, 0.005], [0.092, 0.09], [0.095, 0.092], [0.088, 0.092], [0.086, 0.006], [0, 0.006]], 24), ALU), 0, 0.19, 0);
      const handle = at(new Mesh(new BoxGeometry(0.15, 0.012, 0.025), M.WOOD), 0.17, 0.26, 0);
      const tea = at(new Mesh(new CylinderGeometry(0.084, 0.084, 0.004, 24), TEA), 0, 0.25, 0);
      const froth = at(new Mesh(new SphereGeometry(0.095, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), FROTH), 0, 0.27, 0);
      froth.scale.y = 0.35;
      const drips = new Group(); // what has run down the pan's side
      for (let k = 0; k < 6; k++) {
        const a = k * 1.1;
        drips.add(at(new Mesh(new CylinderGeometry(0.006, 0.01, 0.06 + (k % 3) * 0.02, 6), FROTH), Math.cos(a) * 0.094, 0.25, Math.sin(a) * 0.094));
      }
      const vapour = steam(0.8);
      vapour.group.position.y = 0.3;
      s.add(pan, handle, tea, froth, drips, vapour.group);
      g.add(at(s, 0, floor, 0));
      const set = (st: string) => {
        const over = st === "boiling-over";
        froth.visible = drips.visible = over;
        tea.position.y = over ? 0.275 : 0.25;
        vapour.set(over ? 1 : 0.45);
      };
      set(state);
      return {
        obj: at(g, x, 0, z), set, point: () => [x, floor + 0.3, z],
        update: (dt) => vapour.update(dt),
        dispose: vapour.dispose,
      };
    }
    case "tulsi-pedestal": {
      // a tulsi vrindavan: a tall square pedestal, stepped at the foot, an arched niche for a lamp,
      // a basin at the top with the young plant in it (¶213 "a tall pedestal with a plant growing on it")
      const KUMKUM = std("#9a3a24", { roughness: 0.7 });
      const LEAF = std("#3d5a2a", { roughness: 0.7 });
      const LEAF2 = std("#4b3a4a", { roughness: 0.7 }); // the purple of krishna tulsi
      const t = new Group();
      t.add(at(new Mesh(new BoxGeometry(0.8, 0.12, 0.8), M.PLASTER), 0, 0.06, 0));
      t.add(at(new Mesh(new BoxGeometry(0.66, 0.1, 0.66), M.PLASTER), 0, 0.17, 0));
      t.add(at(new Mesh(new BoxGeometry(0.52, 0.8, 0.52), M.PLASTER), 0, 0.62, 0));
      t.add(at(new Mesh(new BoxGeometry(0.6, 0.08, 0.6), M.PLASTER), 0, 1.06, 0)); // the cap
      t.add(at(new Mesh(new BoxGeometry(0.53, 0.05, 0.53), KUMKUM), 0, 0.98, 0)); // a band of red
      const niche = at(new Mesh(new BoxGeometry(0.16, 0.2, 0.02), M.IRON), 0, 0.55, 0.255); // the lamp's niche, dark
      t.add(niche, at(new Mesh(new SphereGeometry(0.02, 8, 6), M.CLAY), 0, 0.47, 0.265)); // a clay diya in it
      t.add(at(new Mesh(lathe([[0, 0], [0.22, 0], [0.25, 0.14], [0.22, 0.14], [0.2, 0.03], [0, 0.03]], 16), M.CLAY), 0, 1.1, 0)); // the basin
      const plant = new Group();
      plant.add(at(new Mesh(new CylinderGeometry(0.006, 0.01, 0.32, 6), M.WOOD), 0, 0.16, 0));
      let s = 5;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 70; k++) { // small leaves round the young shoots
        const h = 0.08 + rnd() * 0.26, a = rnd() * Math.PI * 2, r = 0.02 + rnd() * (0.14 - h * 0.25);
        const leaf = at(new Mesh(new SphereGeometry(0.018, 5, 3), rnd() < 0.3 ? LEAF2 : LEAF), Math.cos(a) * r, h, Math.sin(a) * r);
        leaf.scale.set(1, 0.3, 0.6);
        leaf.rotation.set(rnd(), a, rnd());
        plant.add(leaf);
      }
      t.add(at(plant, 0, 1.13, 0));
      g.add(at(t, 0, floor - 0.3, 0)); // (it stands on the courtyard's floor, a step down)
      return { obj: at(g, x, 0, z), set: () => {}, point: () => [x, floor + 1.3, z], update: (dt) => { plant.rotation.y += Math.sin(performance.now() / 900) * dt * 0.05; } };
    }
    case "steel-tumbler": case "pitcher": {
      // a steel tumbler of frothy panchamrita (¶258), or the pitcher it came in (¶257)
      const STEEL = std("#c8c8c4", { metalness: 0.95, roughness: 0.22 });
      const MILK = std("#eee6d4", { roughness: 0.6 });
      const big = kind === "pitcher";
      const h = big ? 0.24 : 0.1, r = big ? 0.075 : 0.036;
      const t = new Group();
      t.add(new Mesh(lathe([[0, 0], [r * 0.82, 0], [r * 0.9, 0.004], [r, h - 0.006], [r + 0.003, h], [r - 0.002, h], [r - 0.003, 0.006], [0, 0.006]], 28), STEEL));
      if (big) {
        const handle = at(new Mesh(new TorusGeometry(0.05, 0.008, 6, 14, Math.PI), STEEL), r + 0.01, h * 0.55, 0);
        handle.rotation.z = -Math.PI / 2;
        t.add(handle);
      }
      const drink = at(new Mesh(new CylinderGeometry(r - 0.003, r * 0.85, 0.003, 24), MILK), 0, h - 0.012, 0);
      const froth = at(new Mesh(new SphereGeometry(r - 0.004, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), MILK), 0, h - 0.012, 0);
      froth.scale.y = 0.25;
      t.add(drink, froth);
      g.add(at(t, 0, floor, 0));
      const set = (st: string) => {
        g.visible = st !== "gone";
        drink.visible = froth.visible = st !== "empty";
      };
      set(state);
      return { obj: at(g, x, 0, z), set, point: () => [x, floor + h, z], handle: t }; // (the pitcher too: Maharaj carries it, ¶257)
    }
    case "pipe": {
      // the Professor's pipe, unlit in his hand on the lawn (comic b1-p012-2; the author, 21 Oct)
      const BRIAR = std("#4a2c1a", { roughness: 0.35, metalness: 0.05, side: DoubleSide }); // (the bowl's inside wall faces in)
      const BIT = std("#141210", { roughness: 0.25 });
      const t = new Group();
      // the bowl: rounded below, its rim lipped, hollow and charred inside (one lathe, out and back in)
      const bowl = at(new Mesh(lathe([[0, 0], [0.009, 0.002], [0.015, 0.012], [0.0165, 0.026], [0.015, 0.04], [0.0105, 0.04], [0.0105, 0.014], [0, 0.012]], 18), BRIAR), 0, 0, 0);
      const char = at(new Mesh(new CylinderGeometry(0.0104, 0.0104, 0.002, 14), std("#1a1210", { roughness: 0.95 })), 0, 0.03, 0);
      // the shank out of the bowl's foot, then the black bit, bent a little up to the mouth
      const shank = new Mesh(new CylinderGeometry(0.0055, 0.0065, 0.06, 10), BRIAR);
      shank.rotation.z = Math.PI / 2 - 0.1;
      shank.position.set(0.042, 0.009, 0);
      const bit = new Mesh(new CylinderGeometry(0.0032, 0.0052, 0.06, 10), BIT);
      bit.rotation.z = Math.PI / 2 - 0.3;
      bit.position.set(0.1, 0.02, 0);
      const lip = at(new Mesh(new BoxGeometry(0.008, 0.0035, 0.009), BIT), 0.129, 0.029, 0);
      lip.rotation.z = -0.3;
      t.add(bowl, char, shank, bit, lip);
      const g = new Group();
      g.add(t);
      return { obj: at(g, x, floor, z), set: () => {}, point: () => [x, floor, z], handle: t };
    }
    case "medical-kit": {
      // what Bhavi works with (novel ¶282-283): an enamel tray, a roll of medical tape, gauze, cotton
      // wool, a bottle of crystal violet, a strip of plasters, scissors; the old gauze with its strip of dry blood
      const ENAMEL = std("#e9e7e0", { roughness: 0.35 });
      const COTTON = std("#f4f2ec", { roughness: 1 });
      const VIOLET = std("#3b1258", { roughness: 0.15 });
      const BLOOD = std("#5a1a12", { roughness: 0.9 });
      const k = new Group();
      k.add(at(new Mesh(new BoxGeometry(0.28, 0.012, 0.2), ENAMEL), 0, 0.006, 0));
      k.add(at(new Mesh(new BoxGeometry(0.29, 0.02, 0.008), ENAMEL), 0, 0.016, 0.1), at(new Mesh(new BoxGeometry(0.29, 0.02, 0.008), ENAMEL), 0, 0.016, -0.1));
      const tape = at(new Mesh(new TorusGeometry(0.022, 0.009, 8, 16), COTTON), -0.08, 0.021, -0.04);
      tape.rotation.x = Math.PI / 2;
      k.add(tape);
      const wool = at(new Mesh(new SphereGeometry(0.035, 10, 6), COTTON), 0.06, 0.03, -0.045);
      wool.scale.set(1.3, 0.6, 1);
      k.add(wool);
      k.add(at(new Mesh(lathe([[0, 0], [0.018, 0], [0.018, 0.055], [0.008, 0.07], [0.006, 0.085], [0, 0.085]], 12), VIOLET), 0.1, 0.012, 0.05));
      k.add(at(new Mesh(new BoxGeometry(0.07, 0.003, 0.05), COTTON), -0.03, 0.014, 0.05)); // a gauze pad
      const used = at(new Mesh(new BoxGeometry(0.05, 0.003, 0.035), COTTON), -0.09, 0.016, 0.06); // the old gauze, taken off
      used.rotation.y = 0.5;
      const stain = at(new Mesh(new BoxGeometry(0.035, 0.0035, 0.008), BLOOD), -0.09, 0.0165, 0.06);
      stain.rotation.y = 0.5;
      k.add(used, stain);
      g.add(at(k, 0, floor, 0));
      return { obj: at(g, x, 0, z), set: () => {}, point: () => [x, floor + 0.05, z] };
    }
    case "flower-bed": {
      // a low edge of old bricks round a bed of dry, cracked earth, a little raised (¶103 "the parched flower bed")
      const EARTH = std("#7a5a3a", { roughness: 1 });
      const BRICK = std("#8c4a30", { roughness: 0.9 });
      const W = 2.4, D = 1.2;
      const b = new Group();
      b.add(at(new Mesh(new BoxGeometry(W - 0.12, 0.08, D - 0.12), EARTH), 0, 0.04, 0));
      for (const [w, d, ox, oz] of [[W, 0.1, 0, D / 2], [W, 0.1, 0, -D / 2], [0.1, D, W / 2, 0], [0.1, D, -W / 2, 0]] as const) {
        b.add(at(new Mesh(new BoxGeometry(w, 0.12, d), BRICK), ox, 0.06, oz));
      }
      let s = 11;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 18; k++) { // clods
        const c = at(new Mesh(new SphereGeometry(0.04 + rnd() * 0.04, 6, 4), EARTH), (rnd() - 0.5) * (W - 0.3), 0.08, (rnd() - 0.5) * (D - 0.3));
        c.scale.y = 0.5;
        b.add(c);
      }
      g.add(at(b, 0, floor, 0));
      return { obj: at(g, x, 0, z), set: () => {}, point: () => [x, floor + 0.1, z] };
    }
    case "sapling": {
      // a thin stem with a single leaf, in a small well of watered earth; crushed: bent flat, the leaf torn
      const STEM = std("#5a4a2a", { roughness: 0.8 });
      const LEAF = std("#5e7d34", { roughness: 0.6, side: DoubleSide });
      const WET = std("#4a3424", { roughness: 0.6 });
      const t = new Group();
      t.add(at(new Mesh(new CylinderGeometry(0.09, 0.11, 0.02, 14), WET), 0, 0.085, 0));
      const plant = new Group();
      plant.add(at(new Mesh(new CylinderGeometry(0.004, 0.006, 0.22, 6), STEM), 0, 0.11, 0));
      const leaf = at(new Mesh(new SphereGeometry(0.035, 8, 4), LEAF), 0.025, 0.2, 0);
      leaf.scale.set(1, 0.15, 0.55);
      leaf.rotation.z = -0.4;
      plant.add(leaf);
      t.add(at(plant, 0, 0.09, 0));
      g.add(at(t, 0, floor, 0));
      const set = (st: string) => {
        const crushed = st === "crushed";
        plant.rotation.set(crushed ? 1.45 : 0, crushed ? 0.6 : 0, 0);
        leaf.scale.set(crushed ? 0.7 : 1, crushed ? 0.08 : 0.15, crushed ? 0.4 : 0.55);
      };
      set(state);
      return { obj: at(g, x, 0, z), set, point: () => [x, floor + 0.25, z] };
    }
    case "watering-can": {
      // a galvanised can with a long spout and a rose; spilled: on its side, a dark stain of water spreading
      const ZINC = std("#9aa0a0", { metalness: 0.8, roughness: 0.4 });
      const WATER = std("#3a2a1c", { roughness: 0.25 });
      const c = new Group();
      c.add(at(new Mesh(new CylinderGeometry(0.1, 0.11, 0.26, 16), ZINC), 0, 0.13, 0));
      const spout = at(new Mesh(new CylinderGeometry(0.012, 0.02, 0.36, 8), ZINC), 0.2, 0.2, 0);
      spout.rotation.z = -0.9;
      const rose = at(new Mesh(new CylinderGeometry(0.035, 0.02, 0.04, 10), ZINC), 0.35, 0.3, 0);
      rose.rotation.z = -0.9;
      const handle = at(new Mesh(new TorusGeometry(0.09, 0.01, 6, 14, Math.PI), ZINC), -0.02, 0.26, 0);
      c.add(spout, rose, handle);
      const stain = at(new Mesh(new CylinderGeometry(0.3, 0.3, 0.004, 20), WATER), 0.35, 0.003, 0.05);
      stain.scale.set(1.2, 1, 0.7);
      g.add(at(c, 0, floor, 0), stain);
      stain.position.y = floor + 0.003;
      const set = (st: string) => {
        const down = st === "spilled";
        c.rotation.set(down ? Math.PI / 2 : 0, 0, 0);
        c.position.y = floor + (down ? 0.1 : 0);
        stain.visible = down;
      };
      set(state);
      return { obj: at(g, x, 0, z), set, point: () => [x, floor + 0.15, z] };
    }
    case "scroll": {
      // the invitation (¶111): a roll of paper tied with a red cord; open: unrolled, held flat, written on
      const RED = std("#9a2a1c", { roughness: 0.7 });
      const t = new Group();
      const roll = at(new Mesh(new CylinderGeometry(0.018, 0.018, 0.3, 12), M.PAPER), 0, 0, 0);
      roll.rotation.z = Math.PI / 2;
      const cord = at(new Mesh(new TorusGeometry(0.02, 0.003, 6, 12), RED), 0, 0, 0);
      cord.rotation.y = Math.PI / 2;
      const sheet = at(new Mesh(new BoxGeometry(0.3, 0.002, 0.4), M.PAPER), 0, 0, -0.2);
      const writing = at(new Mesh(new PlaneGeometry(0.24, 0.3), new MeshStandardMaterial({ map: barkTexture(7), transparent: true, opacity: 0.55, roughness: 1 })), 0, 0.002, -0.2);
      writing.rotation.x = -Math.PI / 2;
      t.add(roll, cord, sheet, writing);
      g.add(at(t, 0, floor, 0));
      const set = (st: string) => {
        const open = st === "open";
        cord.visible = !open;
        sheet.visible = writing.visible = open;
      };
      set(state);
      return { obj: at(g, x, 0, z), set, point: () => [x, floor, z], handle: t };
    }
    default:
      return null;
  }
}

