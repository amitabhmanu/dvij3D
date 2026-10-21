// Walking the valley (design §10.2): the game itself. Loaded only when a
// reader presses "Enter the valley" on /valley/walk/, so the page's first load
// is just its start screen.
//
// A fixed 60 Hz step moves the player; every animation frame draws. Nothing
// runs while paused.
import {
  AmbientLight, BackSide, Color, DirectionalLight, DoubleSide, Euler, Fog, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Quaternion,
  Scene, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, Texture, TextureLoader,
  Vector2, Vector3, WebGLRenderer,
} from "three";
import { decodeHeights, fieldFor, heightAt, setFlat, type Field } from "./heights";
import { loadLodge, type Look, type Lodge, type Marker } from "./lodge";
import lodgeInfo from "../../content/generated/lodge.json";
import siteInfo from "../../content/generated/temple-site.json";
import { groundGeometry, groundMaterial } from "./ground";
import { inkComposer } from "./post";
import { SightEffect } from "../story/effects";
import { findRoute } from "../story/route";
import { cutoutMesh, decodeTrees, type Stand } from "./cutouts";
import type { EffectComposer } from "postprocessing";
import { Input, type Settings } from "./input";
import { Blockers, inside, step, type Player } from "./player";
import { atlas, walk, walkAsset, type Building } from "./walk-data";
import { Sounds, type Surface } from "./audio";

export type Quality = "low" | "medium" | "high";
export type GameOptions = {
  canvas: HTMLCanvasElement;
  heightUrl: string;
  worldUrl: string;
  groundUrl: string;
  quality: Quality;
  volume: number;
  /** Story mode (design §10.4): the director drives the body and the eyes. */
  story?: boolean;
  onProgress: (fraction: number, what: string) => void;
  /** About five times a second while walking: where you are, for the HUD and tests. */
  onStats?: (s: { x: number; z: number; heading: number; ground: number; indoors: boolean; door: { name: string; open: boolean } | null; look: Look | null }) => void;
  /** Every frame: for the compass and the small map, which move with you. */
  onFrame?: (x: number, z: number, heading: number) => void;
};

export type Game = {
  start: () => void;
  pause: () => void;
  input: Input;
  settings: Settings;
  teleport: (x: number, z: number, heading?: number) => void;
  /** The nearest spot to (x, z) you could stand on: not in the lake, a building or a tree. */
  standable: (x: number, z: number) => [number, number];
  player: () => Player;
  ground: (x: number, z: number) => number;
  setQuality: (q: Quality) => void;
  setVolume: (v: number) => void;
  /** "off" until the first click to walk; then the audio context's state. */
  soundState: () => string;
  /** Open or shut the door you're standing at, if any. */
  useDoor: () => boolean;
  /** Where things are in the lodge, in world metres: for fast travel and the tests. */
  lodgePoint: (name: string) => [number, number, number] | null;
  /** Show the lodge's back-wall puzzle (for a reader who has reached it). */
  showPatch: (on: boolean) => void;
  patchVisible: () => boolean;
  dispose: () => void;
  /** Story mode's hold on Dvij's body and eyes. */
  body: Body;
};

/** How story mode moves Dvij (design §10.4). All positions are world metres. */
export type Body = {
  sight: SightEffect;
  /** Where he is and how: lying, sitting, standing, on the floor; eases there over `seconds`. */
  pose: (p: { pose: "lie" | "sit" | "sit-low" | "stand" | "floor"; at?: [number, number]; look?: "up" | [number, number, number]; seconds?: number }) => Promise<void>;
  /** "free": walk and look; "look": look only; "none": the director has the camera. */
  hold: (h: "free" | "look" | "none") => void;
  /** Injured: slow, swaying steps. */
  injured: (on: boolean) => void;
  /** A brief look somewhere and back (at his arm, at someone). */
  glance: (pitch: number, seconds: number) => Promise<void>;
  /** Tip over and drop to the floor: the faint. */
  faint: (seconds: number) => Promise<void>;
  /** Is he looking at this point, within `degrees`? */
  lookingAt: (p: [number, number, number], degrees: number) => boolean;
  /** Turn his head to this point, at once. */
  face: (p: [number, number, number]) => void;
  /** Turn to look at this point over `seconds` (watch mode). */
  turnTo: (p: [number, number, number], seconds: number) => Promise<void>;
  /** Walk there by himself, round the walls (watch mode). */
  walkTo: (at: [number, number]) => Promise<void>;
  /** Stop whatever he was moving through: a new scene is starting. */
  halt: () => void;
  /** How fast the story's time runs: 0.5 slow motion, 1, 2 or 4 fast forward. */
  rate: (r: number) => void;
  /** The lodge's frame -> the world's. */
  fromLodge: (x: number, y: number, z: number) => [number, number, number];
  lodgeRoot: () => import("three").Object3D | null;
  /** Another built place's frame -> the world's, and its model: "temple-site" (Chapter 9). */
  fromSite: (id: string, x: number, y: number, z: number) => [number, number, number];
  siteRoot: (id: string) => import("three").Object3D | null;
  fx: (name: string) => void;
};

