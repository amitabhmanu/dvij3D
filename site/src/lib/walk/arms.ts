// Dvij's own arms in first person (design §10.4): Quaternius's CC0 base, in his gown's sleeves,
// his right forearm in plaster (novel ¶96, ¶98; pipeline/build_arms.py). They ride on the camera;
// each hand goes where a pose or a reach puts it, by two-bone IK (the elbow found by the law of
// cosines, bent down and out), and its fingers curl to grip. A little sway when still, a bob when
// walking. The camera's near plane is close enough (game.ts) that they never cut through themselves.
import {
  Group, Matrix4, Quaternion, Vector3, type Bone, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type PerspectiveCamera,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export type Side = "l" | "r";
/** Where a hand goes, in the camera's frame (metres: x right, y up, -z ahead), and how closed its fingers are (0 open, 1 a fist). */
export type HandPose = { at: Vector3; grip: number; show: boolean };

const FINGERS = ["index", "middle", "ring", "pinky"] as const;
/** Each arm at rest: low, out of sight unless he looks down. */
const REST: Record<Side, Vector3> = { l: new Vector3(-0.2, -0.5, -0.22), r: new Vector3(0.2, -0.5, -0.22) };
const SHOULDER: Record<Side, Vector3> = { l: new Vector3(-0.19, -0.22, 0.08), r: new Vector3(0.19, -0.22, 0.08) };

type ArmRig = { upper: Bone; lower: Bone; hand: Bone; bind: Map<Bone, Quaternion>; fingers: Bone[][]; thumb: Bone[]; l1: number; l2: number; curlSign: number };

const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), q1 = new Quaternion(), q2 = new Quaternion(), m4 = new Matrix4();

/** Turn `bone` so its child (at childWorld now) points at `toWorld`. */
function aim(bone: Bone, childWorld: Vector3, toWorld: Vector3) {
  const at = bone.getWorldPosition(v1);
  const from = v2.copy(childWorld).sub(at).normalize();
  const to = v3.copy(toWorld).sub(at).normalize();
  const turn = q1.setFromUnitVectors(from, to);
  const world = bone.getWorldQuaternion(q2).premultiply(turn);
  const parent = bone.parent!.getWorldQuaternion(new Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(world));
  bone.updateMatrixWorld(true);
}

export class Arms {
  readonly root = new Group();
  private rigs: Record<Side, ArmRig>;
  private now: Record<Side, HandPose>;
  private target: Record<Side, HandPose>;
  private rate: Record<Side, number> = { l: 3, r: 3 };
  private t = 0;
  private stride = 0;
  private dispose_: () => void;
  /** Something held in a hand, carried with it: the object, and where its grip sits on it (its own frame). */
  private held: Record<Side, { obj: Object3D; grip: Vector3; tilt: number; radius: number } | null> = { l: null, r: null };

