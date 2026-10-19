// The 3D valley (design §10.1). Loaded only when a reader opens the 3D view
// (Valley3D.tsx imports this module dynamically), so three.js and the terrain
// data never weigh on the flat map's first load.
//
// Draws on demand: a frame is rendered only while the camera moves or
// something changes, and nothing runs while the view is hidden or scrolled away.
import {
  AmbientLight, Color, DirectionalLight, DoubleSide, Euler, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera,
  PlaneGeometry, Quaternion, Scene, Shape, ShapeGeometry, Spherical, SRGBColorSpace, Texture,
  TextureLoader, Vector2, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { gridSize } from "../terrain";
import { terrain } from "../terrain-data";
import { clampTarget, ease, lerp3, viewFrom, type Vec3 } from "./camera";
import { lineOfSight, toScreen } from "./labels";
import { landMaterial, PAPER } from "./style";

export type ValleyOptions = {
  canvas: HTMLCanvasElement;
  /** The label elements, by place id; the scene positions them every frame. */
  labels: Map<string, HTMLElement>;
  heightUrl: string;
  drapeUrl: string;
  reducedMotion: boolean;
  phone: boolean;
  /** Camera to start from (a previous visit's), if any. */
  start?: { position: Vec3; target: Vec3 };
  onReady: () => void;
  onCamera?: (pose: { position: Vec3; target: Vec3 }) => void;
  onLost?: () => void;
  /** A flight starts (true) or lands (false); never called when motion is reduced. */
  onFlight?: (flying: boolean) => void;
};

export type Valley = {
  flyTo: (id: string) => Promise<void>;
  reset: () => void;
  orbit: (dAzimuth: number, dPolar: number) => void;
  zoom: (factor: number) => void;
  refreshLabels: () => void;
  dispose: () => void;
};

const EXAG = terrain.verticalExaggeration;
const HOME: { position: Vec3; target: Vec3 } = { position: [-2200, 6200, 9200], target: [0, 120, 300] };
const LABEL_LIFT = 140; // metres above the ground a label's point floats

async function loadHeights(url: string) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const { width: w, height: hgt } = bmp; // read before close(), which zeroes them
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, w, hgt).data;
  const { min, max } = terrain.height;
  const data = new Float32Array(w * hgt);
  for (let i = 0; i < data.length; i++) data[i] = min + (px[i * 4] / 255) * (max - min);
  return { w, h: hgt, data };
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => new TextureLoader().load(url, resolve, undefined, reject));
}

