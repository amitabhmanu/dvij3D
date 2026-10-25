// A dirty window pane with his own face in it (novel ¶101: "windows that revealed a wide lawn through their dirty
// panes. They also revealed the reflection of a bearded face with a heavily bandaged head"). Two layers laid over the
// lodge's glass: the grime (a haze, smudges, rain streaks and specks, so the pane reads as dirty from across the room),
// and the reflection of his body only (on SELF_LAYER: never seen by his own eyes), added to the glass as daylight
// lets one show. Its strength is the story's to set (stage.ts: it comes up as he walks to the window).
import {
  AdditiveBlending, Box3, CanvasTexture, Color, DirectionalLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Raycaster,
  SRGBColorSpace, Vector3, type Object3D, type Scene, type ShaderMaterial, type Camera,
} from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

export type Pane = {
  /** The pane's middle (world). */
  centre: Vector3;
  /** Which way it faces, back into the room (world). */
  normal: Vector3;
  /** Along it, level (world), and how wide it is (m): to stand before one half of a window, not its mullion. */
  across: Vector3;
  width: number;
  /** How strongly his reflection shows: 0 none, 1 as much as the daylight allows. */
  strength: (k: number) => void;
  dispose: () => void;
};

/** The grime on a pane, drawn once: a brownish haze, darker towards the bottom where the dust settles, smudged
 * patches, streaks run down from old rain, specks. Its alpha is how much it hides; the reflection still shows through. */
