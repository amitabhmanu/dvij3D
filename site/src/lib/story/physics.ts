// A small rigid-body step for the story's loose things (design §10.4): a glass
// rolling off a blanket and clattering onto the floor (novel ¶95). Gravity,
// tumbling, bouncing and friction against whatever surface lies under each of
// the body's corners, with no physics library: the body is a handful of points
// (its rims), each pushed out of the surface it has sunk into.
import { Quaternion, Vector3, type Object3D } from "three";

export type Surface = (x: number, y: number, z: number) => number | null; // the height of what's under (x, z), at or below y

export type Body = {
  obj: Object3D; // moved in place (its parent's frame)
  points: Vector3[]; // contact points in the object's own frame
  mass: number;
  inertia: number; // about any axis: near enough for a small tumbling thing
  v: Vector3;
  w: Vector3; // angular velocity, radians a second
  restitution: number;
  friction: number;
  asleep: boolean;
  /** Called on each hard knock, with how fast it struck (m/s). */
  onHit?: (speed: number) => void;
};

const G = 9.81;
const p = new Vector3(), r = new Vector3(), vp = new Vector3(), n = new Vector3(0, 1, 0), tmp = new Vector3();
const q = new Quaternion();

export function body(obj: Object3D, points: Vector3[], o: Partial<Body> = {}): Body {
  return { obj, points, mass: 0.2, inertia: 0.0004, v: new Vector3(), w: new Vector3(), restitution: 0.25, friction: 0.5, asleep: false, ...o };
}

/** Move a body on by dt seconds (in small steps), against the surface under it. */
export function step(b: Body, dt: number, under: Surface): void {
  if (b.asleep) return;
  const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / sub;
  for (let s = 0; s < sub; s++) {
    b.v.y -= G * h;
    b.obj.position.addScaledVector(b.v, h);
    const wl = b.w.length();
    if (wl > 1e-6) b.obj.quaternion.premultiply(q.setFromAxisAngle(tmp.copy(b.w).divideScalar(wl), wl * h));
    b.obj.updateMatrix();
    // each contact point below its surface: push it out, bounce it, rub it
    let hardest = 0;
    for (const local of b.points) {
      p.copy(local).applyMatrix4(b.obj.matrix); // in the parent's frame
      const top = under(p.x, p.y + 0.05, p.z);
      if (top == null || p.y >= top) continue;
      b.obj.position.y += top - p.y;
      r.copy(p).sub(b.obj.position);
      vp.copy(b.w).cross(r).add(b.v); // the point's own velocity
      const vn = vp.dot(n);
      if (vn >= 0) continue;
      hardest = Math.max(hardest, -vn);
      // an impulse along the normal, and friction across it, through the point (so it tumbles)
      const rn = tmp.copy(r).cross(n);
      const jn = (-(1 + b.restitution) * vn) / (1 / b.mass + rn.lengthSq() / b.inertia);
      const vt = vp.clone().addScaledVector(n, -vn);
      const jt = Math.min(vt.length() * b.mass * 0.5, b.friction * jn);
      const impulse = n.clone().multiplyScalar(jn);
      if (vt.lengthSq() > 1e-8) impulse.addScaledVector(vt.normalize(), -jt);
      b.v.addScaledVector(impulse, 1 / b.mass);
      b.w.add(r.clone().cross(impulse).divideScalar(b.inertia));
    }
    if (hardest > 0.6) b.onHit?.(hardest);
    b.w.multiplyScalar(1 - 0.6 * h); // air and rolling resistance
  }
  if (b.v.lengthSq() < 0.0004 && b.w.lengthSq() < 0.02 && touching(b, under)) {
    b.asleep = true;
    b.v.set(0, 0, 0);
    b.w.set(0, 0, 0);
  }
}

function touching(b: Body, under: Surface): boolean {
  return b.points.some((local) => {
    p.copy(local).applyMatrix4(b.obj.matrix);
    const top = under(p.x, p.y + 0.05, p.z);
    return top != null && p.y - top < 0.004;
  });
}
