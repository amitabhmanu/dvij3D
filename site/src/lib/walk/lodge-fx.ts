// What moves in the lodge besides its doors and fans (design §10.3): the kitchen's
// tandoor fire flickering and throwing its orange light on the soot (novel ¶195,
// comic b1-p010-3), the dhoop batti's smoke curling up under the god-prints (¶195),
// and dust hanging in the light of the rooms Dvij wakes and faints in (comic
// b1-p004-9, b1-p007-2). All in the lodge's own frame.
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NormalBlending, PlaneGeometry, PointLight, Points, PointsMaterial, RepeatWrapping, SRGBColorSpace,
  type Camera, type Material, type Object3D,
} from "three";

const FLOOR = 0.6; // the rooms' floors (lodge.yaml house.plinth)

function puff(rgb: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  r.addColorStop(0, `rgba(${rgb},0.7)`);
  r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export type LodgeFx = {
  update: (dt: number, camera: Camera) => void;
  /** Draw the fibreglass curtain over the courtyard's bars (novel ¶193), or leave it torn open. */
  court: (covered: boolean) => void;
  dispose: () => void;
};

export function lodgeFx(root: Object3D): LodgeFx {
  const fx = new Group();
  root.add(fx);
  const owned: { dispose: () => void }[] = [];
  let t = 0;

  // the tandoor's fire: its own glow flickers, and it lights the kitchen's deep end orange
  let fire: MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined;
    if (m && m.name === "fire" && m instanceof MeshStandardMaterial) fire = m;
  });
  const glow = new PointLight(new Color("#ff8a3a"), 0, 5.5, 2);
  glow.position.set(14.75, FLOOR + 0.75, -13.9);
  fx.add(glow);

  // the dhoop batti on the shelf of brass under the god-prints, and its smoke
  const stick = new Mesh(new CylinderGeometry(0.0015, 0.0015, 0.22, 4), new MeshStandardMaterial({ color: "#5a2a18" }));
  stick.position.set(15.35, FLOOR + 1.11, -12.4);
  stick.rotation.z = 0.25;
  const ember = new Mesh(new CylinderGeometry(0.002, 0.002, 0.008, 4), new MeshBasicMaterial({ color: "#ff5a20" }));
  ember.position.set(15.35 - Math.sin(0.25) * 0.11, FLOOR + 1.11 + Math.cos(0.25) * 0.11, -12.4);
  fx.add(stick, ember);
  owned.push(stick.geometry, stick.material as Material, ember.geometry, ember.material as Material);
  const smokeTex = puff("190,186,178");
  owned.push(smokeTex);
  const smoke = Array.from({ length: 14 }, (_, k) => {
    const m = new Mesh(new PlaneGeometry(0.05, 0.05), new MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0, blending: NormalBlending }));
    m.userData.t = k / 14;
    fx.add(m);
    owned.push(m.geometry, m.material as Material);
    return m;
  });

  // the courtyard's cover: "a curtain of thin fibreglass that was spread over the row of rusting iron
  // bars, spread to keep the monkeys out" (novel ¶193), the light under it diffused (comic b1-p010-1)
  // (translucent: it glows with the daylight coming through it, fibres and old stains showing)
  const fibre = document.createElement("canvas");
  fibre.width = fibre.height = 256;
  const fg = fibre.getContext("2d")!;
  fg.fillStyle = "#e8e2cf";
  fg.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 900; k++) {
    fg.strokeStyle = `rgba(${150 + Math.random() * 60},${140 + Math.random() * 50},${110 + Math.random() * 40},0.25)`;
    fg.beginPath();
    const x = Math.random() * 256, y = Math.random() * 256, a = Math.random() * Math.PI;
    fg.moveTo(x, y);
    fg.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
    fg.stroke();
  }
  for (let k = 0; k < 14; k++) { // water stains and grime where it sags between the bars
    const r = fg.createRadialGradient(0, 0, 2, 0, 0, 40);
    r.addColorStop(0, "rgba(120,100,70,0.35)");
    r.addColorStop(1, "rgba(120,100,70,0)");
    fg.save();
    fg.translate(Math.random() * 256, Math.random() * 256);
    fg.fillStyle = r;
    fg.fillRect(-40, -40, 80, 80);
    fg.restore();
  }
  const fibreTex = new CanvasTexture(fibre);
  fibreTex.wrapS = fibreTex.wrapT = RepeatWrapping;
  fibreTex.repeat.set(4, 4);
  fibreTex.colorSpace = SRGBColorSpace;
  owned.push(fibreTex);
  const sheet = new Mesh(new PlaneGeometry(16.2, 16.2, 1, 1), new MeshStandardMaterial({
    color: new Color("#d9d2bd"), map: fibreTex, emissive: new Color("#f3ead2"), emissiveMap: fibreTex, emissiveIntensity: 0.75,
    transparent: true, opacity: 0.88, roughness: 0.9, side: DoubleSide, depthWrite: false,
  }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, FLOOR + 4.6 + 0.71, 0); // just above the bars (blender/build_lodge.py build_court_cover)
  sheet.visible = false;
  sheet.castShadow = true; // (the court under it out of the direct sun, lit by the sky through it)
  fx.add(sheet);
  owned.push(sheet.geometry, sheet.material as Material);

  // dust in the air of Dvij's room and the study: a slow drift of motes
  const motes = (x0: number, z0: number, x1: number, z1: number, n: number) => {
    const pos: number[] = [];
    for (let k = 0; k < n; k++) pos.push(x0 + Math.random() * (x1 - x0), FLOOR + 0.3 + Math.random() * 3.2, z0 + Math.random() * (z1 - z0));
    const g = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(pos, 3));
    const p = new Points(g, new PointsMaterial({ color: "#f2e6c8", size: 0.006, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending }));
    p.userData.home = pos.slice();
    fx.add(p);
    owned.push(g, p.material as Material);
    return p;
  };
  const dust = [motes(-15.8, 0.2, -10.7, 10.3, 260), motes(-15.8, -15.8, -5.2, -10.7, 420)];

  return {
    update: (dt, camera) => {
      t += dt;
      // flicker: two slow waves and a quick one, never steady
      const f = 0.75 + 0.15 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.3) + 0.06 * Math.sin(t * 29 + 0.4);
      glow.intensity = 2.2 * f;
      if (fire) (fire as MeshStandardMaterial).emissiveIntensity = 4 * f;
      for (const m of smoke) {
        m.userData.t = (m.userData.t + dt * 0.12) % 1;
        const s = m.userData.t;
        // up from the ember, swaying wider as it rises, swelling and thinning out
        m.position.set(ember.position.x + Math.sin(s * 11 + t * 0.7) * 0.05 * s, ember.position.y + s * 0.9, ember.position.z + Math.cos(s * 8 + t) * 0.04 * s);
        m.scale.setScalar(0.4 + s * 3);
        (m.material as MeshBasicMaterial).opacity = 0.35 * Math.sin(Math.PI * Math.min(1, s * 1.4)) * (1 - s);
        m.quaternion.copy(camera.quaternion);
      }
      for (const p of dust) {
        const a = p.geometry.getAttribute("position") as Float32BufferAttribute, home = p.userData.home as number[];
        for (let i = 0; i < a.count; i++) {
          const ph = i * 1.7;
          a.setXYZ(i, home[i * 3] + Math.sin(t * 0.13 + ph) * 0.15, home[i * 3 + 1] + Math.sin(t * 0.09 + ph * 1.3) * 0.12, home[i * 3 + 2] + Math.cos(t * 0.11 + ph) * 0.15);
        }
        a.needsUpdate = true;
      }
    },
    court: (covered) => { sheet.visible = covered; },
    dispose: () => {
      root.remove(fx);
      for (const o of owned) o.dispose();
    },
  };
}
