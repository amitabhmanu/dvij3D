// The life of a body between its beats (lifelike pilot, step 3): what a still person does that a looping clip doesn't.
//   - Breath: the chest rises and falls about 15 times a minute, the shoulders with it; a little deeper as a line begins.
//   - Weight shifts: a standing person moves their weight from foot to foot every 4-10 s; the hips slide and drop over the
//     loaded leg while the feet stay planted where they were (the legs put back on them by IK, ik.ts).
//   - The chest joins a big turn of the gaze: past what the neck alone turns, the upper back takes a share.
// Each person their own rhythm (seeded by name). Costs a few bone turns a frame.
import { Quaternion, Vector3, type Bone, type Object3D } from "three";
import { reach } from "./ik";

const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 11) >>> 0;

/** How a person stands and breathes: the slow and the old shift less and breathe slower. */
const MANNER: Record<string, { breath: number; shift: number; every: [number, number] }> = {
  default: { breath: 0.25, shift: 0.025, every: [4, 9] },
  professor: { breath: 0.22, shift: 0.022, every: [5, 10] },
  bhavi: { breath: 0.27, shift: 0.03, every: [3.5, 7] }, // (light and quick)
  dvij: { breath: 0.24, shift: 0.028, every: [4, 8] },
  mahant: { breath: 0.2, shift: 0.012, every: [7, 12] }, // (upright, measured)
  baldev: { breath: 0.23, shift: 0.03, every: [4, 8] },
};

export type Body = {
  bone: (n: string) => Bone | undefined;
  obj: Object3D;
  bend: (b: Bone, axis: Vector3, rad: number) => void;
};

export class IdleLife {
  private rnd: () => number;
  private m: (typeof MANNER)["default"];
  private t: number;
  /** The weight: -1 on the left foot, +1 on the right; where it is going and how long it takes. */
  private w = { now: 0, from: 0, to: 0, k: 1, dur: 1, next: 2 };
  private moved = new Vector3();
  private breathe = 0;

  constructor(who: string) {
    this.rnd = rng(hash(who));
    this.m = MANNER[who.split(/[#-]/)[0]] ?? MANNER.default;
    this.t = this.rnd() * 10;
    this.w.next = this.m.every[0] * this.rnd();
  }

  /** Before the clips play: take back last frame's slide of the hips (a clip without a track for them leaves it). */
  undo(b: Body) {
    const pelvis = b.bone("pelvis");
    if (pelvis && this.moved.lengthSq()) { pelvis.position.sub(this.moved); this.moved.set(0, 0, 0); }
  }

  /** After the clips and the gestures: the breath, and if `standing` still, the weight from foot to foot. `talking`
   * starts a line with a deeper breath. */
  apply(dt: number, b: Body, standing: boolean, talking: boolean, began: boolean) {
    this.t += dt;
    const m = this.m;
    // the breath: a slow sine, the in-breath a little quicker than the out; a deeper one as a line begins
    if (began) this.breathe = 1;
    this.breathe = Math.max(0, this.breathe - dt * 0.5);
    const phase = (this.t * m.breath) % 1;
    const wave = phase < 0.42 ? ease(phase / 0.42) : 1 - ease((phase - 0.42) / 0.58);
    const deep = 1 + this.breathe * 0.8 + (talking ? 0.15 : 0);
    const body = b.obj;
    const q = body.getWorldQuaternion(new Quaternion());
    const right = new Vector3(-1, 0, 0).applyQuaternion(q), ahead = new Vector3(0, 0, 1).applyQuaternion(q);
    const chest = b.bone("spine_03"), upper = b.bone("spine_02");
    if (chest) b.bend(chest, right.clone(), -0.018 * wave * deep); // (the chest lifts and opens back a little)
    if (upper) b.bend(upper, right.clone(), -0.006 * wave * deep);
    for (const s of ["l", "r"] as const) {
      const c = b.bone(`clavicle_${s}`);
      if (c) b.bend(c, ahead.clone(), (s === "l" ? -1 : 1) * 0.018 * wave * deep); // (the shoulders ride up with it)
    }
    // the weight from foot to foot, the feet kept where they stand
    const w = this.w;
    if (!standing) { w.now *= Math.max(0, 1 - dt * 2); return; }
    w.next -= dt;
    if (w.next <= 0 && w.k >= 1) {
      w.from = w.now;
      w.to = (w.now > 0 ? -1 : 1) * (0.5 + this.rnd() * 0.5) * (this.rnd() < 0.2 ? 0 : 1); // (now and then back to both feet)
      w.k = 0;
      w.dur = 0.9 + this.rnd() * 0.7;
      w.next = m.every[0] + this.rnd() * (m.every[1] - m.every[0]);
    }
    if (w.k < 1) { w.k = Math.min(1, w.k + dt / w.dur); w.now = w.from + (w.to - w.from) * ease(w.k); }
    const pelvis = b.bone("pelvis");
    if (!pelvis || Math.abs(w.now) < 0.01) return;
    const feet = (["l", "r"] as const).map((s) => [b.bone(`thigh_${s}`), b.bone(`calf_${s}`), b.bone(`foot_${s}`)] as const);
    if (feet.some((f) => f.some((x) => !x))) return;
    const planted = feet.map((f) => f[2]!.getWorldPosition(new Vector3()));
    // slide the hips over the loaded foot (to the body's right is -x in its own frame), and drop the other hip
    const slide = right.clone().multiplyScalar(w.now * m.shift);
    const local = pelvis.parent!.worldToLocal(pelvis.getWorldPosition(new Vector3()).add(slide)).sub(pelvis.position);
    pelvis.position.add(local);
    this.moved.copy(local);
    pelvis.updateMatrixWorld(true);
    b.bend(pelvis, ahead.clone(), -w.now * 0.035);
    const spine = b.bone("spine_01");
    if (spine) b.bend(spine, ahead.clone(), w.now * 0.045); // (the back straightens the chest back over the hips)
    feet.forEach(([thigh, calf, foot], i) => {
      const knee = ahead.clone().add(new Vector3(0, 0.1, 0)).add(right.clone().multiplyScalar(i ? 0.15 : -0.15));
      reach(thigh!, calf!, foot!, planted[i], knee, 1);
    });
  }

  /** The chest turned a share of the way to a look that is more than the neck turns (radians off the body's ahead). */
  chestTo(b: Body, target: Vector3 | null, weight: number) {
    const chest = b.bone("spine_03");
    if (!chest || !target || weight < 0.01) return;
    const at = chest.getWorldPosition(new Vector3()), body = b.obj;
    const f = new Vector3(0, 0, 1).applyQuaternion(body.getWorldQuaternion(new Quaternion()));
    let off = Math.atan2(target.x - at.x, target.z - at.z) - Math.atan2(f.x, f.z);
    off = Math.atan2(Math.sin(off), Math.cos(off));
    const beyond = Math.sign(off) * Math.max(0, Math.abs(off) - 0.55);
    if (beyond) b.bend(chest, new Vector3(0, 1, 0), beyond * 0.35 * weight);
  }
}
