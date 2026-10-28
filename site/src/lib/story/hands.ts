// What Dvij's hands do in the story (design §10.4), with his arms (walk/arms.ts): he looks at
// his plastered right arm (novel ¶96, ¶248, ¶283); his weak left hand creeps to the glass, lifts it,
// spills it, gulps the rest and lets it go (¶94-95); he takes a tumbler (¶138, ¶258); he tugs the
// shutters open and shields his eyes (¶99, comic b1-p004-5); he reaches for whatever a beat asks
// him to touch. The left hand does most: the right is in plaster from beyond the elbow.
import { Box3, Vector3, type Object3D } from "three";
import { Arms, type Side } from "../walk/arms";

type Wait = (seconds: number) => Promise<void>;
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
/** How far the fingers close round a glass or a tumbler: on its side, not through it (a fist is 1). */
const CUP_GRIP = 0.5;
const MOUTH = V(-0.03, -0.12, -0.25), LOW = V(-0.12, -0.32, -0.36);

export class Hands {
  /** What the left hand holds now, what to put it back into when it lets go, and where it came from. */
  private cup: { obj: Object3D; into: Object3D; from: Vector3; wasHidden: boolean } | null = null;

  constructor(private arms: () => Arms | null, private wait: Wait) {}

  private rest(s: Side, seconds = 0.6) {
    this.arms()?.go(s, { at: Arms.rest(s), grip: s === "l" ? 0.25 : 0.2, show: false }, seconds);
  }

  /** A world point a hand can reach: towards it, no further than an arm's length from the shoulder. */
  private reach(s: Side, world: Vector3): Vector3 {
    const a = this.arms()!;
    const at = a.toCamera(world);
    const sh = Arms.shoulder(s);
    const d = at.clone().sub(sh);
    if (d.length() > 0.6) d.setLength(0.6);
    return sh.add(d);
  }

  /** Look at the plaster on his right arm: it comes up in front of him, turning a little. */
  async lookAtArm(seconds: number) {
    const a = this.arms();
    if (!a) return;
    a.go("r", { at: V(0.05, -0.18, -0.36), grip: 0.35, show: true }, 0.7);
    await this.wait(seconds * 0.55);
    a.go("r", { at: V(0.08, -0.12, -0.34), grip: 0.15, show: true }, 0.6); // flexing it: it moves freely now (¶248, ¶283)
    await this.wait(seconds * 0.45);
    this.rest("r");
  }

  /** Reach out and touch something (a beat's target), then let the hand fall. */
  async touch(world: Vector3) {
    const a = this.arms();
    if (!a) return;
    a.go("l", { at: this.reach("l", world), grip: 0.1, show: true }, 0.55);
    await this.wait(0.6);
    a.go("l", { grip: 0.7 }, 0.3);
    await this.wait(0.45);
    this.rest("l");
  }

