// Two-bone IK for the cast's arms (graphics phase 5): a hand to a point in the world, the elbow
// bent towards a pole, as Dvij's own arms do it (walk/arms.ts), and a head turned to look, within
// what a neck allows. Both work on bones the animation has already posed this frame.
import { Quaternion, Vector3, type Bone } from "three";

const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), q1 = new Quaternion(), q2 = new Quaternion(), q3 = new Quaternion();

/** Turn `bone` so that its child, now at `childWorld`, points at `toWorld`. */
export function aim(bone: Bone, childWorld: Vector3, toWorld: Vector3) {
  const at = bone.getWorldPosition(v1);
  const from = v2.copy(childWorld).sub(at).normalize();
  const to = v3.copy(toWorld).sub(at).normalize();
  const world = bone.getWorldQuaternion(q2).premultiply(q1.setFromUnitVectors(from, to));
  bone.quaternion.copy(bone.parent!.getWorldQuaternion(q3).invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** Put the hand at the end of upper and lower at `goal` (world), the elbow out towards `pole`
 * (a world direction), blended by `weight` with the pose they had. */
export function reach(upper: Bone, lower: Bone, hand: Bone, goal: Vector3, pole: Vector3, weight: number) {
  if (weight <= 0.001) return;
  const was = [upper.quaternion.clone(), lower.quaternion.clone()];
  const shoulder = upper.getWorldPosition(new Vector3());
  const elbowNow = lower.getWorldPosition(new Vector3()), handNow = hand.getWorldPosition(new Vector3());
  const l1 = shoulder.distanceTo(elbowNow), l2 = elbowNow.distanceTo(handNow);
  const toGoal = goal.clone().sub(shoulder);
  const d = Math.min(Math.max(toGoal.length(), 0.05), (l1 + l2) * 0.999);
  const u = toGoal.normalize();
  const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  aim(upper, elbowNow, shoulder.clone().addScaledVector(u, a).addScaledVector(p, h));
  aim(lower, hand.getWorldPosition(new Vector3()), shoulder.clone().addScaledVector(u, d));
  if (weight < 0.999) {
    upper.quaternion.copy(was[0].slerp(upper.quaternion, weight));
    lower.quaternion.copy(was[1].slerp(lower.quaternion, weight));
    upper.updateMatrixWorld(true);
  }
}

/** Turn the neck and head towards `target` (world), no more than `yaw` and `pitch` radians either
 * way from where the body faces, by `weight`. `forward` is the body's facing (world, unit). */
export function look(neck: Bone, head: Bone, target: Vector3, forward: Vector3, weight: number, yaw = 1.2, pitch = 0.5) {
  if (weight <= 0.001) return;
  const eye = head.getWorldPosition(new Vector3());
  const want = target.clone().sub(eye);
  // clamp the direction to what a neck can turn, relative to the body's facing
  const flat = Math.hypot(want.x, want.z) || 1e-6;
  let ang = Math.atan2(want.x, want.z) - Math.atan2(forward.x, forward.z);
  ang = Math.atan2(Math.sin(ang), Math.cos(ang));
  ang = Math.max(-yaw, Math.min(yaw, ang));
  const el = Math.max(-pitch, Math.min(pitch, Math.atan2(want.y, flat)));
  const base = Math.atan2(forward.x, forward.z) + ang;
  const dir = new Vector3(Math.sin(base) * Math.cos(el), Math.sin(el), Math.cos(base) * Math.cos(el));
  // where the head looks now: the body's ahead (+z in its own frame), carried by the head as it is posed
  const headQ = head.getWorldQuaternion(new Quaternion());
  const nowDir = new Vector3(0, 0, 1).applyQuaternion(q1.copy(headQ).multiply(BIND_INV(head)));
  const turn = new Quaternion().setFromUnitVectors(nowDir.normalize(), dir);
  // split it: a third to the neck, the rest to the head
  for (const [b, k] of [[neck, 0.35], [head, 0.65]] as [Bone, number][]) {
    const part = new Quaternion().slerp(turn, k * weight);
    const world = b.getWorldQuaternion(new Quaternion()).premultiply(part);
    b.quaternion.copy(b.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    b.updateMatrixWorld(true);
  }
}

/** The inverse of a head's world rotation in the rest pose, relative to its body: kept on the bone. */
function BIND_INV(head: Bone): Quaternion {
  return (head.userData.lookBindInv as Quaternion) ?? new Quaternion();
}

/** Remember, for `look`, how the head sits in the body when the body faces `forward`. Call once, at rest. */
export function bindLook(head: Bone, root: { getWorldQuaternion(q: Quaternion): Quaternion }) {
  const rel = root.getWorldQuaternion(new Quaternion()).invert().multiply(head.getWorldQuaternion(new Quaternion()));
  head.userData.lookBindInv = rel.invert();
}
