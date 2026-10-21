// The lodge's "particularly unkempt lawn" (novel ¶163), its "overgrown grass" with a clearing cut in
// it where the deck chairs stand (¶249, comic b1-p012-3): tufts of dry, burnt grass over the
// grounds, clear of the house, the gravel, the well, the outbuildings and the clearing. One
// instanced mesh in the lodge's frame; they lean a little in the breeze.
import {
  CanvasTexture, Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion,
  SRGBColorSpace, Vector3, BufferGeometry, Float32BufferAttribute, type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Rect = [number, number, number, number];

function bladesTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 46; k++) { // blades of dry grass, straw to dun, from a common root
    const x = 64 + (rnd() - 0.5) * 50, top = 8 + rnd() * 70, lean = (rnd() - 0.5) * 50;
    const tone = 120 + rnd() * 70;
    g.strokeStyle = `rgb(${tone + 20},${tone},${tone * 0.55})`;
    g.lineWidth = 1.5 + rnd() * 2;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.3, (128 + top) / 2, x + lean, top);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function lawnGrass(root: Object3D, grounds: Rect, opts: { half: number; clearings?: [number, number, number][] }) {
  const tex = bladesTexture();
  const material = new MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: DoubleSide, roughness: 1, color: new Color("#d8cfae") });
  // a tuft: three crossed blades of card, 45 cm high and as wide
  const card = () => { const p = new PlaneGeometry(0.45, 0.45); p.translate(0, 0.225, 0); return p; };
  const parts = [0, 1, 2].map((k) => card().rotateY((k * Math.PI) / 3));
  const tuft: BufferGeometry = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  // the normals point up, so the cards are lit as the ground under them is, not as flat boards
  const n = tuft.getAttribute("normal");
  const up = new Float32Array(n.count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0));
  tuft.setAttribute("normal", new Float32BufferAttribute(up, 3));
  const [x0, z0, x1, z1] = grounds;
  const H = opts.half;
  const out = (x: number, z: number) =>
    (Math.abs(x) < H + 4.6 && Math.abs(z) < H + 4.0) || // the house, its verandah and the gravel round it
    (Math.abs(x) < 2.8 && z > H) || // the drive
    Math.hypot(x, z - 47) < 3 || // its planter
    Math.hypot(x + 18, z - 38) < 2.6 || // the well
    (x > 25 && x < 41 && z > -41 && z < -29) || (x > -49 && x < -39 && z > -41 && z < -32) || // the servant quarters, Kurup's shed
    x < x0 + 1.6 || x > x1 - 1.6 || z < z0 + 1.6 || z > z1 - 1.6 || // the hedge inside the boundary wall
    (opts.clearings ?? []).some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r);
  const at: [number, number, number][] = [];
  let s = 31;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let z = z0; z < z1; z += 0.9) {
    for (let x = x0; x < x1; x += 0.9) {
      const px = x + (rnd() - 0.5) * 0.9, pz = z + (rnd() - 0.5) * 0.9;
      if (!out(px, pz) && rnd() < 0.75) at.push([px, pz, rnd()]);
    }
  }
  const mesh = new InstancedMesh(tuft, material, at.length);
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), sc = new Vector3(), yAxis = new Vector3(0, 1, 0);
  at.forEach(([x, z, r], i) => {
    q.setFromAxisAngle(yAxis, r * Math.PI * 2);
    const k = 0.6 + r * 0.9;
    mesh.setMatrixAt(i, m.compose(p.set(x, 0, z), q, sc.set(k, 0.7 + r * 0.8, k)));
  });
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.computeBoundingSphere();
  // a breeze: the tops lean, slowly, out of step (comic b1-p008-3's grass, ¶165's "gentle breeze")
  const time = { value: 0 };
  material.onBeforeCompile = (sh) => {
    sh.uniforms.breeze = time;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float breeze;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float sway = sin(breeze * 1.3 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5) * 0.06 * transformed.y / 0.45;
        transformed.x += sway; transformed.z += sway * 0.5;`);
    // both faces of a card lit as the ground is (three would turn the back face's normal down)
    sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize( vNormal );");
  };
  root.add(mesh);
  return {
    update: (dt: number) => { time.value += dt; },
    dispose: () => { root.remove(mesh); tuft.dispose(); material.dispose(); tex.dispose(); mesh.dispose(); },
  };
}