function grimeTexture(): CanvasTexture {
  const W = 512, H = 768;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // the haze, heavier at the bottom and in the corners
  const haze = g.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, "rgba(120,108,86,0.16)");
  haze.addColorStop(0.7, "rgba(116,104,80,0.24)");
  haze.addColorStop(1, "rgba(98,86,64,0.42)");
  g.fillStyle = haze;
  g.fillRect(0, 0, W, H);
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const r = g.createRadialGradient(x, y, 0, x, y, W * 0.55);
    r.addColorStop(0, "rgba(90,78,58,0.35)");
    r.addColorStop(1, "rgba(90,78,58,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, W, H);
  }
  // smudges: soft blotches where a hand or a cloth once went
  for (let k = 0; k < 26; k++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 70;
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, `rgba(${110 + rnd() * 30},${100 + rnd() * 25},${80 + rnd() * 20},${0.1 + rnd() * 0.16})`);
    s.addColorStop(1, "rgba(110,100,80,0)");
    g.fillStyle = s;
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  // streaks run down from old rain
  for (let k = 0; k < 60; k++) {
    const x = rnd() * W, y0 = rnd() * H * 0.6, len = 60 + rnd() * 260;
    g.strokeStyle = `rgba(92,82,62,${0.08 + rnd() * 0.14})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(x, y0);
    g.bezierCurveTo(x + (rnd() - 0.5) * 8, y0 + len * 0.3, x + (rnd() - 0.5) * 10, y0 + len * 0.7, x + (rnd() - 0.5) * 12, y0 + len);
    g.stroke();
  }
  // specks of dust and fly marks
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(${60 + rnd() * 50},${54 + rnd() * 40},${40 + rnd() * 30},${0.25 + rnd() * 0.5})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The pane met by a line of sight from `from` towards `toward` (world), dirtied, with his reflection laid on it at
 * strength 0; null if no glass is there. `glass`: the lodge's window glass. */
export function makePane(scene: Scene, glass: Object3D[], from: Vector3, toward: Vector3): Pane | null {
  const dir = toward.clone().sub(from).normalize();
  const hit = new Raycaster(from, dir, 0.05, 8).intersectObjects(glass, true)[0];
  if (!hit?.face) return null;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (normal.dot(dir) > 0) normal.negate();
  // the glass's own extent on its plane (one pane's, or a window's; a stand-in size if the mesh is many windows)
  const box = new Box3().setFromObject(hit.object), size = box.getSize(new Vector3());
  const across = new Vector3(0, 1, 0).cross(normal).normalize();
  let w = Math.abs(size.x * across.x) + Math.abs(size.z * across.z), h = size.y;
  const centre = box.getCenter(new Vector3());
  centre.addScaledVector(normal, normal.dot(hit.point.clone().sub(centre)));
  if (w > 3 || h > 3 || w < 0.3 || h < 0.3) { w = 1.4; h = 2.2; centre.copy(hit.point); }

  const grimeMat = new MeshStandardMaterial({ map: grimeTexture(), transparent: true, depthWrite: false, roughness: 1, metalness: 0, color: new Color("#d8cdb4") });
  const grime = new Mesh(new PlaneGeometry(w, h), grimeMat);
  grime.position.copy(centre).addScaledVector(normal, 0.004);
  grime.lookAt(grime.position.clone().add(normal));
  grime.renderOrder = 2;
  // the lawn through the glass a little dimmer the nearer he is, so his face reads over it (a reflection added to
  // bright daylight washes out: it showed as a pale ghost)
  const shadeMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
  const shade = new Mesh(new PlaneGeometry(w, h), shadeMat);
  shade.position.copy(centre).addScaledVector(normal, 0.002);
  shade.lookAt(shade.position.clone().add(normal));
  shade.renderOrder = 1;

  const mirror = new Reflector(new PlaneGeometry(w, h), { textureWidth: 1024, textureHeight: Math.round(1024 * h / w), color: 0xd8d8d8 });
  mirror.position.copy(centre).addScaledVector(normal, 0.007);
  mirror.lookAt(mirror.position.clone().add(normal));
  // only his body in it, on black, added to the glass: the lawn still shows through, his face over it
  const selfLayer = 1;
  const getCam = mirror.getReflectionCamera.bind(mirror);
  mirror.getReflectionCamera = (c: Camera) => { const rc = getCam(c); rc.layers.set(selfLayer); return rc; };
  const draw = mirror.onBeforeRender.bind(mirror);
  mirror.onBeforeRender = (r, sc, c, ...rest) => {
    const bg = scene.background, fog = scene.fog, clear = r.getClearColor(new Color()), alpha = r.getClearAlpha();
    scene.background = null; scene.fog = null; r.setClearColor(0x000000, 1);
    draw(r, sc, c, ...rest);
    scene.background = bg; scene.fog = fog; r.setClearColor(clear, alpha);
  };
  const mat = mirror.material as ShaderMaterial;
  mat.transparent = true; mat.blending = AdditiveBlending; mat.depthWrite = false;
  // (added to the glass, so scaling what it adds fades it: three's own colour is an overlay, it can't)
  mat.uniforms.strength = { value: 0 };
  mat.fragmentShader = mat.fragmentShader
    .replace("uniform vec3 color;", "uniform vec3 color;\nuniform float strength;")
    .replace("gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );", "gl_FragColor = vec4( blendOverlay( base.rgb, color ) * strength, 1.0 );");
  mirror.renderOrder = 3;
  mirror.visible = false; // (until it shows at all: no reflection pass for nothing)
  scene.traverse((o) => { if ((o as { isLight?: boolean }).isLight) o.layers.enable(selfLayer); });
  // the daylight through the window falls on his face: a light only the reflection sees
  const light = new DirectionalLight(0xfff0dc, 2.4);
  light.layers.set(selfLayer);
  light.position.copy(centre).addScaledVector(normal, -3).add(new Vector3(0, 1, 0));
  light.target.position.copy(centre).addScaledVector(normal, 1.5);
  scene.add(shade, grime, mirror, light, light.target);

  return {
    centre, normal, across, width: w,
    strength: (k) => {
      const s = Math.max(0, Math.min(1, k));
      mirror.visible = s > 0.01;
      mat.uniforms.strength.value = s;
      shadeMat.opacity = 0.5 * s;
    },
    dispose: () => {
      scene.remove(shade, grime, mirror, light, light.target);
      shade.geometry.dispose(); shadeMat.dispose();
      grime.geometry.dispose(); grimeMat.map?.dispose(); grimeMat.dispose();
      mirror.dispose();
    },
  };
}
