// Walking the valley (design §10.2): the game itself. Loaded only when a
// reader presses "Enter the valley" on /valley/walk/, so the page's first load
// is just its start screen.
//
// A fixed 60 Hz step moves the player; every animation frame draws. Nothing
// runs while paused.
import {
  BackSide, Color, DirectionalLight, DoubleSide, Euler, Fog, HemisphereLight, IcosahedronGeometry,
  InstancedMesh, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PCFShadowMap, VSMShadowMap, PerspectiveCamera,
  PMREMGenerator, Quaternion,
  Scene, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, Texture, TextureLoader,
  NoColorSpace, RepeatWrapping, Vector2, Vector3, WebGLRenderer, type Material,
  AdditiveBlending, PlaneGeometry, Raycaster, type Object3D,
} from "three";

/** The layer Dvij's own body is drawn on: seen only in a reflection, never by his eyes (the author, 21 Oct). */
export const SELF_LAYER = 1;
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { decodeHeights, fieldFor, heightAt, setFlat, type Field } from "./heights";
import { loadLodge, type Look, type Lodge, type Marker } from "./lodge";
import lodgeInfo from "../../content/generated/lodge.json";
import siteInfo from "../../content/generated/temple-site.json";
import { groundGeometry, groundMaterial, type Detail } from "./ground";
import groundDetail from "../../content/generated/ground-detail.json";
import { applyWear } from "./wear";
import { lodgeFx } from "./lodge-fx";
import { openFire } from "./fire-fx";
import { Arms } from "./arms";
import { makePane, type Pane } from "./pane";
import { lawnGrass } from "./grass";
import armsInfo from "../../content/generated/arms.json";
import { inkComposer } from "./post";
import { ultra, ultraHas, ultraLook, ULTRA_SCENES, WAKE_WINDOW, type UltraLook } from "./ultra";
import { SightEffect } from "../story/effects";
import { findRoute } from "../story/route";
import { cutoutMesh, decodeTrees, type Stand } from "./cutouts";
import { trees3d } from "./trees3d";
import type { EffectComposer } from "postprocessing";
import { Input, type Settings } from "./input";
import { Blockers, inside, step, type Player } from "./player";
import { atlas, walk, walkAsset, type Building } from "./walk-data";
import { Sounds, type Surface } from "./audio";

export type Quality = "low" | "medium" | "high" | "ultra";
export type GameOptions = {
  canvas: HTMLCanvasElement;
  heightUrl: string;
  worldUrl: string;
  groundUrl: string;
  quality: Quality;
  volume: number;
  /** Story mode (design §10.4): the director drives the body and the eyes. */
  story?: boolean;
  /** Render a little smaller when frames run slow, and back up when they're quick (default on; off for tests, so
   * shots and timings are at a known size). */
  adaptive?: boolean;
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
  /** What the last frame drew: draw calls and triangles over all its passes (for measuring). */
  renderInfo: () => { calls: number; triangles: number; textures: number; programs: number };
  /** For measuring, from tests only: the renderer, the scene, and the picture's passes off or on. */
  internals: () => { renderer: WebGLRenderer; scene: Scene; composerOn: (on: boolean) => void };
  /** Triangles per top-level thing in the scene (for measuring). */
  sceneStats: () => Record<string, number>;
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
  /** Keep his eyes on this point while nothing else moves them, following it as it goes (watch mode: whoever speaks,
   * walking round the well, walking off); null, or a null from it, lets go. */
  follow: (p: (() => [number, number, number] | null) | null) => void;
  /** Walk there by himself, round the walls (watch mode). */
  walkTo: (at: [number, number]) => Promise<void>;
  /** Every door shut, or open (a scene's setting: in Ch1 he opens each one he goes through). */
  doors: (open: boolean) => void;
  /** Stop whatever he was moving through: a new scene is starting. */
  halt: () => void;
  /** How fast the story's time runs: 0.5 slow motion, 1, 2 or 4 fast forward. */
  rate: (r: number) => void;
  /** The lodge's frame -> the world's. */
  fromLodge: (x: number, y: number, z: number) => [number, number, number];
  lodgeRoot: () => import("three").Object3D | null;
  /** The chapter now playing (its scene's id): Ultra dresses Chapter 1 only (ultra.ts). */
  chapter: (id: string) => void;
  /** A reflection in the window pane he is looking at, of his own body only (on SELF_LAYER), laid over the
   * glass as daylight lets one show (novel ¶101); false: none. Returns whether there was a pane to look in. */
  mirror: (on: boolean) => boolean;
  /** The pane met looking from `from` towards `toward` (world), made dirty, with his reflection in it at a strength
   * the story sets as he comes to it (walk/pane.ts); null if there's no glass there. */
  pane: (from: [number, number, number], toward: [number, number, number]) => Pane | null;
  /** Something that casts a shadow moved (one of the story's people walking): the shadows are drawn again. */
  stir: () => void;
  /** Dvij's own arms (arms.ts), if they loaded. */
  arms: () => Arms | null;
  /** Another built place's frame -> the world's, and its model: "temple-site" (Chapter 9). */
  fromSite: (id: string, x: number, y: number, z: number) => [number, number, number];
  siteRoot: (id: string) => import("three").Object3D | null;
  fx: (name: string) => void;
  /** The height of whatever lies under (x, z) at or below y (world metres): a floor, a bed, the land. */
  surface: (x: number, y: number, z: number) => number;
  /** Call this every step of the story's time (seconds, slowed or sped with it); returns a way to stop. */
  every: (f: (dt: number) => void) => () => void;
  /** Switch a room's ceiling fan on (turns a second) or off (0). */
  fan: (room: string, speed: number) => void;
  /** A scene's time of day and the state of the lodge: where the sun stands ("morning", "midday",
   * "afternoon", "evening"), the courtyard's fibreglass curtain drawn over its bars or torn open. */
  setting: (s: { sun?: string; court?: "covered" | "open" }) => void;
  /** Someone else's film (story/pov-stage.ts): `rig` places the camera each frame, away from his eyes,
   * and his arms are hidden; null gives the camera back to him. */
  film: (rig: ((camera: PerspectiveCamera) => void) | null) => void;
};

