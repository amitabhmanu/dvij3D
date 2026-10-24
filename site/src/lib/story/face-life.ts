// The attention layer of the story's people (lifelike pilot, step 0 and 3): where the eyes go, how the head follows
// them, and when they blink. What it replaces in cast.ts was a glance aside every second or two, up to 14 degrees, and
// a blink on a timer; read as nervous, darting looks away from whoever they talk to.
//
// What people do instead (and what this does):
//   - Hold the other's eyes most of the time, with small saccades between their eyes and mouth.
//   - A speaker looks away as a thought starts (a line beginning, now and then within a long one) and comes back;
//     a listener holds the gaze longer and glances off rarely.
//   - The eyes lead and the head follows, later and smoothly (the head's target eased, never snapped).
//   - Saccades take longer the further they go (about 20 ms plus 2.4 ms a degree).
//   - Both eyes aim at the point itself, so they converge on near things.
//   - Blinks come with big gaze shifts and at the ends of phrases, and otherwise every few seconds (15-20 a minute);
//     the lids drop a little as the eyes look down.
import { Quaternion, Vector3, type Bone } from "three";
import { forwardOf } from "./ik";

const v1 = new Vector3(), v2 = new Vector3(), q1 = new Quaternion();

/** A seeded, repeatable random (each person their own). */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;

export type LifeStyle = {
  /** Blinks a minute at rest (people: 15-20; Mahant stares: fewer). */
  blinks: number;
  /** How often, and how far, a speaker looks away as a thought starts (0..1, radians). */
  thought: number; away: number;
  /** Musing: looks up and out into the middle distance rather than down (the Professor, the characters sheet). */
  muses?: boolean;
};
export const STYLES: Record<string, LifeStyle> = {
  default: { blinks: 17, thought: 0.55, away: 0.22 },
  professor: { blinks: 18, thought: 0.6, away: 0.26, muses: true },
  bhavi: { blinks: 19, thought: 0.5, away: 0.2 },
  dvij: { blinks: 18, thought: 0.45, away: 0.2 },
  mahant: { blinks: 8, thought: 0.25, away: 0.12 }, // the narrow, held stare
  baldev: { blinks: 14, thought: 0.4, away: 0.2 },
};

const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

export class FaceLife {
  private rnd: () => number;
  private style: LifeStyle;
  /** The point the head turns to: eased towards what they look at (a critically damped spring). */
  private aim = new Vector3();
  private aimV = new Vector3();
  private aimed = false;
  /** The eyes' offset from the target (radians: to the left, down), now and where a saccade is taking it. */
  private eye = { yaw: 0, pitch: 0, fromYaw: 0, fromPitch: 0, toYaw: 0, toPitch: 0, t: 1, dur: 0.05 };
  /** Where the eyes rest on the face before them: 0 its eyes, 1 its mouth. */
  private onMouth = false;
  private nextSaccade = 0.8;
  /** Looking away: seconds left, and when the next thought may take them away (talking). */
  private awayLeft = 0;
  private nextThought = 0;
  private wasTalking = false;
  private quiet = 0;
  private blinkT = -1;
  private nextBlink: number;
  private sinceBlink = 0;
  /** Where the eyes look now, as an offset of the head's aim (for others to read: a test, the lids). */
  pitchDown = 0;

  constructor(readonly who: string) {
    this.rnd = rng(hash(who));
    this.style = STYLES[who.split("#")[0]] ?? STYLES.default;
    this.nextBlink = 1 + this.rnd() * 3;
  }

  private saccade(yaw: number, pitch: number) {
    const e = this.eye;
    const deg = (Math.hypot(yaw - e.yaw, pitch - e.pitch) * 180) / Math.PI;
    if (deg < 0.2) return;
    Object.assign(e, { fromYaw: e.yaw, fromPitch: e.pitch, toYaw: yaw, toPitch: pitch, t: 0, dur: 0.02 + 0.0024 * deg });
    // a big shift of gaze takes a blink with it, mostly
    if (deg > 9 && this.rnd() < 0.7) this.blink();
  }

  private blink() {
    if (this.blinkT >= 0 || this.sinceBlink < 0.6) return;
    this.blinkT = 0;
    this.sinceBlink = 0;
  }