  /** Take a cup and drink from it: reach (or have it put in his hand), grip, lift it to his mouth and
   * tip it. `spill`, if given, is called as most of it goes over him (¶95). He keeps hold of it after:
   * let it go with `release`. */
  async drink(cup: Object3D | null, into: Object3D | null, grip: Vector3, spill: (() => void) | null, gulp: () => void) {
    const a = this.arms();
    if (!a) return;
    if (cup && into) {
      const where = cup.getWorldPosition(new Vector3());
      const far = !cup.visible || !cup.parent?.visible || a.toCamera(where).length() > 1.1;
      const from = cup.position.clone(), wasHidden = !cup.visible || !cup.parent?.visible;
      if (far) { // it is handed to him (the Professor's tumbler, ¶138): it comes into his hand
        cup.visible = true;
        if (cup.parent) cup.parent.visible = true;
      }
      // round its side: as wide as it is, the fingers closing only so far (Ch1: they had closed through the glass)
      const size = new Box3().setFromObject(cup).getSize(new Vector3());
      const radius = Math.max(0.02, Math.min(size.x, size.z) / 2);
      a.go("l", { at: far ? V(-0.1, -0.26, -0.5) : this.reach("l", where.add(grip)), grip: 0.1, show: true }, 0.9);
      await this.wait(0.95);
      a.go("l", { grip: CUP_GRIP }, 0.25);
      await this.wait(0.25);
      a.hold("l", cup, grip, undefined, radius);
      this.cup = { obj: cup, into, from, wasHidden };
    } else {
      a.go("l", { at: V(-0.1, -0.26, -0.48), grip: 0.75, show: true }, 0.6);
      await this.wait(0.6);
    }
    a.go("l", { at: MOUTH }, 0.9);
    await this.wait(0.9);
    for (let k = 1; k <= 6; k++) { a.tilt("l", (k / 6) * 1.25); await this.wait(0.12); }
    spill?.();
    gulp();
    await this.wait(0.5);
    gulp();
    await this.wait(0.5);
    for (let k = 5; k >= 0; k--) { a.tilt("l", (k / 6) * 1.25); await this.wait(0.06); }
    a.go("l", { at: LOW }, 0.6);
    await this.wait(0.6);
  }

  /** Let go of what the left hand holds: it falls with the push given (world m/s, rad/s). */
  release(push = V(0.05, 0, -0.9), spin = V(-0.9 / 0.034, 0, 0)): Object3D | null {
    const a = this.arms();
    if (!a || !this.cup) return null;
    const { obj, into } = this.cup;
    obj.userData.v = push;
    obj.userData.w = spin;
    a.hold("l", null, undefined, into);
    this.cup = null;
    this.rest("l", 0.8);
    return obj;
  }

  /** Put back what the left hand holds where it came from (or give it back, if it was handed to him). */
  putDown() {
    const a = this.arms();
    if (!a || !this.cup) return;
    const { obj, into, from, wasHidden } = this.cup;
    a.hold("l", null, undefined, into);
    obj.position.copy(from);
    obj.quaternion.identity();
    if (wasHidden) obj.visible = false;
    this.cup = null;
    this.rest("l");
  }

  holding(): Object3D | null { return this.cup?.obj ?? null; }

  /** Empty-handed, both hands at rest, at once (a scene set up again: the slider seeking). */
  reset() {
    const a = this.arms();
    this.cup = null;
    if (!a) return;
    a.hold("l", null);
    a.hold("r", null);
    for (const s of ["l", "r"] as Side[]) a.go(s, { at: Arms.rest(s), grip: s === "l" ? 0.25 : 0.2, show: false }, 0);
  }

  /** Tug at the shutters with both hands (the right as well as it can), then shield his eyes from the light. */
  async pull(world: Vector3, open: () => void) {
    const a = this.arms();
    if (!a) { open(); return; }
    for (const s of ["l", "r"] as Side[]) a.go(s, { at: this.reach(s, world).add(V(s === "l" ? -0.12 : 0.12, 0, 0)), grip: 0.2, show: true }, 0.6);
    await this.wait(0.6);
    for (const s of ["l", "r"] as Side[]) a.go(s, { grip: 0.8 }, 0.2);
    await this.wait(0.3);
    for (let k = 0; k < 2; k++) { // the stops jammed with disuse: two hard tugs
      for (const s of ["l", "r"] as Side[]) a.go(s, { at: this.reach(s, world).add(V(s === "l" ? -0.12 : 0.12, 0, 0.08)) }, 0.15);
      await this.wait(0.2);
      for (const s of ["l", "r"] as Side[]) a.go(s, { at: this.reach(s, world).add(V(s === "l" ? -0.12 : 0.12, 0, 0)) }, 0.15);
      await this.wait(0.2);
    }
    open();
    this.rest("r");
    a.go("l", { at: V(-0.02, 0.0, -0.3), grip: 0.05, show: true }, 0.3); // "one arm raised to shield his eyes" (b1-p004-5)
    await this.wait(1.4);
    this.rest("l");
  }
}
