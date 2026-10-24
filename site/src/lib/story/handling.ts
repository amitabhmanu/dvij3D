// Picking things up, showing them and putting them down (lifelike pilot, step 0): one clean reach to where the thing
// really lies, the palm on it, lifted, and no grab at the air. What cast.ts did before was play the clip library's
// table-height grab wherever the person stood, and put the thing in the hand at the end, or nothing if it had no handle.
//
// The person walks up to it (stopping a forearm's length short, the thing to their right hand), turns to it, bends (a
// crouch for the floor, a lean for a desk), reaches with the right hand by IK so the palm's middle lands on the thing's
// middle, takes it, straightens with it held before the chest, and walks back to where they were.
import { Box3, Vector3, type Object3D } from "three";
import type { Actor, Gesture, V2 } from "./cast";

const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** A thing's middle (world). */
export function middleOf(o: Object3D): Vector3 {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o).getCenter(new Vector3());
}

/** How far from a thing to stand to reach it (m, from the feet to it, flat), low (the floor) or at a desk's height. */
const STAND_OFF = { low: 0.4, high: 0.48 };
/** The palm's middle is this far beyond the wrist (m): the hand bone's goal is short of the thing by this. */
const PALM = 0.075;

/** The reach: bend to `goal` (world), the palm onto it, `touch()` at the moment it is there, then straighten. */
function reachTo(goal: Vector3, low: boolean, touch: () => void, hand: (a: Actor) => Vector3): Gesture {
  let done = false;
  const at = (a: Actor, t: number) => {
    if (!done && t >= 0.46) { done = true; touch(); }
    const sh = a.shoulder();
    const dir = goal.clone().sub(sh).normalize();
    const wrist = goal.clone().addScaledVector(dir, -PALM).add(new Vector3(0, 0.015, 0));
    const after = ease((t - 0.52) / 0.38);
    const to = done ? wrist.lerp(hand(a), after) : wrist;
    const bend = (low ? 0.5 : 0.38) * (done ? 1 - after * 0.85 : ease(t / 0.4));
    return { spine: bend, head: 0.3 * (done ? 1 - after : 1), handR: to };
  };
  return { seconds: low ? 2.6 : 2.0, clip: low ? "Crouch_Idle_Loop" : undefined, at };
}

/** Walk up to a world point to work at it, if not already there; turn to it. Returns where they started (frame). */
async function goTo(a: Actor, p: Vector3, low: boolean): Promise<V2 | null> {
  const frame = a.obj.parent!;
  const me = a.obj.getWorldPosition(new Vector3());
  const flat = new Vector3(p.x - me.x, 0, p.z - me.z);
  const off = low ? STAND_OFF.low : STAND_OFF.high;
  const start = a.where();
  let moved: V2 | null = null;
  if (flat.length() > off + 0.15) {
    const dir = flat.clone().normalize();
    // stop short of it, a little to its left, so it comes to the right hand
    const stop = p.clone().addScaledVector(dir, -off).addScaledVector(new Vector3(dir.z, 0, -dir.x), 0.1);
    const s = frame.worldToLocal(stop);
    await a.walk([s.x, s.z]);
    moved = start;
  }
  const t = frame.worldToLocal(p.clone());
  await a.turnTo([t.x, t.z], 0.5);
  return moved;
}

/** Pick `item` up where it lies (world), and come back with it. */
export async function pickUp(a: Actor, item: Object3D, hurried: boolean): Promise<void> {
  item.userData.home ??= item.parent; // (where it goes back to, put down)
  if (hurried || !item.parent || item.parent === a.obj) { a.hold(item); return; }
  const at = middleOf(item);
  const floor = a.obj.getWorldPosition(new Vector3()).y;
  const low = at.y - floor < 0.55;
  const back = await goTo(a, at, low);
  await a.perform(reachTo(at, low, () => a.hold(item), (x) => x.point(0.12, 1.05, 0.3)));
  if (back) await a.walk(back);
}

/** Put what the right hand holds down on `at` (world: the surface under it), and come back. */
export async function putDown(a: Actor, at: Vector3, hurried: boolean): Promise<void> {
  const into = a.carriedHome();
  if (!into) return;
  if (hurried) { a.release(into, at); return; }
  const floor = a.obj.getWorldPosition(new Vector3()).y;
  const low = at.y - floor < 0.5;
  const back = await goTo(a, at, low);
  const over = at.clone().add(new Vector3(0, a.carriedHeight() / 2, 0));
  await a.perform(reachTo(over, low, () => a.release(into, at), (x) => x.point(0.12, 0.95, 0.22)));
  if (back) await a.walk(back);
}

/** Holding something up to show it to him: before the face, turned to him (a held gesture's layer). */
export function show(a: Actor) {
  return { head: 0.06, handR: a.toward(a.eyesOf(), 0.44, 0.1, 0.1) };
}
