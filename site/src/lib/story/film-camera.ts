// The camera of someone else's film (design §10.4.1): over the shoulder of the
// person whose film it is, on whoever speaks or whatever is near them. A first
// cut for the pilot; the Professor's own shots (follow, listen, low, insert)
// come next.
import { Object3D, PerspectiveCamera, Raycaster, Vector3 } from "three";
import type { Actor } from "./cast";

/** What the camera watches each frame. */
export type Shot = {
  /** The person whose film it is. */
  who: () => Actor | null;
  /** Who is speaking, if anyone. */
  speaker: () => Actor | null;
  /** Everyone else on stage, to find whom they face when no one speaks. */
  others: () => Actor[];
  /** What the camera mustn't pass through (the lodge's walls). */
  walls: () => Object3D | null;
};

const BACK = 1.5, UP = 0.32, SIDE = 0.45;

export class FilmCamera {
  private at = new Vector3();
  private aim = new Vector3();
  private last = 0;
  private reach = 1;
  private swing = 0;
  private frame = 0;
  private ray = new Raycaster();

  constructor(private shot: Shot) {}

  /** Where the camera looks: the speaker's face, or the face of whoever is nearest in front of them. */
  private focus(me: Actor): Vector3 {
    const head = me.headAt();
    const s = this.shot.speaker();
    if (s && s !== me && s.visible) return s.headAt();
    const ahead = me.facing();
    let best: Actor | null = null, near = 5;
    for (const a of this.shot.others()) {
      if (a === me || !a.visible) continue;
      const h = a.headAt(), d = h.distanceTo(head);
      if (d < near && h.clone().sub(head).setY(0).dot(ahead) > -0.2 * d) { best = a; near = d; }
    }
    return best ? best.headAt() : head.clone().addScaledVector(ahead, 3).add(new Vector3(0, -0.25, 0));
  }

  /** Cut: the next frame is placed at once, not eased there (a new scene). */
  cut() { this.last = 0; this.frame = 0; this.swing = 0; }

  /** How far the camera can stand from `head` along `dir` before a wall (metres, up to `len`). */
  private clear(head: Vector3, dir: Vector3, len: number): number {
    const walls = this.shot.walls();
    if (!walls) return len;
    this.ray.set(head, dir.clone().normalize());
    this.ray.far = len + 0.3;
    const hit = this.ray.intersectObject(walls, true).find((h) => !inCast(h.object));
    return hit ? Math.max(0, hit.distance - 0.3) : len;
  }

  /** The way out from the head to the camera, swung `a` radians round from straight behind. */
  private out(back: Vector3, a: number): Vector3 {
    const d = back.clone().applyAxisAngle(UPWARD, a);
    return d.multiplyScalar(BACK).addScaledVector(new Vector3(-d.z, 0, d.x).normalize(), SIDE).add(new Vector3(0, UP, 0));
  }

  /** Place the camera (game.ts's Body.film calls this each frame). */
  rig = (camera: PerspectiveCamera) => {
    const me = this.shot.who();
    if (!me) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1;
    this.last = now;
    const head = me.headAt();
    const look = this.focus(me);
    // behind the shoulder away from what they look at, and a little above
    const back = head.clone().sub(look).setY(0);
    if (back.lengthSq() < 1e-4) back.copy(me.facing()).negate();
    back.normalize();
    // not through a wall: if straight behind is blocked, swing round to where there's room (checked every few frames)
    if (this.frame++ % 6 === 0) {
      const room = (a: number) => { const o = this.out(back, a); return this.clear(head, o, o.length()) / o.length(); };
      let best = this.swing, most = room(this.swing);
      if (most < 0.7) {
        for (const a of SWINGS) {
          const r = room(a);
          if (r > most + 0.05) { best = a; most = r; }
        }
      }
      this.swing = best;
      this.reach = Math.max(0.25, most);
    }
    const want = head.clone().add(this.out(back, this.swing).multiplyScalar(this.reach));
    const ease = 1 - Math.exp(-dt * 3);
    if (dt >= 1 || this.at.distanceTo(want) > 8) { this.at.copy(want); this.aim.copy(look); }
    else { this.at.lerp(want, ease); this.aim.lerp(look, ease); }
    camera.position.copy(this.at);
    camera.lookAt(this.aim);
    camera.updateMatrixWorld();
  };
}

const UPWARD = new Vector3(0, 1, 0);
/** Where to try the camera when straight behind is blocked: round one side, then the other. */
const SWINGS = [0, 0.6, -0.6, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2];

/** The people don't push the camera in: only walls, furniture and the land do. */
const inCast = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.name === "cast") return true;
  return false;
};