// Colours are written as the eye sees them (sRGB); Color() turns them into the
// linear light the shaders work in.
const lin = (hex: string) => { const c = new Color(hex); return new Vector3(c.r, c.g, c.b); };
const SKY_TOP = lin("#7f9fb4");
export const HAZE = lin("#e2d3b4"); // the sky at the horizon and the far haze are one colour
export const PAPER = lin("#c9a878");
const SUN_DIR = new Vector3(0.85, 0.42, -0.2).normalize();
const GRID: Record<Quality, number> = { low: 192, medium: 288, high: 384, ultra: 384 };
const PIXELS: Record<Quality, number> = { low: 1, medium: 1.5, high: 2, ultra: 2 };
const DRAW: Record<Quality, [number, number]> = { low: [450, 700], medium: [1100, 1600], high: [2000, 2800], ultra: [2000, 2800] };
const STEP = 1 / 60;
const HEMI = 1.3; // the sky's light all round (dimmed indoors)
const ENV = 0.12; // how much the lodge's materials reflect their surroundings (dimmed indoors)
const SUN = 2.0;
// The sun's shadows (medium and high): a square this many metres each way of
// where you look, in a map this many texels across.
const SHADOW_REACH = 32;
const SHADOW_MAP: Record<Quality, number> = { low: 0, medium: 1024, high: 2048, ultra: 2048 };
/** How far off the boulders are drawn (m): further, they are specks on the painted ground, and 7,000 of them valley-wide
 * were half a million triangles a frame. */
/** The picture's buffers: multisampling (the antialias) and half-float colour, by quality: the most a frame spends
 * on this GPU after the scene itself. */
/** The comic's ink lines (a full-screen pass over the picture and its depth): on high only, where there is the
 * margin for them on this GPU. */
const INK: Record<Quality, boolean> = { low: false, medium: false, high: true, ultra: true };
const COMPOSER: Record<Quality, { samples: number; half: boolean }> = { low: { samples: 0, half: false }, medium: { samples: 2, half: false }, high: { samples: 2, half: false }, ultra: { samples: 2, half: false } };
/** How far round you the trees stand in the round (m; trees3d.ts), past it the painting's cut-outs: none on low. */
const TREES_NEAR: Record<Quality, number> = { low: 0, medium: 70, high: 110, ultra: 110 };
const STONES_NEAR: Record<Quality, number> = { low: 150, medium: 300, high: 500, ultra: 500 };
const AO = 0.7; // how much the lodge's baked occlusion darkens the sky's light and reflections (1 makes its tightest corners black)

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

/** Where the sun stands at each time of day a scene can ask for (towards it: x east, y up, z south),
 * and its colour then. The default is the walk's own morning. */
const SUNS: Record<string, { dir: [number, number, number]; colour: string; strength: number }> = {
  morning: { dir: [0.85, 0.42, -0.2], colour: "#fff1d6", strength: 2.0 },
  "mid-morning": { dir: [0.62, 0.72, -0.05], colour: "#fff4e0", strength: 2.2 }, // (Ch 2: already hot, the sun climbing)
  midday: { dir: [0.25, 0.94, 0.22], colour: "#fff6e8", strength: 2.4 },
  afternoon: { dir: [-0.6, 0.55, 0.58], colour: "#ffefcf", strength: 2.2 },
  evening: { dir: [-0.85, 0.22, 0.45], colour: "#ffc98f", strength: 1.6 },
};