  /** The head's target this frame (world), eased, or null if they look at nothing. `talking`: their mouth is busy. */
  headTarget(dt: number, target: Vector3 | null, talking: boolean, from?: Vector3): Vector3 | null {
    if (!target) { this.aimed = false; return null; }
    // where the head wants to point: the target, turned a share of the way of a look away (not of the eyes' small
    // saccades over the face); then eased there, so the head never snaps with the eyes
    let want = target;
    if (from && (this.awayYaw || this.awayPitch)) {
      const d = v2.copy(target).sub(from), dist = d.length();
      const side = new Vector3(d.z, 0, -d.x).normalize(); // (to the looker's left, as yaw is)
      want = this.out.copy(target).addScaledVector(side, Math.tan(this.awayYaw * this.headShare) * dist);
      want.y -= Math.tan(this.awayPitch * this.headShare) * dist;
    }
    if (!this.aimed) { this.aim.copy(want); this.aimV.set(0, 0, 0); this.aimed = true; }
    // a spring that settles in about a third of a second, without overshoot: no snaps when the speaker changes
    const w = 9;
    const dx = v1.copy(this.aim).sub(want);
    this.aimV.addScaledVector(dx, -w * w * dt).addScaledVector(this.aimV, -2 * w * dt);
    this.aim.addScaledVector(this.aimV, dt);
    if (this.aim.distanceTo(want) > 3) this.aim.copy(want); // (a jump across the room: no slow sweep)
    // the attention: thoughts starting, glances, the eyes moving over the face
    const st = this.style;
    if (talking && !this.wasTalking) { // a line begins: often they look away as they gather it
      if (this.rnd() < st.thought) this.lookAway(0.5 + this.rnd() * 0.7);
      this.nextThought = 4 + this.rnd() * 5;
    }
    if (!talking && this.wasTalking) this.quiet = 0;
    this.wasTalking = talking;
    this.quiet += dt;
    if (!talking && this.quiet > 0.25 && this.quiet - dt <= 0.25 && this.rnd() < 0.5) this.blink(); // the phrase over
    if (talking) {
      this.nextThought -= dt;
      if (this.nextThought <= 0) { if (this.rnd() < st.thought * 0.6) this.lookAway(0.4 + this.rnd() * 0.6); this.nextThought = 4 + this.rnd() * 5; }
    } else if (this.awayLeft <= 0) {
      this.nextThought -= dt;
      if (this.nextThought <= 0) { if (this.rnd() < 0.35) this.lookAway(0.35 + this.rnd() * 0.3, 0.4); this.nextThought = 8 + this.rnd() * 8; }
    }
    if (this.awayLeft > 0) {
      this.awayLeft -= dt;
      if (this.awayLeft <= 0) { this.saccade(0, this.onMouth ? 0.06 : 0); this.awayYaw = this.awayPitch = 0; this.nextSaccade = 0.8 + this.rnd(); }
    } else {
      this.nextSaccade -= dt;
      if (this.nextSaccade <= 0) { // between the other's eyes and mouth, mostly the eyes
        this.onMouth = !this.onMouth && this.rnd() < 0.3;
        const jitter = (this.rnd() - 0.5) * 0.02;
        this.saccade(jitter, this.onMouth ? 0.06 : (this.rnd() - 0.5) * 0.015);
        this.nextSaccade = 0.6 + this.rnd() * 1.4;
      }
    }
    return this.aim;
  }
  private awayYaw = 0;
  private awayPitch = 0;
  private out = new Vector3();

  private lookAway(seconds: number, scale = 1) {
    const st = this.style, side = this.rnd() < 0.5 ? -1 : 1;
    const yaw = side * st.away * (0.6 + this.rnd() * 0.4) * scale;
    const pitch = (st.muses && this.rnd() < 0.6 ? -1 : 1) * (0.06 + this.rnd() * 0.08) * scale; // (down to think; up and out to muse)
    this.saccade(yaw, pitch);
    this.awayYaw = yaw;
    this.awayPitch = pitch;
    this.awayLeft = seconds;
  }

  /** How far the head follows a look away (the eyes go all the way). */
  get headShare() { return 0.35; }

  /** Turn the eyes (on their own bones, posed after the head) at the target, with the offset; returns the lids'
   * closure for the blink shapes (0..1). */
  eyes(dt: number, head: Bone, eyeL: Bone | undefined, eyeR: Bone | undefined, target: Vector3 | null, bend: (b: Bone, axis: Vector3, rad: number) => void): number {
    const e = this.eye;
    if (e.t < 1) {
      e.t = Math.min(1, e.t + dt / e.dur);
      const k = ease(e.t);
      e.yaw = e.fromYaw + (e.toYaw - e.fromYaw) * k;
      e.pitch = e.fromPitch + (e.toPitch - e.fromPitch) * k;
    }
    let lid = 0;
    if (eyeL && eyeR) {
      const fwd = forwardOf(head, v1);
      const hq = head.getWorldQuaternion(q1);
      const bind = (head.userData.lookBindInv as Quaternion) ?? new Quaternion();
      const rel = hq.clone().multiply(bind);
      const left = new Vector3(1, 0, 0).applyQuaternion(rel), up = new Vector3(0, 1, 0).applyQuaternion(rel);
      let pitchSum = 0;
      for (const b of [eyeL, eyeR]) {
        let yaw = e.yaw, pitch = e.pitch;
        if (target) { // at the point itself, from this eye: so the two converge on near things
          const d = v2.copy(target).sub(b.getWorldPosition(new Vector3())).normalize();
          yaw += Math.atan2(d.dot(left), d.dot(fwd));
          pitch += Math.atan2(-d.dot(up), Math.hypot(d.dot(left), d.dot(fwd)));
        }
        yaw = Math.max(-0.6, Math.min(0.6, yaw));
        pitch = Math.max(-0.35, Math.min(0.45, pitch));
        bend(b, up.clone(), yaw);
        bend(b, left.clone(), pitch);
        pitchSum += pitch;
      }
      this.pitchDown = pitchSum / 2;
      lid = Math.max(0, Math.min(0.35, this.pitchDown * 0.8)); // the upper lids follow the eyes down
    }
    // blinks: with gaze shifts and phrase ends (above), else every few seconds
    this.sinceBlink += dt;
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink(); this.nextBlink = (60 / this.style.blinks) * (0.5 + this.rnd()); }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT;
      blink = t < 0.07 ? t / 0.07 : t < 0.1 ? 1 : Math.max(0, 1 - (t - 0.1) / 0.14); // shut fast, open slower
      if (t > 0.24) this.blinkT = -1;
    }
    return Math.max(lid, blink);
  }
}
