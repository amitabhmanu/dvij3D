// The glass of water (novel ¶94-95, comic b1-p004-3): a real tumbler, thick-based
// with a rounded rim, half full on the bedside stool. Dvij lifts it, spills most of
// it over the pillows, gulps the rest, and lets it "roll down the blanket and a
// clatter onto the floor". It falls with physics.ts; if a script lets it break, it
// shatters into shards and its water spreads across the floor.
import {
  CircleGeometry, Color, DoubleSide, Group, LatheGeometry, Mesh, MeshPhysicalMaterial, Shape, ShapeGeometry,
  Vector2, Vector3, type Object3D,
} from "three";
import { body, step, type Body, type Surface } from "./physics";

export type World = { surface: Surface; sound: (name: string) => void };

const GLASS = new MeshPhysicalMaterial({
  color: new Color("#e4efee"), transparent: true, opacity: 0.3, roughness: 0.04, metalness: 0,
  specularIntensity: 1, envMapIntensity: 2.5, side: DoubleSide, depthWrite: false,
});
const WATER = new MeshPhysicalMaterial({ color: new Color("#9cc0c6"), transparent: true, opacity: 0.55, roughness: 0.03, envMapIntensity: 2, depthWrite: false });

const H = 0.11, BASE = 0.012, R = 0.034; // a tumbler: 11 cm tall, a 12 mm base, 6.8 cm across

/** The tumbler's wall, turned on a lathe: the base, the outside up to a rounded rim, back down the inside. */
function tumbler(): LatheGeometry {
  const pts = [
    [0, 0], [R - 0.004, 0], [R - 0.0025, 0.001], [R - 0.003, 0.004], // the base's bevelled foot
    [R, H - 0.004], [R + 0.0006, H - 0.0012], [R - 0.0012, H], [R - 0.0028, H - 0.0012], // the rim, rounded
    [R - 0.0035, BASE + 0.003], [R - 0.0055, BASE], [0, BASE], // the inside wall and the thick base
  ].map(([r, y]) => new Vector2(r, y));
  return new LatheGeometry(pts, 28);
}

export type Glass = {
  obj: Group;
  /** The water's level: 0 empty to 1 full. */
  level: (f: number) => void;
  /** Let it go, from wherever it is now (lodge frame), with this push and spin. */
  drop: (v: Vector3, w: Vector3, breaks: boolean) => void;
  update: (dt: number) => void;
  shattered: () => boolean;
  dispose: () => void;
};

export function makeGlass(world: World | null): Glass {
  const obj = new Group();
  const wall = new Mesh(tumbler(), GLASS);
  const water = new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(R - 0.0045, 0), new Vector2(R - 0.004, 1), new Vector2(0, 1)], 24), WATER);
  water.position.y = BASE;
  obj.add(water, wall);
  wall.renderOrder = 2; // the glass over its water
  const level = (f: number) => { water.visible = f > 0.02; water.scale.y = Math.max(0.001, f * (H - BASE - 0.008)); };
  level(0.5); // "the half-full glass" (¶94)

  let falling: Body | null = null;
  let breaks = false;
  const shards: Body[] = [];
  let puddle: Mesh | null = null, spread = 0;
  const rims = (y: number, n = 8) => Array.from({ length: n }, (_, k) => new Vector3(Math.cos((k / n) * Math.PI * 2) * R, y, Math.sin((k / n) * Math.PI * 2) * R));

  const shatter = (speed: number) => {
    if (!world || !falling) return;
    world.sound("crash");
    if (water.visible) world.sound("splash");
    const at = obj.position.clone();
    wall.visible = water.visible = false;
    const parent = obj.parent;
    // shards: a few curved slivers, flung out from where it struck
    for (let k = 0; k < 9; k++) {
      const s = new Shape();
      const a = 0.012 + Math.random() * 0.025, b = 0.01 + Math.random() * 0.03;
      s.moveTo(0, 0); s.lineTo(a, Math.random() * 0.006); s.lineTo(a * Math.random(), b); s.closePath();
      const m = new Mesh(new ShapeGeometry(s), GLASS);
      m.position.copy(at).add(new Vector3((Math.random() - 0.5) * 0.06, 0.02 + Math.random() * 0.04, (Math.random() - 0.5) * 0.06));
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      parent?.add(m);
      const dir = new Vector3(Math.random() - 0.5, 0.4 + Math.random() * 0.6, Math.random() - 0.5).normalize();
      shards.push(body(m, [new Vector3(0, 0, 0), new Vector3(a, 0, 0), new Vector3(0, b, 0)], {
        v: dir.multiplyScalar(0.4 + Math.random() * speed * 0.35), w: new Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20),
        mass: 0.004, inertia: 0.0000015, restitution: 0.2, friction: 0.7,
      }));
    }
    // and what was left of the water, spreading on the floor
    const floor = world.surface(at.x, at.y + 0.05, at.z) ?? at.y;
    puddle = new Mesh(new CircleGeometry(1, 28), WATER);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(at.x, floor + 0.002, at.z);
    puddle.scale.setScalar(0.001);
    parent?.add(puddle);
    spread = 0;
    falling = null;
  };

  return {
    obj,
    level,
    drop: (v, w, b) => {
      breaks = b;
      falling = body(obj, [...rims(0.002), ...rims(H - 0.002)], {
        v: v.clone(), w: w.clone(), mass: 0.22, inertia: 0.00035, restitution: 0.3, friction: 0.45,
        onHit: (speed) => {
          if (breaks && speed > 2.2) return shatter(speed);
          world?.sound(speed > 1.4 ? "clatter" : "clink");
        },
      });
    },
    update: (dt) => {
      if (!world) return;
      if (falling) step(falling, dt, world.surface);
      for (const s of shards) step(s, dt, world.surface);
      if (puddle && spread < 1) {
        spread = Math.min(1, spread + dt / 1.6);
        puddle.scale.setScalar(0.03 + 0.2 * (1 - (1 - spread) ** 3)); // fast, then slowing, to about 23 cm across
      }
    },
    shattered: () => !wall.visible,
    dispose: () => {
      wall.geometry.dispose();
      water.geometry.dispose();
      for (const s of shards) { (s.obj as Mesh).geometry.dispose(); s.obj.removeFromParent(); }
      if (puddle) { puddle.geometry.dispose(); puddle.removeFromParent(); }
    },
  };
}

/** A small hand-held thing: where the hand's grip sits on it (its own frame). */
export const GRIP: { glass: Vector3 } = { glass: new Vector3(0, H * 0.45, 0) };

export type Holdable = { obj: Object3D; grip: Vector3 };
