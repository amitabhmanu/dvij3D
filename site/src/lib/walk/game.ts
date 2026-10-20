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
import { decodeHeights, fieldFor, heightAt, type Field } from "./heights";
import { groundGeometry, groundMaterial } from "./ground";
import { inkComposer } from "./post";
import { cutoutMesh, decodeTrees, type Stand } from "./cutouts";
import type { EffectComposer } from "postprocessing";
import { Input, type Settings } from "./input";
import { Blockers, inside, step, type Player } from "./player";
import { atlas, walk, walkAsset, type Building } from "./walk-data";

export type Quality = "low" | "medium" | "high";
export type GameOptions = {
  canvas: HTMLCanvasElement;
  heightUrl: string;
  worldUrl: string;
  groundUrl: string;
  quality: Quality;
  onProgress: (fraction: number, what: string) => void;
  /** About five times a second while walking: where you are, for the HUD and tests. */
  onStats?: (s: { x: number; z: number; heading: number; ground: number }) => void;
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
  dispose: () => void;
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
  const ground = (x: number, z: number) => heightAt(field, x, z);

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
    hazeRange: [900, 7000], reach, cells,
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
  const stands: Stand[] = worldJson.buildings.map((b) => ({ x: b.x, y: ground(b.x, b.z), z: b.z, height: b.height, sprite: spriteIndex.get(b.sprite)! }));
  for (const b of worldJson.buildings) blockers.add(b.x, b.z, b.r);
  for (const t of await decodeTrees(treeBuf)) {
    stands.push({ x: t.x, y: ground(t.x, t.z), z: t.z, height: t.height, sprite: t.sprite });
    blockers.add(t.x, t.z, 0.35);
  }
  let cutouts: Mesh | null = null;
  const buildCutouts = (q: Quality) => {
    if (cutouts) { scene.remove(cutouts); cutouts.geometry.dispose(); (cutouts.material as ShaderMaterial).dispose(); }
    cutouts = cutoutMesh(stands, atlas, cutTex, HAZE, [900, 7000], DRAW[q]);
    scene.add(cutouts);
  };
  buildCutouts(o.quality);
  scene.add(new AmbientLight(0xffffff, 1.3));
  const sun = new DirectionalLight(0xfff1d6, 2.0);
  sun.position.copy(SUN_DIR).multiplyScalar(9000);
  scene.add(sun);

  const halfW = walk.worldWidth / 2 - 3, halfD = walk.worldDepth / 2 - 3;
  const blocked = (x: number, z: number, r: number) =>
    Math.abs(x) > halfW || Math.abs(z) > halfD ||
    walk.water.some((lake) => inside(lake.points, x, z)) ||
    blockers.hits(x, z, r);

  const input = new Input(o.canvas);
  const rules = walk.player;
  let player: Player = {
    x: walk.spawn.x, z: walk.spawn.z, y: 0, heading: (walk.spawn.heading * Math.PI) / 180, pitch: -0.05,
  };
  const world = { ground, blocked };

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
  const setInk = (q: Quality) => {
    composer?.dispose();
    composer = q === "low" ? null : inkComposer(renderer, scene, camera);
  };
  setInk(o.quality);
  const draw = () => (composer ? composer.render() : renderer.render(scene, camera));
  const ro = new ResizeObserver(resize);
  ro.observe(o.canvas);
  resize();

  const place = () => {
    camera.position.set(player.x, player.y, player.z);
    camera.rotation.set(player.pitch, -player.heading, 0);
    sky.position.copy(camera.position);
    const mat = groundMesh!.material as ShaderMaterial;
    // snap the grid's centre to its own spacing near you, so the land doesn't swim
    (mat.uniforms.center.value as Vector2).set(Math.round(player.x / 2) * 2, Math.round(player.z / 2) * 2);
  };

  let raf = 0, running = false, last = 0, acc = 0, statsAt = 0;
  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      player = step(player, input.sample(), STEP, rules, world);
      acc -= STEP;
    }
    place();
    draw();
    o.onFrame?.(player.x, player.z, player.heading);
    if (o.onStats && now - statsAt > 200) {
      statsAt = now;
      o.onStats({ x: player.x, z: player.z, heading: player.heading, ground: ground(player.x, player.z) });
    }
    raf = requestAnimationFrame(frame);
  };

  // first frame, so the canvas shows the valley behind the "click to start" card
  player = step(player, input.sample(), STEP, rules, world);
  place();
  draw();
  o.onProgress(1, "Ready");

  return {
    start: () => {
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
    },
    input,
    settings: input.settings,
    teleport: (x, z, heading) => {
      player = { ...player, x, z, y: 0, heading: heading ?? player.heading };
      player = step(player, { forward: 0, strafe: 0, run: false, turn: 0, look: 0 }, STEP, rules, world);
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
      ro.disconnect();
      input.dispose();
      groundMesh?.geometry.dispose();
      (groundMesh?.material as ShaderMaterial | undefined)?.dispose();
      for (const g of [rock, ...waterGeos]) g.dispose();
      for (const m of [rockMat, waterMat, sky.material as ShaderMaterial]) m.dispose();
      sky.geometry.dispose();
      stones.dispose();
      colours.dispose();
      cutTex.dispose();
      cutouts?.geometry.dispose();
      (cutouts?.material as ShaderMaterial | undefined)?.dispose();
      composer?.dispose();
      renderer.dispose();
    },
  };
}