  private constructor(model: Object3D, private camera: PerspectiveCamera) {
    this.root.add(model);
    const bone = (n: string) => model.getObjectByName(n) as Bone;
    const rig = (s: Side): ArmRig => {
      const upper = bone(`upperarm_${s}`), lower = bone(`lowerarm_${s}`), hand = bone(`hand_${s}`);
      const fingers = FINGERS.map((f) => [1, 2, 3].map((k) => bone(`${f}_0${k}_${s}`)));
      const thumb = [1, 2, 3].map((k) => bone(`thumb_0${k}_${s}`));
      const bind = new Map<Bone, Quaternion>();
      for (const b of [upper, lower, hand, ...fingers.flat(), ...thumb]) bind.set(b, b.quaternion.clone());
      const p = (b: Bone) => b.getWorldPosition(new Vector3());
      return { upper, lower, hand, bind, fingers, thumb, l1: p(upper).distanceTo(p(lower)), l2: p(lower).distanceTo(p(hand)), curlSign: 1 };
    };
    // stand the model so its shoulders sit where Dvij's would, below and just behind the eyes, facing ahead
    model.updateMatrixWorld(true);
    const sl = bone("upperarm_l").getWorldPosition(new Vector3()), sr = bone("upperarm_r").getWorldPosition(new Vector3());
    const scale = 0.38 / sl.distanceTo(sr);
    model.scale.setScalar(scale);
    model.rotation.y = Math.PI; // (the base faces +z; the camera looks down -z)
    model.updateMatrixWorld(true);
    const mid = bone("upperarm_l").getWorldPosition(new Vector3()).add(bone("upperarm_r").getWorldPosition(new Vector3())).multiplyScalar(0.5);
    model.position.sub(mid).add(new Vector3(0, -0.22, 0.08));
    model.updateMatrixWorld(true);
    this.rigs = { l: rig("l"), r: rig("r") };
    // which way each hand's fingers curl: whichever way brings the fingertip towards the thumb
    for (const s of ["l", "r"] as Side[]) {
      const r = this.rigs[s];
      const tip = () => r.fingers[0][2].getWorldPosition(new Vector3());
      const thumb = r.thumb[2].getWorldPosition(new Vector3());
      const before = tip().distanceTo(thumb);
      this.curl(r, 0.6);
      const after = tip().distanceTo(thumb);
      r.curlSign = after < before ? 1 : -1;
      this.reset(r);
    }
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      // his "brown skin" (comic notes, b1-p004), a little paler for the weeks in bed
      for (const x of ([] as Material[]).concat(m.material)) if (x.name === "MI_Superhero_Male") (x as MeshStandardMaterial).color.setRGB(0.62, 0.46, 0.36);
    });
    this.now = { l: { at: REST.l.clone(), grip: 0.25, show: false }, r: { at: REST.r.clone(), grip: 0.2, show: false } };
    this.target = { l: { at: REST.l.clone(), grip: 0.25, show: false }, r: { at: REST.r.clone(), grip: 0.2, show: false } };
    camera.add(this.root);
    this.dispose_ = () => {
      camera.remove(this.root);
      model.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) { m.geometry.dispose(); for (const x of ([] as Material[]).concat(m.material)) x.dispose(); }
      });
    };
  }

  static async load(url: string, camera: PerspectiveCamera): Promise<Arms> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    return new Arms(gltf.scene, camera);
  }

  private reset(r: ArmRig) {
    for (const [b, q] of r.bind) b.quaternion.copy(q);
    r.upper.updateMatrixWorld(true);
  }

  /** Close a hand's fingers by `amount` (0..1), each joint about the line of the knuckles. */
  private curl(r: ArmRig, amount: number) {
    const across = r.fingers[0][0].getWorldPosition(new Vector3()).sub(r.fingers[3][0].getWorldPosition(new Vector3())).normalize();
    const bend = (b: Bone, angle: number) => {
      const local = across.clone().applyQuaternion(b.getWorldQuaternion(new Quaternion()).invert());
      b.quaternion.multiply(new Quaternion().setFromAxisAngle(local, angle * r.curlSign));
      b.updateMatrixWorld(true);
    };
    r.fingers.forEach((f, k) => f.forEach((b, j) => bend(b, amount * (j === 0 ? 0.9 : 1.15) * (1 + k * 0.05))));
    r.thumb.forEach((b, j) => bend(b, amount * (j === 0 ? 0.2 : 0.6)));
  }

  /** Move a hand to a pose over `seconds`. */
  go(s: Side, pose: Partial<HandPose>, seconds = 0.6) {
    Object.assign(this.target[s], pose);
    if (pose.at) this.target[s].at = pose.at.clone();
    this.rate[s] = seconds > 0 ? 1 / seconds : 1000;
  }

  /** A world point, in the camera's frame (where a hand would go to touch it). */
  toCamera(world: Vector3): Vector3 {
    this.camera.updateMatrixWorld();
    return world.clone().applyMatrix4(m4.copy(this.camera.matrixWorld).invert());
  }

  /** Put something in a hand, gripped at `grip` (its own frame); null lets go, leaving it where it is in `into`.
   * `radius`: how far its middle stands out from the palm (a glass held round its side: the fingers on it, not in it). */
  hold(s: Side, obj: Object3D | null, grip = new Vector3(), into?: Object3D, radius = 0) {
    const was = this.held[s];
    if (was && into) into.attach(was.obj);
    this.held[s] = obj ? { obj, grip, tilt: 0, radius } : null;
    if (obj) this.handOf(s).attach(obj);
  }

  /** Tip what a hand holds towards the mouth (radians), as in drinking. */
  tilt(s: Side, radians: number) { if (this.held[s]) this.held[s]!.tilt = radians; }

  handOf(s: Side): Bone { return this.rigs[s].hand; }

  /** Where a hand is now (world). */
  handAt(s: Side): Vector3 { return this.rigs[s].hand.getWorldPosition(new Vector3()); }

  /** Every frame: ease the hands toward their poses, solve the arms, carry what they hold. */
  update(dt: number, walking: number) {
    this.t += dt;
    this.stride += walking * dt * 7;
    for (const s of ["l", "r"] as Side[]) {
      const now = this.now[s], to = this.target[s], r = this.rigs[s];
      const k = Math.min(1, dt * this.rate[s] * 2.2);
      now.at.lerp(to.at, k);
      now.grip += (to.grip - now.grip) * k;
      now.show = to.show || now.at.distanceTo(REST[s]) > 0.05;
      this.root.visible = this.now.l.show || this.now.r.show;
      // sway when still, bob with the stride when walking
      const side = s === "l" ? -1 : 1;
      const live = now.at.clone().add(new Vector3(
        Math.sin(this.t * 0.9 + side) * 0.004 + Math.sin(this.stride + (side > 0 ? Math.PI : 0)) * 0.012 * walking,
        Math.sin(this.t * 1.3 + side * 2) * 0.004 - Math.abs(Math.cos(this.stride)) * 0.012 * walking,
        0));
      this.reset(r);
      // two-bone IK: the shoulder (where the bone is), the hand's target, the elbow between, bent down and out
      const shoulder = r.upper.getWorldPosition(new Vector3());
      this.camera.updateMatrixWorld();
      const goal = live.applyMatrix4(this.camera.matrixWorld);
      const reach = goal.clone().sub(shoulder);
      const d = Math.min(Math.max(reach.length(), 0.05), (r.l1 + r.l2) * 0.999);
      const u = reach.normalize();
      const pole = new Vector3(side * 0.6, -1, 0.15).applyQuaternion(this.camera.getWorldQuaternion(new Quaternion()));
      pole.addScaledVector(u, -pole.dot(u)).normalize();
      const a = (r.l1 * r.l1 - r.l2 * r.l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, r.l1 * r.l1 - a * a));
      const elbow = shoulder.clone().addScaledVector(u, a).addScaledVector(pole, h);
      const wrist = shoulder.clone().addScaledVector(u, d);
      aim(r.upper, r.lower.getWorldPosition(new Vector3()), elbow);
      aim(r.lower, r.hand.getWorldPosition(new Vector3()), wrist);
      this.curl(r, now.grip);
      const held = this.held[s];
      if (held) {
        // the held thing upright in the world, but tipped by `tilt` towards him, its grip in the palm
        const palm = r.hand.getWorldPosition(new Vector3()).add(r.fingers[1][0].getWorldPosition(new Vector3())).multiplyScalar(0.5);
        const up = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(new Quaternion())), held.tilt);
        const parentInv = held.obj.parent!.getWorldQuaternion(new Quaternion()).invert();
        held.obj.quaternion.copy(parentInv.multiply(up));
        held.obj.updateMatrixWorld(true);
        const grip = held.grip.clone().applyMatrix4(held.obj.matrixWorld);
        if (held.radius > 0) {
          // its side against the palm: its middle out from the palm towards the thumb, level across its own upright,
          // a radius and the hand's flesh away (Ch1: the fingers had closed through the glass)
          const knuckle = r.fingers[1][0].getWorldPosition(new Vector3()), along = knuckle.clone().sub(r.hand.getWorldPosition(new Vector3())).normalize();
          const thumb = r.thumb[r.thumb.length - 1].getWorldPosition(new Vector3());
          const upright = new Vector3(0, 1, 0).applyQuaternion(held.obj.getWorldQuaternion(new Quaternion()));
          const out = thumb.sub(palm);
          out.addScaledVector(along, -out.dot(along)).addScaledVector(upright, -out.dot(upright));
          if (out.lengthSq() > 1e-8) palm.addScaledVector(out.normalize(), held.radius + 0.012);
        }
        const offset = palm.sub(grip);
        held.obj.position.add(held.obj.parent!.worldToLocal(held.obj.getWorldPosition(new Vector3()).add(offset)).sub(held.obj.position));
      }
    }
  }

  /** Where each hand rests, and where it reaches from: for callers composing poses. */
  static rest(s: Side): Vector3 { return REST[s].clone(); }
  static shoulder(s: Side): Vector3 { return SHOULDER[s].clone(); }

  dispose() { this.dispose_(); }
}