export async function createValley(o: ValleyOptions): Promise<Valley> {
  const [heights, drape] = await Promise.all([loadHeights(o.heightUrl), loadTexture(o.drapeUrl)]);
  const [gw, gd] = gridSize(terrain);
  const W = terrain.worldWidth;
  const D = terrain.worldDepth;

  /** Ground height (metres, unstretched) at world x, z, by bilinear lookup. */
  const groundAt = (x: number, z: number) => {
    const u = Math.min(Math.max((x + gw / 2) / gw, 0), 1) * (heights.w - 1);
    const v = Math.min(Math.max((z + gd / 2) / gd, 0), 1) * (heights.h - 1);
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, heights.w - 1), y1 = Math.min(y0 + 1, heights.h - 1);
    const fx = u - x0, fy = v - y0;
    const at = (xx: number, yy: number) => heights.data[yy * heights.w + xx];
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
  };

  const renderer = new WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, o.phone ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  const paper = new Color().setRGB(PAPER.x, PAPER.y, PAPER.z, SRGBColorSpace);
  renderer.setClearColor(paper);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 20, 60000);

  // The land.
  const seg = o.phone ? 256 : 512;
  const land = new PlaneGeometry(gw, gd, seg, Math.round((seg * gd) / gw));
  land.rotateX(-Math.PI / 2);
  const pos = land.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt(pos.getX(i), pos.getZ(i)) * EXAG);
  land.computeVertexNormals();
  drape.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const landMat = landMaterial(drape, W, D, 70 * EXAG, [18000, 42000]);
  const landMesh = new Mesh(land, landMat);
  scene.add(landMesh);

  // Water, flat and blue, at the lake's level.
  const waterMat = new MeshBasicMaterial({ color: new Color("#5f8fa3"), transparent: true, opacity: 0.88, side: DoubleSide });
  const waterGeos: ShapeGeometry[] = [];
  for (const lake of terrain.water) {
    const shape = new Shape(lake.points.map(([x, z]) => new Vector2(x, -z)));
    const g = new ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    waterGeos.push(g);
    const m = new Mesh(g, waterMat);
    m.position.y = (lake.level + 0.4) * EXAG;
    scene.add(m);
  }

  // Boulders: one instanced, seeded low-poly rock.
  const rock = new IcosahedronGeometry(0.5, 0);
  const rp = rock.attributes.position;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (0.8 + 0.4 * rnd()), rp.getY(i) * (0.8 + 0.4 * rnd()), rp.getZ(i) * (0.8 + 0.4 * rnd()));
  rock.computeVertexNormals();
  const rockMat = new MeshLambertMaterial({ color: new Color("#8b7b66"), flatShading: true });
  const stones = new InstancedMesh(rock, rockMat, terrain.boulders.length);
  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), p = new Vector3(), s = new Vector3();
  terrain.boulders.forEach(([x, y, z, size, rot], i) => {
    q.setFromEuler(e.set(0, rot, 0));
    stones.setMatrixAt(i, m4.compose(p.set(x, y * EXAG + size * 0.15, z), q, s.set(size, size * 0.65, size)));
  });
  scene.add(stones);
  scene.add(new AmbientLight(0xffffff, 1.4));
  const sun = new DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(8500, 4200, -2000);
  scene.add(sun);

  // The camera and its controls.
  const controls = new OrbitControls(camera, o.canvas);
  controls.enableDamping = !o.reducedMotion;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 700;
  controls.maxDistance = 17000;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.38;
  const bounds = { halfWidth: W / 2, halfDepth: D / 2 };
  const setPose = (pose: { position: Vec3; target: Vec3 }) => {
    camera.position.set(...pose.position);
    controls.target.set(...pose.target);
    controls.update();
  };
  setPose(o.start ?? HOME);

  // Labels.
  const anchors = new Map<string, Vec3>();
  for (const [id, [x, y, z]] of Object.entries(terrain.anchors)) anchors.set(id, [x, (y + LABEL_LIFT) * EXAG, z]);
  const groundStretched = (x: number, z: number) => groundAt(x, z) * EXAG;
  const ndc = new Vector3();
  let sightCheck = 0;
  const placeLabels = (checkSight: boolean) => {
    const w = o.canvas.clientWidth, h = o.canvas.clientHeight;
    const cam: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    for (const [id, el] of o.labels) {
      const a = anchors.get(id);
      if (!a) continue;
      ndc.set(...a).project(camera);
      const spot = toScreen(ndc, w, h);
      // keep the whole label inside the view, not just its anchor point
      const half = el.offsetWidth / 2 + 4;
      const x = Math.min(Math.max(spot.x, half), w - half);
      const y = Math.min(Math.max(spot.y, el.offsetHeight + 4), h - 4);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.toggleAttribute("data-offscreen", spot.offscreen);
      if (checkSight) el.toggleAttribute("data-hidden-by-land", !spot.offscreen && !lineOfSight(cam, a, groundStretched));
    }
  };

  // Drawing on demand.
  let raf = 0, dirty = true, ready = false, visible = true, disposed = false;
  let flight: { from: { position: Vec3; target: Vec3 }; to: { position: Vec3; target: Vec3 }; t0: number; ms: number; done: () => void } | null = null;
  const pose = () => ({
    position: [camera.position.x, camera.position.y, camera.position.z] as Vec3,
    target: [controls.target.x, controls.target.y, controls.target.z] as Vec3,
  });
  const frame = (now: number) => {
    raf = 0;
    if (disposed) return;
    let moving = false;
    if (flight) {
      const t = ease((now - flight.t0) / flight.ms);
      setPose({ position: lerp3(flight.from.position, flight.to.position, t), target: lerp3(flight.from.target, flight.to.target, t) });
      moving = true;
      if (t >= 1) {
        const done = flight.done;
        flight = null;
        done();
      }
    } else {
      moving = controls.update();
    }
    const [tx, ty, tz] = clampTarget([controls.target.x, controls.target.y, controls.target.z], bounds);
    if (tx !== controls.target.x || tz !== controls.target.z) {
      const dx = tx - controls.target.x, dz = tz - controls.target.z;
      controls.target.set(tx, ty, tz);
      camera.position.x += dx;
      camera.position.z += dz;
    }
    if (dirty || moving) {
      renderer.render(scene, camera);
      const check = now - sightCheck > 200 || !moving;
      if (check) sightCheck = now;
      placeLabels(check);
      dirty = false;
      if (!ready) {
        ready = true;
        o.onReady();
      }
      if (!moving) o.onCamera?.(pose());
    }
    if (moving || flight) schedule();
  };
  const schedule = () => {
    if (!raf && visible && !disposed) raf = requestAnimationFrame(frame);
  };
  const redraw = () => {
    dirty = true;
    schedule();
  };
  controls.addEventListener("change", redraw);

  const resize = () => {
    const w = o.canvas.clientWidth, h = o.canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    redraw();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(o.canvas);
  resize();
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) redraw();
  });
  io.observe(o.canvas);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) redraw();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onLost = (ev: Event) => {
    ev.preventDefault();
    o.onLost?.();
  };
  o.canvas.addEventListener("webglcontextlost", onLost);

  const fly = (to: { position: Vec3; target: Vec3 }) =>
    new Promise<void>((resolve) => {
      if (o.reducedMotion) {
        setPose(to);
        redraw();
        resolve();
        return;
      }
      o.onFlight?.(true);
      flight = { from: pose(), to, t0: performance.now(), ms: 1400, done: () => { o.onFlight?.(false); resolve(); } };
      schedule();
    });

  const sph = new Spherical();
  const offset = new Vector3();

  return {
    flyTo: (id) => {
      const a = terrain.anchors[id];
      if (!a) return Promise.resolve();
      const target: Vec3 = [a[0], a[1] * EXAG, a[2]];
      return fly({ target, position: viewFrom(target, pose().position, 3200, 0.62) });
    },
    reset: () => void fly(HOME),
    orbit: (dAz, dPolar) => {
      offset.copy(camera.position).sub(controls.target);
      sph.setFromVector3(offset);
      sph.theta += dAz;
      sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi + dPolar));
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      redraw();
    },
    zoom: (factor) => {
      offset.copy(camera.position).sub(controls.target);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
      camera.position.copy(controls.target).add(offset.setLength(len));
      controls.update();
      redraw();
    },
    refreshLabels: () => placeLabels(true),
    dispose: () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      o.canvas.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      for (const g of [land, rock, ...waterGeos]) g.dispose();
      for (const m of [landMat, waterMat, rockMat]) m.dispose();
      stones.dispose();
      drape.dispose();
      renderer.dispose();
    },
  };
}
