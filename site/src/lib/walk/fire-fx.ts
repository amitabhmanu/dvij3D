// A fire burning in the open: the temple site's altar, "a fire already burning" (novel ¶320,
// comic b1-p015-1). Flames licking up, smoke rising, the light it throws and its built-in glow
// flickering, at `at` in root's own frame.
import {
  AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  PointLight, type Camera, type Material, type Object3D,
} from "three";

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  return new CanvasTexture(c);
}

export function openFire(root: Object3D, at: [number, number, number]): { update: (dt: number, camera: Camera) => void; dispose: () => void } {
  const group = new Group();
  group.position.set(...at);
  root.add(group);
  const owned: { dispose: () => void }[] = [];
  const flameTex = canvas(64, 128, (g) => {
    const r = g.createRadialGradient(32, 96, 2, 32, 80, 60);
    r.addColorStop(0, "rgba(255,240,170,1)");
    r.addColorStop(0.35, "rgba(255,150,40,0.9)");
    r.addColorStop(1, "rgba(200,40,0,0)");
    g.fillStyle = r;
    g.beginPath(); // a tongue of flame: round at the foot, tapering up
    g.moveTo(32, 2); g.quadraticCurveTo(58, 70, 50, 104); g.quadraticCurveTo(32, 128, 14, 104); g.quadraticCurveTo(6, 70, 32, 2);
    g.fill();
  });
  const smokeTex = canvas(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 1, 32, 32, 30);
    r.addColorStop(0, "rgba(110,104,96,0.7)");
    r.addColorStop(1, "rgba(110,104,96,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  owned.push(flameTex, smokeTex);
  const flames = Array.from({ length: 7 }, (_, k) => {
    const m = new Mesh(new PlaneGeometry(0.22, 0.44), new MeshBasicMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    m.userData.ph = k * 1.9;
    m.position.set(Math.cos(k * 2.4) * 0.12, 0.2, Math.sin(k * 2.4) * 0.12);
    group.add(m);
    owned.push(m.geometry, m.material as Material);
    return m;
  });
  const smoke = Array.from({ length: 12 }, (_, k) => {
    const m = new Mesh(new PlaneGeometry(0.4, 0.4), new MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    m.userData.t = k / 12;
    group.add(m);
    owned.push(m.geometry, m.material as Material);
    return m;
  });
  const light = new PointLight(new Color("#ff9a48"), 0, 7, 2);
  light.position.y = 0.5;
  group.add(light);
  const glows: MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined;
    if (m instanceof MeshStandardMaterial && (m.name === "fire" || m.name === "flame") && !glows.includes(m)) glows.push(m);
  });
  const base = glows.map((m) => m.emissiveIntensity);
  let t = 0;
  return {
    update: (dt, camera) => {
      t += dt;
      for (const m of flames) {
        const f = 0.75 + 0.25 * Math.sin(t * 9 + m.userData.ph) + 0.15 * Math.sin(t * 23 + m.userData.ph * 2);
        m.scale.set(0.8 + 0.2 * f, f, 1);
        m.position.y = 0.18 + f * 0.1;
        m.quaternion.copy(camera.quaternion);
      }
      for (const m of smoke) {
        m.userData.t = (m.userData.t + dt * 0.18) % 1;
        const s = m.userData.t;
        m.position.set(Math.sin(s * 6 + t * 0.4) * 0.2 * s, 0.5 + s * 3.2, Math.cos(s * 5 + t * 0.3) * 0.2 * s);
        m.scale.setScalar(0.5 + s * 3.5);
        (m.material as MeshBasicMaterial).opacity = 0.32 * Math.sin(Math.PI * s);
        m.quaternion.copy(camera.quaternion);
      }
      const f = 0.8 + 0.12 * Math.sin(t * 8.1) + 0.08 * Math.sin(t * 17.3 + 1);
      light.intensity = 3 * f;
      glows.forEach((m, k) => { m.emissiveIntensity = base[k] * f; });
    },
    dispose: () => { root.remove(group); for (const o of owned) o.dispose(); },
  };
}