function skyDome(SUN_DIR: Vector3): Mesh {
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
  let mirror: Reflector | null = null;
  const mirrorLight = new DirectionalLight(0xfff0dc, 2.4);
  mirrorLight.layers.set(SELF_LAYER);
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
  renderer.shadowMap.type = PCFShadowMap; // (three's soft PCF; PCFSoftShadowMap is gone)
  renderer.shadowMap.autoUpdate = false; // drawn again only when something in it changes (shadowDirty)
  let shadowDirty = true;
  const sharp = renderer.capabilities.getMaxAnisotropy();
  const scene = new Scene();
  // Something soft for the lodge's walls and floors to reflect.
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = envMap.texture;
  scene.environmentIntensity = ENV;
  scene.fog = new Fog(new Color(HAZE.x, HAZE.y, HAZE.z), 900, 7000);
  // near 12 cm, for Dvij's own hands close in front of him (arms.ts); the ink pass reads distances
  // back from the 24-bit depth buffer, which still tells them apart to about 2 m at 2 km, finer
  // than the ink's test (a tenth of the distance) needs
  const camera = new PerspectiveCamera(70, 1, 0.12, 12000);
  camera.rotation.order = "YXZ";
  const sunDir = SUN_DIR.clone(); // (moved by Body.setting, for a scene's time of day)
  const sky = skyDome(sunDir);
  scene.add(sky);

  // The land.
  const reach = 8000;
  let groundMesh: Mesh | null = null;
  // the photo-scanned close-up ground, if the walk has it (pipeline/lodge_photos.py)
  const listed = groundDetail as Partial<Record<"earth" | "grass" | "rock", { color: string; normal: string; metres: number }>>;
  let detail: { earth: Detail; grass: Detail; rock: Detail } | undefined;
  if (listed.earth && listed.grass && listed.rock) {
    const pair = async (d: { color: string; normal: string; metres: number }): Promise<Detail> => {
      const [color, normal] = await Promise.all([loadTexture(walkAsset(d.color)), loadTexture(walkAsset(d.normal))]);
      color.colorSpace = SRGBColorSpace;
      normal.colorSpace = NoColorSpace;
      for (const t of [color, normal]) { t.wrapS = t.wrapT = RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; }
      return { color, normal, metres: d.metres };
    };
    const [earth, grass, rock] = await Promise.all([pair(listed.earth), pair(listed.grass), pair(listed.rock)]);
    detail = { earth, grass, rock };
  }
  const groundMat = (cells: number) => groundMaterial({
    field, colours, mapW: walk.worldWidth, mapD: walk.worldDepth, paper: PAPER, haze: HAZE,
    hazeRange: [900, 7000], reach, cells, flat: pads, detail, sun: sunDir,
  });
  const buildGround = (q: Quality) => {
    if (groundMesh) {
      scene.remove(groundMesh);
      groundMesh.geometry.dispose();
      (groundMesh.material as ShaderMaterial).dispose();
    }
    groundMesh = new Mesh(groundGeometry(GRID[q]), groundMat(GRID[q]));
    groundMesh.frustumCulled = false; // it moves with you; the shader places it
    groundMesh.receiveShadow = true; // (it can't cast: the shadow pass wouldn't raise the grid into hills)
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
  stones.receiveShadow = true;
  scene.add(stones);
  // Only the boulders near the sun's shadow square cast: a small copy of them that
  // draws nothing itself (all of them, valley-wide, cost more than the rest of the shadow).
  const NEAR_STONES = 400;
  const castMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const casters = new InstancedMesh(rock, castMat, NEAR_STONES);
  casters.count = 0;
  casters.castShadow = true;
  casters.frustumCulled = false;
  scene.add(casters);
  const stoneAt = worldJson.boulders.map((_, i) => { stones.getMatrixAt(i, m4); return m4.clone(); });
  // only the boulders near him are drawn, the set refreshed as he moves on (a few times across its reach)
  let stoneRange = STONES_NEAR[o.quality];
  const stoneCentre = new Vector3(1e9, 0, 1e9);
  const showNear = (x: number, z: number, force = false) => {
    if (!force && Math.hypot(x - stoneCentre.x, z - stoneCentre.z) < stoneRange * 0.15) return;
    stoneCentre.set(x, 0, z);
    let n = 0;
    const r2 = stoneRange * stoneRange;
    worldJson.boulders.forEach(([bx, , bz], i) => {
      if ((bx - x) ** 2 + (bz - z) ** 2 < r2) stones.setMatrixAt(n++, stoneAt[i]);
    });
    stones.count = n;
    stones.instanceMatrix.needsUpdate = true;
    stones.computeBoundingSphere();
  };
  const castNear = (x: number, z: number) => {
    let n = 0;
    worldJson.boulders.forEach(([bx, , bz], i) => {
      if (n < NEAR_STONES && Math.abs(bx - x) < SHADOW_REACH * 1.6 && Math.abs(bz - z) < SHADOW_REACH * 1.6) casters.setMatrixAt(n++, stoneAt[i]);
    });
    casters.count = n;
    casters.instanceMatrix.needsUpdate = true;
  };

  // The painted cut-outs: buildings where the painting draws them, trees where it is green.
  o.onProgress(0.85, "Planting the trees");
  const spriteIndex = new Map(atlas.sprites.map((s, i) => [s.id, i]));
  const painted = worldJson.buildings.filter((b) => !b.model); // a modelled building stands as its model
  const stands: Stand[] = painted.map((b) => ({ x: b.x, y: terrain(b.x, b.z), z: b.z, height: b.height, sprite: spriteIndex.get(b.sprite)! }));
  for (const b of painted) blockers.add(b.x, b.z, b.r);
  const woods = new Blockers(24); // the trees alone, for how wooded it sounds
  for (const t of await decodeTrees(treeBuf)) {
    stands.push({ x: t.x, y: ground(t.x, t.z), z: t.z, height: t.height, sprite: t.sprite, tree: true });
    blockers.add(t.x, t.z, 0.35);
    woods.add(t.x, t.z, 0.35);
  }
  let cutouts: Mesh | null = null;
  const buildCutouts = (q: Quality) => {
    if (cutouts) { scene.remove(cutouts); cutouts.geometry.dispose(); (cutouts.material as ShaderMaterial).dispose(); }
    cutouts = cutoutMesh(stands, atlas, cutTex, HAZE, [900, 7000], DRAW[q]);
    (cutouts.material as ShaderMaterial).uniforms.near.value = TREES_NEAR[q];
    scene.add(cutouts);
    round?.setReach(TREES_NEAR[q]);
  };
  // the trees near you in the round (trees3d.ts): the painting's own trees, where it has them
  const round = trees3d(scene, stands.filter((s) => s.tree));
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
  // the altar's fire, burning (novel ¶320)
  const altar = (siteInfo.markers as Marker[]).find((m) => m.name === "look:altar");
  const fires = altar ? [...sites.values()].map((s) => openFire(s.root, [altar.at[0], 0.35, altar.at[2]])) : [];
  // keep the lodge's textures sharp seen along a wall or a floor; its roof, walls and
  // furniture cast the sun's shadows and take them, and its baked occlusion (on its own
  // UV set) darkens the sky's light in its corners
  for (const model of [lodge, ...sites.values()]) model.root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    // (the windows' glass lets the sun through)
    mesh.castShadow = !mesh.userData.noShadow && !/^window-glass/.test(mesh.name);
    mesh.receiveShadow = true;
    for (const mat of ([] as Material[]).concat(mesh.material)) {
      for (const [k, v] of Object.entries(mat)) {
        // full sharpness for the colours; relief and roughness don't show it, and cost
        if (v instanceof Texture) { v.anisotropy = k === "map" ? sharp : Math.min(4, sharp); v.needsUpdate = true; }
      }
      if (mat instanceof MeshStandardMaterial && mat.aoMap) {
        mat.aoMapIntensity = AO;
        // the atlas packs thousands of small islands a few texels apart: its smaller mips
        // would blend each with its neighbours (some black), so it is read at full size only
        mat.aoMap.generateMipmaps = false;
        mat.aoMap.minFilter = LinearFilter;
        mat.aoMap.needsUpdate = true;
      }
    }
  });
  // Dvij's own arms, riding on the camera (the camera joins the scene so they're drawn)
  scene.add(camera);
  const arms = (armsInfo as { file?: string }).file ? await Arms.load(walkAsset((armsInfo as { file: string }).file), camera).catch((e) => { console.warn("no arms:", e); return null; }) : null;
  let walking = 0; // 0 still, 1 at a walk: for the arms' bob
  // the kitchen fire's flicker, the dhoop batti's smoke, the dust in the air
  const moving = lodgeFx(lodge.root);
  // the unkempt lawn's dry grass, and the clearing cut in it for the deck chairs (novel ¶249; Ch7's chairs at 9.6, 31.5)
  const grass = lawnGrass(lodge.root, lodgeInfo.grounds as [number, number, number, number], { half: lodgeInfo.half, clearings: [[9.6, 31.5, 3.2]] });
  // its decay: mould, grime, flaking paint, rust (lodge.yaml `character`)
  const wearFile = (lodgeInfo as { wear?: string }).wear;
  if (wearFile) applyWear(lodge.root, await loadTexture(walkAsset(wearFile)), lodge.root.position);
  for (const t of [colours, cutTex]) { t.anisotropy = sharp; t.needsUpdate = true; } // and the land, seen low and far
  // pale sky from above, the warm brown of the dry ground from below
  const ambient = new HemisphereLight(0xdde8f0, 0x8a6a48, HEMI);
  scene.add(ambient);
  const sun = new DirectionalLight(0xfff1d6, SUN);
  sun.position.copy(sunDir).multiplyScalar(9000);
  scene.add(sun, sun.target);
  const shade = sun.shadow.camera;
  shade.left = shade.bottom = -SHADOW_REACH;
  shade.right = shade.top = SHADOW_REACH;
  shade.near = 1;
  shade.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 1.5;
  /** The chapter playing (story mode), for Ultra: its look is Chapter 1's only (ultra.ts). */
  let chapter = "";
  let quality = o.quality;
  const ultraNow = () => quality === "ultra" && ULTRA_SCENES.has(chapter);
  const setShadows = (q: Quality) => {
    const size = SHADOW_MAP[q];
    // soft shadows under Ultra: variance maps, blurred (their edges widen with distance, as a real sun's do); the
    // ceiling fans cast theirs too, the map drawn again each frame while one turns
    const soft = ultraNow() && ultraHas("soft");
    if ((renderer.shadowMap.type === VSMShadowMap) !== soft) { renderer.shadowMap.type = soft ? VSMShadowMap : PCFShadowMap; sun.shadow.map?.dispose(); sun.shadow.map = null; }
    sun.shadow.radius = soft ? 7 : 1;
    sun.shadow.blurSamples = soft ? 16 : 8;
    for (const m of models()) for (const f of m.fanBodies?.() ?? []) f.traverse((o) => { if ((o as Mesh).isMesh) o.castShadow = soft && ultraHas("fan"); });
    sun.castShadow = size > 0;
    renderer.shadowMap.enabled = size > 0;
    if (!size || sun.shadow.mapSize.x !== size) {
      if (size) sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null; // made again at the new size (on low, not at all)
    }
    shadowDirty = true;
    // the shaders are built with or without shadows: build them again
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) for (const m of ([] as Material[]).concat(mesh.material)) m.needsUpdate = true;
    });
  };
  setShadows(o.quality);
  // The shadow's square follows your eyes, a little ahead of you. It moves in steps of a
  // couple of metres (the map is drawn again only then), each a whole number of its
  // texels, so the edges of shadows don't crawl.
  const sunFrame = new Matrix4().lookAt(sunDir, new Vector3(), new Vector3(0, 1, 0));
  const sunFrameInv = sunFrame.clone().transpose();
  let sunStrength = SUN;
  /** Move the sun to a time of day (SUNS). */
  const setSun = (when: string) => {
    const s = SUNS[when] ?? SUNS.morning;
    sunDir.set(...s.dir).normalize();
    sun.color.set(s.colour);
    sunStrength = s.strength;
    sunFrame.lookAt(sunDir, new Vector3(), new Vector3(0, 1, 0));
    sunFrameInv.copy(sunFrame).transpose();
    shadowDirty = true; // and recentre the shadow's square on the next frame
  };
  const ahead = new Vector3();
  const RECENTRE = 2;
  const followSun = () => {
    if (!sun.castShadow) return;
    const texel = (2 * SHADOW_REACH) / sun.shadow.mapSize.x;
    camera.getWorldDirection(ahead);
    ahead.y = 0;
    ahead.normalize().multiplyScalar(SHADOW_REACH * 0.45).add(camera.position);
    if (!shadowDirty && ahead.distanceTo(sun.target.position) < RECENTRE) return;
    ahead.applyMatrix4(sunFrameInv);
    ahead.x = Math.round(ahead.x / texel) * texel;
    ahead.y = Math.round(ahead.y / texel) * texel;
    ahead.applyMatrix4(sunFrame);
    sun.target.position.copy(ahead);
    sun.position.copy(ahead).addScaledVector(sunDir, 200);
    sun.target.updateMatrixWorld();
    castNear(ahead.x, ahead.z);
    shadowDirty = true;
  };

  const halfW = walk.worldWidth / 2 - 3, halfD = walk.worldDepth / 2 - 3;
  // (`through`: a shut door is no bar, for a way the story walks him: he opens it when he gets there)
  const blocked = (x: number, z: number, r: number, through = false) =>
    Math.abs(x) > halfW || Math.abs(z) > halfD ||
    walk.water.some((lake) => inside(lake.points, x, z)) ||
    blockers.hits(x, z, r) ||
    models().some((m) => m.hits(x, z, Number.isFinite(feet) ? feet : ground(x, z), r, through));
  const routeTo = (to: [number, number]) => findRoute([player.x, player.z], to, (x, z) => blocked(x, z, 0.32, true));
  /** A hand goes out to a door: pushing it open, or pulling it to (comic b1-p004-7 "holding the doorframe"). */
  const reachForDoor = (d: { open: boolean; at: [number, number, number] }) => {
    if (!arms) return;
    const at = arms.toCamera(new Vector3(...d.at));
    at.y = Math.max(-0.25, Math.min(0.0, at.y));
    at.setLength(Math.min(at.length(), 0.55));
    arms.go("l", { at, grip: d.open ? 0.7 : 0.15, show: true }, 0.35);
    setTimeout(() => arms.go("l", { at: Arms.rest("l"), grip: 0.25, show: false }, 0.6), 650);
  };

  const input = new Input(o.canvas);
  const rules = walk.player;
  let player: Player = {
    x: walk.spawn.x, z: walk.spawn.z, y: 0, heading: (walk.spawn.heading * Math.PI) / 180, pitch: -0.05,
  };
  const world = { ground, blocked, built };
  // Indoors it is darker, lit from the windows and the courtyard, and the haze stands off.
  // With shadows the roof keeps the sun out: the sky's light drops and the sun's rises a
  // little, so the patches it throws through the windows and doors read as the room's
  // light. Without shadows the sun itself is dimmed.
  let indoor = 0;
  const lightFor = (dt: number) => {
    const target = indoorsAt(player.x, player.z) ? 1 : 0;
    indoor += (target - indoor) * Math.min(1, dt * 3);
    const shadows = sun.castShadow;
    ambient.intensity = HEMI * (1 - (shadows ? 0.6 : 0.35) * indoor);
    scene.environmentIntensity = ENV * (1 - (shadows ? 0.5 : 0.35) * indoor);
    sun.intensity = sunStrength + (shadows ? 1.0 : -1.4) * indoor;
  };
  // Story mode's hold on the body (design §10.4).
  let hold: "free" | "look" | "none" = "free";
  let eye = rules.eye, speed = 1, sway = 0, roll = 0, swayT = 0;
  // (`opening`: seconds left of opening a door on the way, its middle; the way is found again after, round the open leaf)
  let route: { pts: [number, number][]; done: () => void; to: [number, number]; opening?: { left: number; at: [number, number] } } | null = null;
  let rate = 1;
  let follow: (() => [number, number, number] | null) | null = null;
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
    } else if (route?.opening) {
      // a door in the way, being opened: he turns to it while it swings, then goes on round the open leaf
      const o = route.opening;
      const want = Math.atan2(o.at[0] - player.x, -(o.at[1] - player.z));
      const dh = Math.atan2(Math.sin(want - player.heading), Math.cos(want - player.heading));
      player = { ...player, heading: player.heading + Math.sign(dh) * Math.min(Math.abs(dh), 3 * STEP * rate) };
      o.left -= STEP * rate;
      if (o.left <= 0) { route.opening = undefined; route.pts = routeTo(route.to); if (!route.pts.length) { const r = route; route = null; r.done(); } }
    } else if (route) {
      // a shut door just ahead that the way goes through: stop, reach out, open it (Ch1: he doesn't walk through doors)
      // (on the way: the line to the next corner passes through the doorway; a way pulled straight has no corner in it)
      const door = lodge?.doorNear(player.x, player.z);
      const across = (a: [number, number], b: [number, number], p: [number, number, number]) => {
        const ux = b[0] - a[0], uz = b[1] - a[1], L2 = ux * ux + uz * uz || 1e-9;
        const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * ux + (p[2] - a[1]) * uz) / L2));
        return Math.hypot(a[0] + ux * k - p[0], a[1] + uz * k - p[2]);
      };
      if (door && !door.open && Math.hypot(door.at[0] - player.x, door.at[2] - player.z) < 1.1
          && across([player.x, player.z], route.pts[0], door.at) < 0.7) {
        reachForDoor(door);
        lodge!.toggleDoor(door.name);
        route.opening = { left: 1.0, at: [door.at[0], door.at[2]] };
        return moveBy(m);
      }
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
    } else if (follow && hold === "none") {
      // eyes on a speaker who moves: eased after them, a little behind, as a head turns
      const p = follow();
      if (p) {
        const c = camera.position;
        const want = Math.atan2(p[0] - c.x, -(p[2] - c.z));
        const dh = Math.atan2(Math.sin(want - player.heading), Math.cos(want - player.heading));
        const pitch = Math.atan2(p[1] - c.y, Math.max(Math.hypot(p[0] - c.x, p[2] - c.z), 0.01));
        const k = 1 - Math.exp(-2.5 * STEP * rate);
        player = { ...player, heading: player.heading + dh * k, pitch: player.pitch + (pitch - player.pitch) * k };
      }
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
  // the picture's size: the quality's pixel ratio, scaled down (to 60% at most) while frames run slower than about
  // 31 fps, and back up while they're quicker than 42; checked every 45 frames, a step at a time
  let scale = 1;
  const frameMs: number[] = [];
  const pixelRatio = () => Math.min(devicePixelRatio, PIXELS[quality]) * scale;
  const adapt = (ms: number) => {
    if (o.adaptive === false) return;
    frameMs.push(ms);
    if (frameMs.length < 45) return;
    frameMs.sort((a, b) => a - b);
    const typical = frameMs[Math.floor(frameMs.length * 0.6)];
    frameMs.length = 0;
    const next = typical > 32 ? Math.max(0.6, scale - 0.1) : typical < 24 ? Math.min(1, scale + 0.05) : scale;
    if (Math.abs(next - scale) > 1e-3) {
      scale = next;
      renderer.setPixelRatio(pixelRatio());
      resize();
    }
  };
  renderer.setPixelRatio(pixelRatio());
  let composer: EffectComposer | null = null;
  const sight = new SightEffect();
  let look: UltraLook | null = null;
  const setInk = (q: Quality) => {
    look?.dispose();
    look = null;
    ultra.on = ultraNow();
    if (ultra.on) { // (the composer the Ultra look's own: it disposes it)
      composer = null;
      const w = WAKE_WINDOW.at;
      look = ultraLook(renderer, scene, camera, o.story ? [sight] : [],
                       { at: new Vector3(w[0] + walk.lodge.x, w[1] + walk.lodge.y, w[2] + walk.lodge.z), size: WAKE_WINDOW.size });
      composer = look.composer;
      return;
    }
    composer?.dispose();
    // story mode always runs the sight pass; the ink comes with medium and high quality
    composer = !INK[q] && !o.story ? null : inkComposer(renderer, scene, camera, o.story ? [sight] : [], INK[q], COMPOSER[q]);
  };
  setInk(o.quality);
  const lastInfo = { calls: 0, triangles: 0 };
  renderer.info.autoReset = false; // (counted over all of a frame's passes, the shadows' and the composer's too)
  const draw = () => {
    renderer.info.reset();
    if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
    // through the composer only for the ink, or while a story effect is showing: otherwise straight to the screen,
    // with the canvas's own antialias (a whole extra picture saved)
    if (composer && (INK[quality] || sight.active() || look)) composer.render();
    else renderer.render(scene, camera);
    lastInfo.calls = renderer.info.render.calls;
    lastInfo.triangles = renderer.info.render.triangles;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(o.canvas);
  resize();

  let rig: ((camera: PerspectiveCamera) => void) | null = null;
  const place = () => {
    showNear(player.x, player.z);
    camera.position.set(player.x, player.y, player.z);
    camera.rotation.set(player.pitch, -player.heading, roll + sway * Math.sin(swayT) * 0.045);
    if (rig) { rig(camera); if (arms) arms.root.visible = false; }
    sky.position.copy(camera.position);
    camera.updateMatrixWorld();
    followSun();
    const mat = groundMesh!.material as ShaderMaterial;
    // snap the grid's centre to its own spacing near you, so the land doesn't swim
    (mat.uniforms.center.value as Vector2).set(Math.round(camera.position.x / 2) * 2, Math.round(camera.position.z / 2) * 2);
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

  let raf = 0, running = false, last = 0, acc = 0, statsAt = 0, shadowAge = 0;
  const steppers = new Set<(dt: number) => void>(); // the story's loose things (Body.every)
  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    acc += Math.min(0.25, (now - last) / 1000);
    if (now - last < 250) adapt(now - last); // (not the first frame after a pause or a hidden tab)
    last = now;
    while (acc >= STEP) {
      const move = input.sample();
      const before = player;
      moveBy(move);
      for (const f of steppers) f(STEP * rate);
      acc -= STEP;
      const moved = Math.hypot(player.x - before.x, player.z - before.z);
      stride += moved;
      walking += (Math.min(1.5, moved / (rules.walk * STEP)) - walking) * 0.1;
      if (stride > (move.run ? 1.7 : 0.85)) {
        stride = 0;
        sounds?.step(surface(player.x, player.z), move.run);
      }
    }
    // a door swinging, or (now and then) a story prop moved: the shadows change
    let moved = false;
    for (const m of models()) moved = m.update(1 / 60) || moved;
    if (moved || ++shadowAge > 30) { shadowDirty = true; shadowAge = 0; }
    lightFor(1 / 60); // (the sight pass eases itself, each time the composer renders)
    if (look) {
      look.update(1 / 60, sunDir, lodge ? [lodge.root] : []);
      if (ultraHas("fan") && models().some((m) => m.fans().some((f) => f.speed > 0.02))) shadowDirty = true; // (the fan's shadow turning)
    }
    moving.update(1 / 60, camera);
    grass.update(1 / 60);
    round.update(player.x, player.z);
    for (const f of fires) f.update(1 / 60, camera);
    arms?.update(1 / 60, walking);
    place();
    draw();
    o.onFrame?.(player.x, player.z, player.heading);
    if (now - statsAt > 200) {
      statsAt = now;
      const inside = indoorsAt(player.x, player.z);
      sounds?.hear({ indoors: inside, height: inside ? 0 : player.y - rules.eye, trees: inside ? 0 : Math.min(1, woods.count(player.x, player.z, 35) / 14), water: lakeDistance(player.x, player.z) });
      // the running fans, by how far away each is (through walls too: the rooms are open-doored)
      sounds?.fans(models().flatMap((m) => m.fans()).filter((f) => f.speed > 0.02)
        .map((f) => ({ d: Math.hypot(f.at.x - player.x, f.at.y - player.y, f.at.z - player.z), speed: f.speed, creak: f.room === "dvij-room" })));
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
      route = { pts: routeTo(at), done, to: at };
    }),
    doors: (open) => { for (const m of models()) m.setDoors(open); shadowDirty = true; },
    follow: (p) => { follow = p; },
    halt: () => { follow = null; release(); },
    rate: (r) => { rate = r; sight.speed = r; },
    fromLodge: (x, y, z) => [x + walk.lodge.x, y + walk.lodge.y, z + walk.lodge.z],
    lodgeRoot: () => lodge?.root ?? null,
    chapter: (id) => {
      const was = ultraNow();
      chapter = id;
      if (ultraNow() !== was) { setInk(quality); setShadows(quality); draw(); }
    },
    stir: () => { shadowDirty = true; },
    mirror: (on) => {
      if (mirror) { scene.remove(mirror, mirrorLight, mirrorLight.target); mirror.dispose(); mirror = null; }
      if (!on || !lodge) return false;
      const glass: Object3D[] = [];
      lodge.root.traverse((o) => { if (/^window-glass/.test(o.name)) glass.push(o); });
      const dir = camera.getWorldDirection(new Vector3());
      const hit = new Raycaster(camera.position.clone(), dir, 0.05, 6).intersectObjects(glass, true)[0];
      if (!hit?.face) return false;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.dot(dir) > 0) n.negate();
      const m = new Reflector(new PlaneGeometry(1.4, 2.2), { textureWidth: 512, textureHeight: 800, color: 0xd8d8d8 });
      m.position.copy(hit.point).addScaledVector(n, 0.006);
      m.lookAt(m.position.clone().add(n));
      // only his body in it, on black, added to the glass: the lawn still shows through, his face over it
      const getCam = m.getReflectionCamera.bind(m);
      m.getReflectionCamera = (c: import("three").Camera) => { const rc = getCam(c); rc.layers.set(SELF_LAYER); return rc; };
      const draw = m.onBeforeRender.bind(m);
      m.onBeforeRender = (r, sc, c, ...rest) => {
        const bg = scene.background, fog = scene.fog, clear = r.getClearColor(new Color()), alpha = r.getClearAlpha();
        scene.background = null; scene.fog = null; r.setClearColor(0x000000, 1);
        draw(r, sc, c, ...rest);
        scene.background = bg; scene.fog = fog; r.setClearColor(clear, alpha);
      };
      const mat = m.material as ShaderMaterial;
      mat.transparent = true; mat.blending = AdditiveBlending; mat.depthWrite = false;
      scene.traverse((o) => { if ((o as { isLight?: boolean }).isLight) o.layers.enable(SELF_LAYER); });
      // the daylight through the window falls on his face: a light only the reflection sees
      mirrorLight.position.copy(hit.point).addScaledVector(n, -3).add(new Vector3(0, 1, 0));
      mirrorLight.target.position.copy(hit.point).addScaledVector(n, 1.5);
      scene.add(m, mirrorLight, mirrorLight.target);
      mirror = m;
      return true;
    },
    pane: (from, toward) => {
      if (!lodge) return null;
      const glass: Object3D[] = [];
      lodge.root.traverse((o) => { if (/^window-glass/.test(o.name)) glass.push(o); });
      return makePane(scene, glass, new Vector3(...from), new Vector3(...toward));
    },
    arms: () => arms,
    fromSite: (id, x, y, z) => {
      const st = (walk.sites ?? []).find((k) => k.id === id);
      return st ? [x + st.x, y + st.y, z + st.z] : [x, y, z];
    },
    siteRoot: (id) => sites.get(id)?.root ?? null,
    fx: (name) => sounds?.fx(name),
    surface: (x, y, z) => {
      let top = terrain(x, z);
      for (const m of models()) {
        const f = m.floorAt(x, z, y - 0.55); // (floorAt looks down from 0.6 m above the feet it's given)
        if (f != null && f <= y + 0.05) top = Math.max(top, f);
      }
      return top;
    },
    every: (f) => { steppers.add(f); return () => steppers.delete(f); },
    fan: (room, speed) => { for (const m of models()) m.setFan(room, speed); },
    film: (r) => { rig = r; },
    setting: (s) => {
      setSun(s.sun ?? "morning");
      moving.court(s.court === "covered");
    },
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
    internals: () => ({ renderer, scene, composerOn: (on: boolean) => { if (on) setInk(quality); else { composer?.dispose(); composer = null; } } }),
    sceneStats: () => {
      // triangles per top-level thing in the scene (instances counted), for measuring
      const out: Record<string, number> = {};
      for (const c of scene.children) {
        let n = 0;
        c.traverseVisible((o) => {
          const m = o as Mesh;
          if (!m.isMesh || !m.geometry) return;
          const g = m.geometry, tri = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
          n += tri * ((m as unknown as { count?: number }).count ?? 1);
        });
        let k = c.name || c.type;
        if (!c.name && (c as Mesh).isMesh) {
          const m = c as Mesh;
          k = `mesh:${(m.material as Material)?.type ?? "?"}:${m.geometry.attributes.position?.count ?? 0}:${(m as unknown as { count?: number }).count ?? 1}`;
        }
        out[k] = (out[k] ?? 0) + Math.round(n);
      }
      return out;
    },
    renderInfo: () => ({ calls: lastInfo.calls, triangles: lastInfo.triangles, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 }),
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
      reachForDoor(d);
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
      quality = qq;
      scale = 1;
      renderer.setPixelRatio(pixelRatio());
      stoneRange = STONES_NEAR[qq];
      showNear(player.x, player.z, true);
      buildGround(qq);
      buildCutouts(qq);
      setInk(qq);
      setShadows(qq);
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
      for (const m of [rockMat, castMat, waterMat, sky.material as ShaderMaterial]) m.dispose();
      casters.dispose();
      sky.geometry.dispose();
      round.dispose();
      stones.dispose();
      colours.dispose();
      if (detail) for (const d of Object.values(detail)) { d.color.dispose(); d.normal.dispose(); }
      moving.dispose();
      grass.dispose();
      arms?.dispose();
      for (const f of fires) f.dispose();
      lodge?.dispose();
      for (const m of sites.values()) m.dispose();
      cutTex.dispose();
      cutouts?.geometry.dispose();
      (cutouts?.material as ShaderMaterial | undefined)?.dispose();
      composer?.dispose();
      envMap.dispose();
      renderer.dispose();
    },
  };
}
