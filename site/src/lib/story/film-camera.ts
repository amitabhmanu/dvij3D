// The camera of someone else's film (design §10.4.1). It keeps to the person
// whose film it is: over their shoulder on whoever speaks to them, the reverse
// angle on them as they speak (on the same side of the line, so the two keep
// their places on screen), behind them as they walk, and a close-up when the
// script asks for one (`camera: {for: <who>, shot: eyes, of: <who>}`). It swings
// round walls rather than through them.
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
  private kind = "listen";
  private was: Vector3 | null = null;
  private moving = 0;

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
      if (d < near && (d < 2 || h.clone().sub(head).setY(0).dot(ahead) > -0.2 * d)) { best = a; near = d; } // (someone close counts, even behind)
    }
    return best ? best.headAt() : head.clone().addScaledVector(ahead, 3).add(new Vector3(0, -0.25, 0));
  }

  private close: Actor | null = null;
  /** A close-up of someone's eyes, held until the next shot (null: back to over the shoulder). A cut, not a move. */
  shoot(eyes: Actor | null) { this.close = eyes; this.last = 0; }

  /** Cut: the next frame is placed at once, not eased there (a new scene). */
  cut() { this.last = 0; this.frame = 0; this.swing = 0; this.was = null; this.moving = 0; }

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
  private out(back: Vector3, a: number, f: { side: number; back: number; up: number }): Vector3 {
    const d = back.clone().applyAxisAngle(UPWARD, a);
    return d.multiplyScalar(f.back).addScaledVector(new Vector3(-d.z, 0, d.x).normalize(), f.side).add(new Vector3(0, f.up, 0));
  }

  /** The shot for this moment: over their shoulder on whoever speaks to them (listen), over the listener's
   * shoulder on them as they speak (speak, the reverse angle, kept on the same side of the line between the
   * two), or behind them as they walk (walk). */
  private frameFor(me: Actor, dt: number): { from: Actor; on: Vector3; side: number; back: number; up: number; kind: string } {
    const head = me.headAt();
    // walking: their head moving, with no one speaking
    const speed = this.was ? Math.hypot(head.x - this.was.x, head.z - this.was.z) / Math.max(dt, 1e-3) : 0;
    this.was = head.clone();
    this.speed = speed;
    this.moving = speed > 0.45 ? Math.min(1, this.moving + dt * 2) : Math.max(0, this.moving - dt * 1.5);
    const s = this.shot.speaker();
    // two people too close for one to be seen over the other's shoulder: both, from the side
    const partner = s && s !== me && s.visible ? s : this.listener(me);
    if (partner && Math.hypot(partner.headAt().x - head.x, partner.headAt().z - head.z) < 1.2) {
      return { from: partner, on: head, side: 0, back: 0, up: 0, kind: "two" };
    }
    if (s === me) {
      const to = this.listener(me);
      if (to) return { from: to, on: head, side: -SIDE, back: BACK, up: UP, kind: "speak" };
    }
    if (!s && this.moving > 0.5) {
      return { from: me, on: head.clone().addScaledVector(me.facing(), 2.5).add(new Vector3(0, -0.3, 0)), side: 0.2, back: 2.4, up: 0.7, kind: "walk" };
    }
    return { from: me, on: this.focus(me), side: SIDE, back: BACK, up: UP, kind: "listen" };
  }

  private side = 1;
  private blocked = false;
  private speed = 0; // how fast the head is going (m/s, on the clock): a camera that keeps up with a sped-up walk
  /** The two-shot: side on to the pair, on the side of the line the other shots keep to, unless a wall is there. */
  private two(camera: PerspectiveCamera, me: Actor, other: Actor, dt: number, cut: boolean) {
    const a = me.headAt(), b = other.headAt();
    const mid = a.clone().add(b).multiplyScalar(0.5).add(new Vector3(0, -0.2, 0));
    const line = b.clone().sub(a).setY(0).normalize();
    const across = new Vector3(-line.z, 0, line.x);
    if (this.frame++ % 6 === 0) {
      const room = (k: number) => this.clear(mid, across.clone().multiplyScalar(k).add(new Vector3(0, 0.15, 0)), 2.3);
      const here = room(this.side), there = room(-this.side);
      if (there > here + 0.3) this.side = -this.side;
      this.reach = Math.max(0.6, Math.max(here, there)) / 2.3;
    }
    const want = mid.clone().addScaledVector(across, this.side * 2.3 * this.reach).add(new Vector3(0, 0.35, 0));
    const ease = 1 - Math.exp(-dt * 3);
    if (dt >= 1 || cut) { this.at.copy(want); this.aim.copy(mid); }
    else { this.at.lerp(want, ease); this.aim.lerp(mid, ease); }
    camera.position.copy(this.at);
    camera.lookAt(this.aim);
    camera.updateMatrixWorld();
  }

  /** Whom they are speaking to: the nearest one in front of them. */
  private listener(me: Actor): Actor | null {
    const head = me.headAt(), ahead = me.facing();
    let best: Actor | null = null, near = 6;
    for (const a of this.shot.others()) {
      if (a === me || !a.visible) continue;
      const h = a.headAt(), d = h.distanceTo(head);
      if (d < near && (d < 2 || h.clone().sub(head).setY(0).dot(ahead) > -0.2 * d)) { best = a; near = d; } // (someone close counts, even behind)
    }
    return best;
  }

  /** Place the camera (game.ts's Body.film calls this each frame). */
  rig = (camera: PerspectiveCamera) => {
    const me = this.shot.who();
    if (!me) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1;
    this.last = now;
    if (this.close) {
      // straight on, a hand's breadth wider than the eyes: the face fills the frame
      const eyes = this.close.headAt().add(new Vector3(0, -0.07, 0)); // (headAt is a little above the eyes)
      camera.position.copy(eyes).addScaledVector(this.close.facing(), 0.3);
      camera.lookAt(eyes);
      camera.updateMatrixWorld();
      this.at.copy(camera.position);
      this.aim.copy(eyes);
      return;
    }
    const f = this.frameFor(me, dt);
    const cut = f.kind !== this.kind && [f.kind, this.kind].some((k) => k === "speak" || k === "two");
    if (cut) { this.kind = f.kind; this.frame = 0; this.swing = 0; }
    this.kind = f.kind;
    if (f.kind === "two") return this.two(camera, me, f.from, dt, cut);
    const head = f.from.headAt();
    const look = f.on;
    // behind the shoulder away from what they look at, and a little above
    const back = head.clone().sub(look).setY(0);
    if (back.lengthSq() < 1e-4) back.copy(f.from.facing()).negate();
    back.normalize();
    // not through a wall: if straight behind is blocked, swing round to where there's room (checked every few frames)
    if (this.frame++ % 6 === 0) {
      const room = (a: number) => { const o = this.out(back, a, f); return this.clear(head, o, o.length()) / o.length(); };
      let best = this.swing, most = room(this.swing);
      if (most < 0.85) {
        for (const a of SWINGS) {
          const r = room(a);
          if (r > most + 0.05) { best = a; most = r; }
        }
      }
      this.swing = best;
      this.reach = Math.max(0.25, most);
    }
    // every frame, not every few: through a doorway the room behind them closes in fast. The camera comes in short of
    // a wall behind them, and if a wall has come between it and them (the camera still easing round), it cuts past it.
    const out = this.out(back, this.swing, f), room = this.clear(head, out, out.length()) / out.length();
    const to = this.at.clone().sub(head), len = to.length();
    if (len > 0.5 && this.clear(head, to, len) < len - 0.35) this.blocked = true;
    const want = head.clone().add(out.multiplyScalar(Math.max(0.15, Math.min(this.reach, room))));
    const ease = 1 - Math.exp(-dt * (3 + Math.min(12, this.speed)));
    if (dt >= 1 || cut || this.blocked || this.at.distanceTo(want) > 8) { this.at.copy(want); this.aim.copy(look); this.blocked = false; }
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