// Colours are written as the eye sees them (sRGB); Color() turns them into the
// linear light the shaders work in.
const lin = (hex: string) => { const c = new Color(hex); return new Vector3(c.r, c.g, c.b); };
const SKY_TOP = lin("#7f9fb4");
export const HAZE = lin("#e2d3b4"); // the sky at the horizon and the far haze are one colour
export const PAPER = lin("#c9a878");
const SUN_DIR = new Vector3(0.85, 0.42, -0.2).normalize();
const GRID: Record<Quality, number> = { low: 192, medium: 288, high: 384 };
const PIXELS: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
const DRAW: Record<Quality, [number, number]> = { low: [450, 700], medium: [1100, 1600], high: [2000, 2800] };
const STEP = 1 / 60;

async function fetchWithProgress(url: string, onBytes: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onBytes(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => new TextureLoader().load(url, resolve, undefined, reject));
}

function skyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { top: { value: SKY_TOP }, low: { value: HAZE }, sun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 low; uniform vec3 sun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(low, top, smoothstep(0.1, 0.55, d.y)); // haze-coloured up past the farthest land
        c += vec3(1.0, 0.85, 0.6) * pow(max(dot(d, sun), 0.0), 24.0) * 0.55; // a low sun in the east
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new Mesh(new SphereGeometry(10000, 24, 12), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

export async function createGame(o: GameOptions): Promise<Game> {
  const h = walk.height;
  o.onProgress(0, "Unrolling the map");
  const [heightBuf, worldJson, colours, treeBuf, cutTex] = await Promise.all([
    fetchWithProgress(o.heightUrl, (f) => o.onProgress(f * 0.6, "Raising the hills")),
    fetch(o.worldUrl).then((r) => r.json() as Promise<{ boulders: [number, number, number, number, number][]; buildings: Building[] }>),
    loadTexture(o.groundUrl),
    fetch(walkAsset(walk.trees)).then((r) => r.arrayBuffer()),
    loadTexture(walkAsset(walk.cutouts)),
  ]);
  colours.colorSpace = SRGBColorSpace;
  cutTex.colorSpace = SRGBColorSpace;
  cutTex.flipY = false; // the atlas rectangles count from the image's top
  cutTex.needsUpdate = true;
  o.onProgress(0.75, "Laying the paths");
  const field: Field = fieldFor(await decodeHeights(heightBuf, h.w, h.h, h.scale), h.w, h.h, walk);
  // the lodge and the temple site stand on levelled ground
  const pads = [{ rect: walk.lodge.pad, blend: walk.lodge.blend }, ...(walk.sites ?? []).map((s) => ({ rect: s.pad, blend: s.blend }))];
  setFlat(pads);
  const terrain = (x: number, z: number) => heightAt(field, x, z);
  // The ground you stand on: the land, or the lodge's floors and steps under you.
  let feet = Infinity; // where your feet were at the last step; Infinity when you've just arrived
  let lodge: Lodge | null = null;
  const sites = new Map<string, Lodge>(); // the other built places (the temple site), loaded like the lodge
  const models = () => (lodge ? [lodge, ...sites.values()] : [...sites.values()]);
  const floorAt = (x: number, z: number) => {
    let best: number | null = null;
    for (const m of models()) {
      const f = m.floorAt(x, z, feet);
      if (f != null && (best == null || f > best)) best = f;
    }
    return best;
  };
  const ground = (x: number, z: number) => {
    const land = terrain(x, z);
    const floor = floorAt(x, z);
    return floor != null && floor > land - 0.05 ? floor : land;
  };
  const built = (x: number, z: number) => (floorAt(x, z) ?? -Infinity) > terrain(x, z) + 0.02;
  const indoorsAt = (x: number, z: number) => models().some((m) => m.indoors(x, z));

  const renderer = new WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.fog = new Fog(new Color(HAZE.x, HAZE.y, HAZE.z), 900, 7000);
  // near 0.5 m, not 0.1: the ink pass reads distances back from the depth buffer,
  // and a closer near plane leaves too little precision for the far valley
  const camera = new PerspectiveCamera(70, 1, 0.5, 12000);
  camera.rotation.order = "YXZ";
  const sky = skyDome();
  scene.add(sky);

  // The land.
  const reach = 8000;
  let groundMesh: Mesh | null = null;
  const groundMat = (cells: number) => groundMaterial({
    field, colours, mapW: walk.worldWidth, mapD: walk.worldDepth, paper: PAPER, haze: HAZE,
    hazeRange: [900, 7000], reach, cells, flat: pads,
  });
  const buildGround = (q: Quality) => {
    if (groundMesh) {
      scene.remove(groundMesh);
      groundMesh.geometry.dispose();
      (groundMesh.material as ShaderMaterial).dispose();
    }
    groundMesh = new Mesh(groundGeometry(GRID[q]), groundMat(GRID[q]));
    groundMesh.frustumCulled = false; // it moves with you; the shader places it
    scene.add(groundMesh);
  };
  buildGround(o.quality);

  // Water.
  const waterMat = new MeshBasicMaterial({ color: new Color("#6b97a8"), transparent: true, opacity: 0.9, side: DoubleSide });
  const waterGeos = walk.water.map((lake) => {
    const g = new ShapeGeometry(new Shape(lake.points.map(([x, z]) => new Vector2(x, -z))));
    g.rotateX(-Math.PI / 2);
    const m = new Mesh(g, waterMat);
    m.position.y = lake.level;
    scene.add(m);
    return g;
  });

  // Boulders at their real size, and in the way.
  const blockers = new Blockers();
  const rock = new IcosahedronGeometry(0.5, 1);
  const rp = rock.attributes.position;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < rp.count; i++) {
    const k = 0.78 + 0.44 * rnd();
    rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k, rp.getZ(i) * k);
  }
  rock.computeVertexNormals();
  const rockMat = new MeshLambertMaterial({ color: new Color("#8f7f69"), flatShading: true });
  const stones = new InstancedMesh(rock, rockMat, worldJson.boulders.length);
  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), p = new Vector3(), s = new Vector3();
  worldJson.boulders.forEach(([x, , z, size, rot], i) => {
    q.setFromEuler(e.set(0, rot, 0));
    const y = ground(x, z);
    stones.setMatrixAt(i, m4.compose(p.set(x, y + size * 0.18, z), q, s.set(size, size * 0.7, size)));
    blockers.add(x, z, size * 0.45);
  });
  stones.computeBoundingSphere();
  scene.add(stones);

  // The painted cut-outs: buildings where the painting draws them, trees where it is green.
  o.onProgress(0.85, "Planting the trees");
  const spriteIndex = new Map(atlas.sprites.map((s, i) => [s.id, i]));
  const painted = worldJson.buildings.filter((b) => !b.model); // a modelled building stands as its model
  const stands: Stand[] = painted.map((b) => ({ x: b.x, y: terrain(b.x, b.z), z: b.z, height: b.height, sprite: spriteIndex.get(b.sprite)! }));
  for (const b of painted) blockers.add(b.x, b.z, b.r);
  const woods = new Blockers(24); // the trees alone, for how wooded it sounds
  for (const t of await decodeTrees(treeBuf)) {
    stands.push({ x: t.x, y: ground(t.x, t.z), z: t.z, height: t.height, sprite: t.sprite });
    blockers.add(t.x, t.z, 0.35);
    woods.add(t.x, t.z, 0.35);
  }
  let cutouts: Mesh | null = null;
  const buildCutouts = (q: Quality) => {
    if (cutouts) { scene.remove(cutouts); cutouts.geometry.dispose(); (cutouts.material as ShaderMaterial).dispose(); }
    cutouts = cutoutMesh(stands, atlas, cutTex, HAZE, [900, 7000], DRAW[q]);
    scene.add(cutouts);
  };
  buildCutouts(o.quality);
  // The lodge (design §10.3): small enough (about 400 KB) to load with the valley.
  o.onProgress(0.92, "Opening the lodge");
  lodge = await loadLodge({
    url: walkAsset(walk.lodge.file), at: { x: walk.lodge.x, y: walk.lodge.y, z: walk.lodge.z },
    half: lodgeInfo.half, court: 8, markers: lodgeInfo.markers as Marker[],
  }, scene);
  // The temple site (Chapter 9): about 200 KB, loaded with the lodge. Indoors is the tent.
  for (const st of walk.sites ?? []) {
    sites.set(st.id, await loadLodge({
      url: walkAsset(st.file), at: { x: st.x, y: st.y, z: st.z },
      half: siteInfo.tent[2], court: 0, markers: siteInfo.markers as Marker[],
    }, scene));
  }
  const ambient = new AmbientLight(0xffffff, 1.3);
  scene.add(ambient);
  const sun = new DirectionalLight(0xfff1d6, 2.0);
  sun.position.copy(SUN_DIR).multiplyScalar(9000);
  scene.add(sun);

  const halfW = walk.worldWidth / 2 - 3, halfD = walk.worldDepth / 2 - 3;
  const blocked = (x: number, z: number, r: number) =>
    Math.abs(x) > halfW || Math.abs(z) > halfD ||
    walk.water.some((lake) => inside(lake.points, x, z)) ||
    blockers.hits(x, z, r) ||
    models().some((m) => m.hits(x, z, Number.isFinite(feet) ? feet : ground(x, z), r));

  const input = new Input(o.canvas);
  const rules = walk.player;
  let player: Player = {
    x: walk.spawn.x, z: walk.spawn.z, y: 0, heading: (walk.spawn.heading * Math.PI) / 180, pitch: -0.05,
  };
  const world = { ground, blocked, built };
  // Indoors it is darker, lit from the windows and the courtyard, and the haze stands off.
  let indoor = 0;
  const lightFor = (dt: number) => {
    const target = indoorsAt(player.x, player.z) ? 1 : 0;
    indoor += (target - indoor) * Math.min(1, dt * 3);
    ambient.intensity = 1.3 - 0.65 * indoor;
    sun.intensity = 2.0 - 1.4 * indoor;
  };
  // Story mode's hold on the body (design §10.4).
  let hold: "free" | "look" | "none" = "free";
  let eye = rules.eye, speed = 1, sway = 0, roll = 0, swayT = 0;
  let route: { pts: [number, number][]; done: () => void } | null = null;
  let rate = 1;
  const release = () => {
    for (let k = 0; tween && k < 3; k++) { const d = tween.done; tween = null; d(); } // a glance has two halves
    if (route) { const d = route.done; route = null; d(); }
  };
  let tween: { t: number; dur: number; from: { x: number; z: number; eye: number; heading: number; pitch: number; roll: number };
               to: { x: number; z: number; eye: number; heading: number; pitch: number; roll: number }; done: () => void } | null = null;
  const moveBy = (m: ReturnType<Input["sample"]>) => {
    if (hold !== "free") { m.forward = 0; m.strafe = 0; m.run = false; }
    if (hold === "none" || tween || route) { m.turn = 0; m.look = 0; }
    const r = { ...rules, eye, walk: rules.walk * speed, run: rules.run * speed };
    if (tween) {
      tween.t = Math.min(tween.dur, tween.t + STEP * rate);
      const k = tween.dur > 0 ? tween.t / tween.dur : 1;
      const e = k * k * (3 - 2 * k);
      const L = (a: number, b: number) => a + (b - a) * e;
      player = { ...player, x: L(tween.from.x, tween.to.x), z: L(tween.from.z, tween.to.z), heading: L(tween.from.heading, tween.to.heading), pitch: L(tween.from.pitch, tween.to.pitch) };
      eye = L(tween.from.eye, tween.to.eye);
      roll = L(tween.from.roll, tween.to.roll);
      if (k >= 1) { const d = tween.done; tween = null; d(); }
    } else if (route) {
      // walking by himself: turn toward the next corner, and go
      const [tx, tz] = route.pts[0];
      const dx = tx - player.x, dz = tz - player.z, d = Math.hypot(dx, dz);
      const dh = Math.atan2(Math.sin(Math.atan2(dx, -dz) - player.heading), Math.cos(Math.atan2(dx, -dz) - player.heading));
      const go = rules.walk * speed * STEP * rate * (Math.abs(dh) > 1.0 ? 0.25 : 1);
      const heading = player.heading + Math.sign(dh) * Math.min(Math.abs(dh), 3 * STEP * rate);
      const pitch = player.pitch + (-0.08 - player.pitch) * Math.min(1, 3 * STEP * rate);
      if (d <= go) {
        player = { ...player, x: tx, z: tz, heading, pitch };
        route.pts.shift();
        if (!route.pts.length) { const r = route; route = null; r.done(); }
      } else player = { ...player, x: player.x + (dx / d) * go, z: player.z + (dz / d) * go, heading, pitch };
      if (speed < 1) swayT += go * 3.2;
    }
    player = step(player, m, STEP, { ...r, eye }, world);
    if (speed < 1) {
      swayT += Math.hypot(m.forward, m.strafe) * STEP * 3.2;
    }
    feet = player.y - eye; // his own eye height: lying, sitting or standing
  };

  const resize = () => {
    const w = o.canvas.clientWidth, hh = o.canvas.clientHeight;
    if (!w || !hh) return;
    renderer.setSize(w, hh, false);
    composer?.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
  };
  renderer.setPixelRatio(Math.min(devicePixelRatio, PIXELS[o.quality]));
  let composer: EffectComposer | null = null;
  const sight = new SightEffect();
  const setInk = (q: Quality) => {
    composer?.dispose();
    // story mode always runs the sight pass; the ink comes with medium and high quality
    composer = q === "low" && !o.story ? null : inkComposer(renderer, scene, camera, o.story ? [sight] : [], q !== "low");
  };
  setInk(o.quality);
  const draw = () => (composer ? composer.render() : renderer.render(scene, camera));
  const ro = new ResizeObserver(resize);
  ro.observe(o.canvas);
  resize();

  const place = () => {
    camera.position.set(player.x, player.y, player.z);
    camera.rotation.set(player.pitch, -player.heading, roll + sway * Math.sin(swayT) * 0.045);
    sky.position.copy(camera.position);
    const mat = groundMesh!.material as ShaderMaterial;
    // snap the grid's centre to its own spacing near you, so the land doesn't swim
    (mat.uniforms.center.value as Vector2).set(Math.round(player.x / 2) * 2, Math.round(player.z / 2) * 2);
  };

  // Sound starts with the click that starts walking (browsers insist).
  let sounds: Sounds | null = null;
  let volume = o.volume;
  let stride = 0;
  const lakeDistance = (x: number, z: number) =>
    Math.min(...walk.water.map((l) => (inside(l.points, x, z) ? 0 : Math.min(...l.points.map(([px, pz]) => Math.hypot(px - x, pz - z))))));
  const surface = (x: number, z: number): Surface => {
    const steep = Math.hypot(ground(x + 1, z) - ground(x - 1, z), ground(x, z + 1) - ground(x, z - 1)) / 2;
    if (steep > 0.6) return "rock";
    return woods.count(x, z, 20) > 3 ? "grass" : "earth";
  };

  let raf = 0, running = false, last = 0, acc = 0, statsAt = 0;
  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      const move = input.sample();
      const before = player;
      moveBy(move);
      acc -= STEP;
      stride += Math.hypot(player.x - before.x, player.z - before.z);
      if (stride > (move.run ? 1.7 : 0.85)) {
        stride = 0;
        sounds?.step(surface(player.x, player.z), move.run);
      }
    }
    for (const m of models()) m.update(1 / 60);
    lightFor(1 / 60); // (the sight pass eases itself, each time the composer renders)
    place();
    draw();
    o.onFrame?.(player.x, player.z, player.heading);
    if (now - statsAt > 200) {
      statsAt = now;
      const inside = indoorsAt(player.x, player.z);
      sounds?.hear({ indoors: inside, height: inside ? 0 : player.y - rules.eye, trees: inside ? 0 : Math.min(1, woods.count(player.x, player.z, 35) / 14), water: lakeDistance(player.x, player.z) });
      o.onStats?.({ x: player.x, z: player.z, heading: player.heading, ground: ground(player.x, player.z), indoors: inside,
        door: lodge?.doorNear(player.x, player.z) ?? null,
        look: models().map((m) => m.lookNear(player.x, player.z)).find((l) => l) ?? null });
    }
    raf = requestAnimationFrame(frame);
  };

  // first frame, so the canvas shows the valley behind the "click to start" card
  moveBy(input.sample());
  place();
  draw();
  o.onFrame?.(player.x, player.z, player.heading); // so the compass and map are right before you start
  o.onProgress(1, "Ready");

  const POSE_EYE = { lie: 0.75, sit: 1.05, "sit-low": 0.85, stand: rules.eye, floor: 0.3 } as const;
  const body: Body = {
    sight,
    pose: ({ pose, at, look, seconds = 0 }) => new Promise<void>((done) => {
      const x = at ? at[0] : player.x, z = at ? at[1] : player.z;
      let heading = player.heading, pitch = 0;
      if (look === "up") pitch = 1.4;
      else if (look) {
        heading = Math.atan2(look[0] - x, -(look[2] - z));
        const flat = Math.hypot(look[0] - x, look[2] - z);
        pitch = Math.atan2(look[1] - (ground(x, z) + POSE_EYE[pose]), Math.max(flat, 0.01));
      }
      release();
      if (seconds <= 0) {
        player = { ...player, x, z, heading, pitch, y: 0 };
        eye = POSE_EYE[pose];
        roll = pose === "floor" ? 0.5 : 0;
        feet = Infinity;
        moveBy({ forward: 0, strafe: 0, run: false, turn: 0, look: 0 });
        done();
        return;
      }
      tween = { t: 0, dur: seconds, from: { x: player.x, z: player.z, eye, heading: player.heading, pitch: player.pitch, roll },
                to: { x, z, eye: POSE_EYE[pose], heading, pitch, roll: pose === "floor" ? 0.5 : 0 }, done };
    }),
    hold: (h) => { hold = h; },
    injured: (on) => { speed = on ? 0.45 : 1; sway = on ? 1 : 0; },
    glance: (pitch, seconds) => new Promise<void>((done) => {
      release();
      const back = player.pitch;
      tween = { t: 0, dur: seconds / 2, from: { x: player.x, z: player.z, eye, heading: player.heading, pitch: back, roll },
                to: { x: player.x, z: player.z, eye, heading: player.heading, pitch, roll }, done: () => {
        tween = { t: 0, dur: seconds / 2, from: { x: player.x, z: player.z, eye, heading: player.heading, pitch, roll },
                  to: { x: player.x, z: player.z, eye, heading: player.heading, pitch: back, roll }, done };
      } };
    }),
    faint: (seconds) => new Promise<void>((done) => {
      release();
      sight.set({ dark: 1, blur: 0.8 }, seconds);
      tween = { t: 0, dur: seconds, from: { x: player.x, z: player.z, eye, heading: player.heading, pitch: player.pitch, roll },
                to: { x: player.x, z: player.z, eye: 0.3, heading: player.heading, pitch: -0.3, roll: 1.1 }, done };
    }),
    lookingAt: (p, degrees) => {
      const dx = p[0] - camera.position.x, dy = p[1] - camera.position.y, dz = p[2] - camera.position.z;
      const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const len = Math.hypot(dx, dy, dz) || 1;
      return (fwd.x * dx + fwd.y * dy + fwd.z * dz) / len > Math.cos((degrees * Math.PI) / 180);
    },
    face: (p) => {
      const c = camera.position;
      player = { ...player, heading: Math.atan2(p[0] - c.x, -(p[2] - c.z)), pitch: Math.atan2(p[1] - c.y, Math.max(Math.hypot(p[0] - c.x, p[2] - c.z), 0.01)) };
      camera.rotation.set(player.pitch, -player.heading, roll);
      camera.updateMatrixWorld();
    },
    turnTo: (p, seconds) => new Promise<void>((done) => {
      release();
      const c = camera.position;
      const want = Math.atan2(p[0] - c.x, -(p[2] - c.z));
      const heading = player.heading + Math.atan2(Math.sin(want - player.heading), Math.cos(want - player.heading));
      const pitch = Math.atan2(p[1] - c.y, Math.max(Math.hypot(p[0] - c.x, p[2] - c.z), 0.01));
      tween = { t: 0, dur: seconds, from: { x: player.x, z: player.z, eye, heading: player.heading, pitch: player.pitch, roll },
                to: { x: player.x, z: player.z, eye, heading, pitch, roll }, done };
    }),
    walkTo: (at) => new Promise<void>((done) => {
      release();
      route = { pts: findRoute([player.x, player.z], at, (x, z) => blocked(x, z, 0.32)), done };
    }),
    halt: release,
    rate: (r) => { rate = r; sight.speed = r; },
    fromLodge: (x, y, z) => [x + walk.lodge.x, y + walk.lodge.y, z + walk.lodge.z],
    lodgeRoot: () => lodge?.root ?? null,
    fromSite: (id, x, y, z) => {
      const st = (walk.sites ?? []).find((k) => k.id === id);
      return st ? [x + st.x, y + st.y, z + st.z] : [x, y, z];
    },
    siteRoot: (id) => sites.get(id)?.root ?? null,
    fx: (name) => sounds?.fx(name),
  };

  return {
    start: () => {
      if (!sounds) sounds = new Sounds(volume);
      else sounds.resume();
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    pause: () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      input.clear();
      sounds?.pause();
    },
    input,
    settings: input.settings,
    teleport: (x, z, heading) => {
      player = { ...player, x, z, y: 0, heading: heading ?? player.heading };
      feet = Infinity; // find the floor from above: you may have arrived indoors
      moveBy({ forward: 0, strafe: 0, run: false, turn: 0, look: 0 });
      place();
      draw();
    },
    player: () => player,
    standable: (x, z) => {
      for (let r = 0; r < 600; r += 6) {
        for (let k = 0; k < Math.max(1, r / 3); k++) {
          const a = (k / Math.max(1, r / 3)) * Math.PI * 2;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (!blocked(px, pz, rules.radius + 1)) return [px, pz];
        }
      }
      return [x, z];
    },
    ground,
    body,
    soundState: () => sounds?.state ?? "off",
    useDoor: () => {
      const d = lodge?.doorNear(player.x, player.z);
      if (!d) return false;
      lodge!.toggleDoor(d.name);
      return true;
    },
    patchVisible: () => lodge?.patchVisible() ?? false,
    showPatch: (on) => {
      lodge?.showPatch(on);
      draw();
    },
    lodgePoint: (name) => {
      const m = (lodgeInfo.markers as Marker[]).find((k) => k.name === name);
      return m ? [m.at[0] + walk.lodge.x, m.at[1] + walk.lodge.y, m.at[2] + walk.lodge.z] : null;
    },
    setVolume: (v) => {
      volume = v;
      sounds?.setVolume(v);
    },
    setQuality: (qq) => {
      renderer.setPixelRatio(Math.min(devicePixelRatio, PIXELS[qq]));
      buildGround(qq);
      buildCutouts(qq);
      setInk(qq);
      resize();
      place();
      draw();
    },
    dispose: () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      sounds?.dispose();
      ro.disconnect();
      input.dispose();
      groundMesh?.geometry.dispose();
      (groundMesh?.material as ShaderMaterial | undefined)?.dispose();
      for (const g of [rock, ...waterGeos]) g.dispose();
      for (const m of [rockMat, waterMat, sky.material as ShaderMaterial]) m.dispose();
      sky.geometry.dispose();
      stones.dispose();
      colours.dispose();
      lodge?.dispose();
      for (const m of sites.values()) m.dispose();
      cutTex.dispose();
      cutouts?.geometry.dispose();
      (cutouts?.material as ShaderMaterial | undefined)?.dispose();
      composer?.dispose();
      renderer.dispose();
    },
  };
}
