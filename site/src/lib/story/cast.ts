// The story's people on the stage (design §10.4, graphics phase 5): the Professor, Bhavi, Maharaj,
// Mahant, Baldev, Vaidji and the rest, each a rigged body with its clips (pipeline/build_people.py).
// They stand, sit, walk and gesture as the scenes' `actor` beats say; between beats they breathe,
// blink and look at whoever is talking; as they speak their mouths move with their voices' loudness
// (pipeline/voice_mouths.py) and their hands move with the talk. The cast list is in each scene's
// yaml; everyone in it is placed at the scene's start, and hidden until they come on if they enter.
import {
  AnimationMixer, Group, LoopOnce, LoopRepeat, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Bone, type Material, type Mesh, type Object3D, type SkinnedMesh,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { aim, bindLook, look, reach } from "./ik";
import { SELF_LAYER } from "../walk/game";

export type V2 = [number, number];
export type CastSpec = {
  who: string; at: V2; pose?: string; on?: string; face?: V2 | "player"; holding?: string; enters?: boolean;
  /** Which of the built people plays them (people.json), if not the one named `who`: Bhavi in her kurta, the villagers' faces. */
  model?: string; models?: string[];
  /** A crowd of this many, in rows over `rect` [x0, z0, x1, z1] (frame metres), all facing `face`. */
  crowd?: number; rect?: [number, number, number, number];
};
/** What the cast needs from the stage. */
export type CastEnv = {
  /** The scene's frame: the lodge's or the temple site's root; the cast stand in it. */
  root: Object3D;
  /** The ground's height (frame metres) under a place in the frame, at or below `y`. */
  ground: (x: number, z: number, y?: number) => number;
  /** Dvij's eyes (world). */
  eyes: () => Vector3;
  /** A prop's handle (what a hand takes of it), by id. */
  prop: (id: string) => Object3D | null;
  /** A built asset's url. */
  url: (file: string) => string;
  /** Can Dvij see this point (world)? Off stage, people hurry. */
  seen: (p: Vector3) => boolean;
  /** Which way Dvij faces (radians, the game's heading). */
  heading: () => number;
  /** Someone moved: their shadow is to be drawn again. */
  stir?: () => void;
};
export type PeopleInfo = { people: Record<string, { file: string; height: number }>; mouths?: string };

/** How high each kind of seat is above the floor (m): the hips go there (build_lodge.py, build_site.py, props.ts). */
const SEATS: Record<string, number> = { ground: 0.08, "deck-chair": 0.36, armchair: 0.44, chair: 0.47, divan: 0.46, stool: 0.42, "well-rim": 0.8 };
/** The clip each pose loops in, and what it talks in. */
const POSE_CLIP: Record<string, [string, string]> = {
  stand: ["Idle_Loop", "Idle_Talking_Loop"],
  sit: ["Sitting_Idle_Loop", "Sitting_Talking_Loop"],
  recline: ["Sitting_Idle_Loop", "Sitting_Talking_Loop"],
  kneel: ["Fixing_Kneeling", "Fixing_Kneeling"],
  stoke: ["Crouch_Idle_Loop", "Crouch_Idle_Loop"],
  crouch: ["Crouch_Idle_Loop", "Crouch_Idle_Loop"],
  crosslegged: ["Sitting_Idle_Loop", "Sitting_Talking_Loop"],
};
const WALK_SPEED = 1.05; // m/s (the old and the heavy go a little slower)
const SLOW: Record<string, number> = { professor: 0.85, vaidji: 0.8, maharaj: 0.9, baldev: 0.95 };

type Layer = {
  /** Bend at the waist (radians, forward +) and of the head (down +). */
  spine?: number; head?: number;
  /** Where the hands go (world), and how far the elbows point out. */
  handL?: Vector3 | null; handR?: Vector3 | null;
  /** Where the feet go (world): crossed under the knees, for sitting on the ground. */
  footL?: Vector3 | null; footR?: Vector3 | null;
};
type Gesture = { seconds: number; hold?: boolean; clip?: string; at: (a: Actor, t: number) => Layer };

const up = (a: Actor, h: number, fwd = 0.3, side = 0) => a.point(side, h, fwd);
/** The story's gestures that the clip library hasn't got: poses laid over the pose's own loop. */
const GESTURES: Record<string, Gesture> = {
  namaste: { seconds: 2.4, at: (a) => ({ spine: 0.35, head: 0.3, handL: up(a, 1.18, 0.28, -0.02), handR: up(a, 1.18, 0.28, 0.02) }) },
  supplicate: { seconds: 3.2, at: (a, t) => { const k = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); return { spine: 1.1 * k, head: 0.4 * k, handL: up(a, 1.2 - 0.3 * k, 0.3 + 0.15 * k, -0.02), handR: up(a, 1.2 - 0.3 * k, 0.3 + 0.15 * k, 0.02) }; } },
  pray: { seconds: 1.2, hold: true, at: (a) => ({ head: 0.15, handL: up(a, 1.16, 0.26, -0.015), handR: up(a, 1.16, 0.26, 0.015) }) },
  bow: { seconds: 1.8, at: () => ({ spine: 0.45, head: 0.35 }) },
  nod: { seconds: 1.0, at: (_a, t) => ({ head: Math.sin(t * Math.PI * 2) * 0.22 }) },
  laugh: { seconds: 1.6, at: (_a, t) => ({ spine: -0.12 + Math.sin(t * 40) * 0.03, head: -0.35 }) },
  "lean-in": { seconds: 1.0, hold: true, at: () => ({ spine: 0.3, head: 0.1 }) },
  "finger-raise": { seconds: 1.8, at: (a) => ({ handR: up(a, 1.5, 0.3, 0.18) }) },
  point: { seconds: 1.6, at: (a) => ({ spine: 0.1, handR: a.toward(a.eyesOf(), 0.55, -0.2) }) },
  "fold-arms": { seconds: 1.0, hold: true, at: (a) => ({ handL: up(a, 1.12, 0.2, 0.12), handR: up(a, 1.1, 0.22, -0.12) }) },
  "hand-to-chin": { seconds: 2.4, at: (a) => ({ head: 0.1, handR: up(a, 1.48, 0.14, 0.02) }) },
  "hand-to-mouth": { seconds: 2.4, at: (a) => ({ head: 0.15, handR: up(a, 1.52, 0.12, 0.0) }) },
  "hand-on-chest": { seconds: 1.8, at: (a) => ({ handR: up(a, 1.28, 0.16, -0.05) }) },
  "mop-brow": { seconds: 2.0, at: (a, t) => ({ head: 0.15, handR: up(a, 1.64, 0.12, 0.08 - Math.sin(t * Math.PI * 3) * 0.08) }) },
  "wipe-eyes": { seconds: 1.8, at: (a, t) => ({ head: 0.2, handR: up(a, 1.56, 0.1, Math.sin(t * Math.PI * 4) * 0.04) }) },
  offer: { seconds: 1.5, hold: true, at: (a) => ({ spine: 0.15, handL: a.toward(a.eyesOf(), 0.5, -0.45, -0.12), handR: a.toward(a.eyesOf(), 0.5, -0.45, 0.12) }) },
  give: { seconds: 1.4, at: (a) => ({ spine: 0.12, handR: a.toward(a.eyesOf(), 0.55, -0.35) }) },
  pour: { seconds: 2.2, at: (a) => ({ spine: 0.2, head: 0.3, handL: up(a, 0.98, 0.4, -0.08), handR: up(a, 1.14, 0.4, 0.06) }) },
  tilak: { seconds: 2.6, at: (a) => ({ handR: a.eyesOf().add(new Vector3(0, 0.07, 0)).addScaledVector(a.facing(), 0.05) }) },
  bless: { seconds: 2.6, at: (a) => ({ handR: a.eyesOf().add(new Vector3(0, 0.16, 0)) }) },
  proclaim: { seconds: 2.4, at: (a) => ({ spine: -0.08, head: -0.1, handR: up(a, 1.95, 0.35, 0.25) }) },
  circle: { seconds: 2.4, at: (a, t) => ({ handR: up(a, 1.75 + Math.sin(t * Math.PI * 2) * 0.12, 0.45, Math.cos(t * Math.PI * 2) * 0.35) }) },
  beckon: { seconds: 1.6, at: (a, t) => ({ handR: up(a, 1.1, 0.4 - Math.sin(t * Math.PI * 4) * 0.1, 0.2) }) },
  "wave-off": { seconds: 1.4, at: (a, t) => ({ handR: up(a, 1.2, 0.45, 0.35 + Math.sin(t * Math.PI * 3) * 0.1) }) },
  "wipe-fingers": { seconds: 2.0, at: (a, t) => ({ handL: up(a, 1.0, 0.3, -0.02 + Math.sin(t * 18) * 0.02), handR: up(a, 1.0, 0.3, 0.04) }) },
  steeple: { seconds: 2.2, hold: true, at: (a) => ({ handL: up(a, 1.2, 0.3, -0.015), handR: up(a, 1.2, 0.3, 0.015) }) },
  "tape-yank": { seconds: 0.9, at: (a, t) => ({ handR: a.eyesOf().add(new Vector3(0, 0.08 + t * 0.25, 0)).addScaledVector(a.facing(), 0.05 + t * 0.3) }) },
  swab: { seconds: 2.8, at: (a, t) => ({ spine: 0.12, head: 0.2, handR: a.eyesOf().add(new Vector3(Math.sin(t * 14) * 0.012, 0.08, 0)).addScaledVector(a.facing(), 0.05), handL: up(a, 1.15, 0.3, -0.15) }) },
  stoke: { seconds: 2.4, at: (a, t) => ({ handR: up(a, 0.55, 0.55 + Math.sin(t * Math.PI * 4) * 0.15, 0.1) }) },
  tend: { seconds: 3.0, clip: "Crouch_Idle_Loop", at: (a, t) => ({ head: 0.4, handR: up(a, 0.78, 0.35, 0.05 + Math.sin(t * 9) * 0.03), handL: up(a, 0.72, 0.32, -0.08) }) },
  interact: { seconds: 0, clip: "Interact", at: () => ({}) },
  "pick-up": { seconds: 0, clip: "PickUp_Table", at: () => ({}) },
  talk: { seconds: 2.2, clip: "Idle_Talking_Loop", at: () => ({}) },
  turn: { seconds: 0.6, at: () => ({}) },
  "jump-down": { seconds: 0, clip: "Jump_Land", at: () => ({}) },
  chew: { seconds: 3.0, at: (_a, t) => ({ head: Math.sin(t * 22) * 0.025 }) },
  "eye-dart": { seconds: 1.6, at: (_a, t) => ({ head: 0.05 + Math.sin(t * 9) * 0.03 }) },
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<{ scene: Object3D; clips: AnimationClip[] }>>();

export class Actor {
  readonly obj = new Group();
  private model: Object3D;
  private mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private base: AnimationAction | null = null;
  private bones: Record<string, Bone> = {};
  /** Each bone's rest turn: put back before the clips play each frame (a clip leaves alone the bones it doesn't move, and the gestures' turns would add up). */
  private rest: [Bone, Quaternion][] = [];
  /** The face's shape keys on each mesh that has them (MakeHuman's expression units, named as ARKit's: blender/build_human.py). */
  private morphs: { mesh: Mesh; blink: number[]; jaw?: number; smile?: number; brows: number[]; frown?: number }[] = [];
  /** A held expression: a smile, a frown, the brows up (0..1 each). */
  private face = { smile: 0, frown: 0, brows: 0 };
  private pose = "stand";
  /** The seat's height (frame metres), if sat: the hips go there. */
  private seat = 0;
  /** Leaning back (radians): reclined on a divan against the masnad (novel ¶296), back in a deck chair. */
  private lean = 0;
  private path: Vector3[] = [];
  private onArrive: (() => void) | null = null;
  private loopRim: { c: V2; r: number; a: number } | null = null;
  private gesture: { g: Gesture; t: number; done: () => void } | null = null;
  private held: Layer = {};
  private layer: Layer = {};
  private layerW = 0;
  private gaze: Vector3 | (() => Vector3) | null = null;
  private gazeW = 0;
  private blinkIn = 2 + Math.random() * 3;
  private blinkT = -1;
  private mouth: (() => number) | null = null;
  private jaw = 0;
  private t = Math.random() * 10;
  private carried: Object3D | null = null;
  private hidden = false;
  talking = false;
  /** Time not yet played (a far one is moved every few frames). */
  pending = 0;

  constructor(readonly who: string, made: { scene: Object3D; clips: AnimationClip[] }, private env: CastEnv) {
    this.model = cloneSkinned(made.scene);
    this.obj.add(this.model);
    this.obj.name = `cast-${who}`;
    this.model.traverse((o) => {
      const b = o as Bone;
      if (b.isBone) { this.bones[b.name.toLowerCase()] = b; this.rest.push([b, b.quaternion.clone()]); }
      const m = o as SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // (a skinned body's bounds are its bind pose's)
        const d = m.morphTargetDictionary;
        if (d && Object.keys(d).length) {
          this.morphs.push({ mesh: m, blink: [d.eyeBlinkLeft, d.eyeBlinkRight].filter((x) => x != null), jaw: d.jawOpen, smile: d.mouthSmileLeft,
                             brows: [d.browInnerUp, d.browOuterUpRight].filter((x) => x != null), frown: d.mouthFrownLeft });
        }
        // hair, brows, lashes, the tilak: cut out where their textures are clear, not blended (no sorting troubles)
        for (const mat of ([] as Material[]).concat(m.material)) {
          if (mat.transparent) { mat.transparent = false; mat.alphaTest = 0.5; mat.depthWrite = true; }
        }
      }
    });
    this.mixer = new AnimationMixer(this.model);
    for (const c of made.clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.loop("Idle_Loop", 0);
    this.mixer.update(0);
    this.obj.updateMatrixWorld(true);
    if (this.bone("head")) bindLook(this.bone("head")!, this.obj);
  }

  private bone(n: string): Bone | undefined { return this.bones[n]; }

  /** A point in front of the body, at a height (m above its feet), `fwd` ahead and `side` to its right (world). */
  point(side: number, height: number, fwd: number): Vector3 {
    // measured from the chest as it is now (standing or sat), as if it stood 1.3 m up; +x is the body's left (it faces +z)
    const chest = this.obj.worldToLocal((this.bone("spine_03") ?? this.obj).getWorldPosition(new Vector3()));
    return this.obj.localToWorld(new Vector3(-side, chest.y + (height - 1.3), chest.z + fwd));
  }
  /** A point on the floor they sit on (a little above it), `side` to the body's right and `fwd` ahead of its middle (world). */
  onFloor(side: number, fwd: number): Vector3 {
    return this.obj.localToWorld(new Vector3(-side, this.seat - 0.08 + 0.07 - this.obj.position.y, fwd));
  }
  /** Out from the chest towards `target` (world), `dist` metres, `drop` lower, `side` to the right. */
  toward(target: Vector3, dist: number, drop = 0, side = 0): Vector3 {
    const chest = this.point(side, 1.3, 0.1);
    return chest.add(target.clone().sub(chest).setY(0).normalize().multiplyScalar(dist)).add(new Vector3(0, drop, 0));
  }
  facing(): Vector3 { return new Vector3(0, 0, 1).applyQuaternion(this.obj.getWorldQuaternion(new Quaternion())); }
  eyesOf(): Vector3 { return this.env.eyes(); }
  headAt(): Vector3 { return (this.bone("head") ?? this.obj).getWorldPosition(new Vector3()).add(new Vector3(0, 0.1, 0)); }
  get visible() { return !this.hidden; }

  private loop(name: string, fade = 0.35) {
    const next = this.actions.get(name) ?? this.actions.get("Idle_Loop");
    if (!next || next === this.base) return;
    next.reset().setLoop(LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(fade).play();
    this.base?.fadeOut(fade);
    this.base = next;
  }

  /** Where they are, how they sit or stand, which way they face. */
  place(at: V2, pose = this.pose, on?: string, face?: V2) {
    this.pose = pose;
    this.obj.position.set(at[0], this.env.ground(at[0], at[1], 3), at[1]);
    if (face) this.faceTo(face);
    this.seat = 0;
    this.lean = pose === "recline" ? -0.42 : on === "deck-chair" ? -0.3 : 0;
    if (pose === "crosslegged") on = "ground"; // (on the durrie, the carpet: the comic's villagers, b1-p015-1)
    if (on) {
      // the floor round the seat (a seat may be solid to the ground's query: the well, a chair, the divan)
      let floor = Infinity;
      for (let k = 0; k < 8; k++) floor = Math.min(floor, this.env.ground(at[0] + Math.sin(k * 0.785) * 1.3, at[1] + Math.cos(k * 0.785) * 1.3, 3));
      this.seat = floor + (SEATS[on] ?? 0.45);
    }
    this.loop(POSE_CLIP[pose]?.[0] ?? "Idle_Loop", 0);
    this.mixer.update(0.01);
    this.settle();
  }

  /** Sit them down on the seat's height: the clip's hips meet it. */
  private settle() {
    const pelvis = this.bone("pelvis");
    if (!this.seat || !pelvis) return;
    this.obj.updateMatrixWorld(true);
    const hips = pelvis.getWorldPosition(new Vector3()).y - this.obj.getWorldPosition(new Vector3()).y;
    this.obj.position.y = this.seat + 0.06 - hips;
  }

  faceTo(p: V2) { this.obj.rotation.y = Math.atan2(p[0] - this.obj.position.x, p[1] - this.obj.position.z); }

  /** Turn on the spot to face a place (frame metres), over `seconds`. */
  turnTo(p: V2, seconds = 0.8): Promise<void> {
    const want = Math.atan2(p[0] - this.obj.position.x, p[1] - this.obj.position.z);
    const from = this.obj.rotation.y;
    const by = Math.atan2(Math.sin(want - from), Math.cos(want - from));
    this.turning = { from, by, t: 0, seconds };
    return new Promise((done) => { this.turning!.done = done; });
  }
  private turning: { from: number; by: number; t: number; seconds: number; done?: () => void } | null = null;
  /** Where they stand now (frame metres). */
  where(): V2 { return [this.obj.position.x, this.obj.position.z]; }

  show(on: boolean) { this.hidden = !on; this.obj.visible = on; }

  /** Walk to the end of `via`, then `to` (frame metres). Resolves on arrival. */
  walk(to: V2, via: V2[] = [], hurried = false): Promise<void> {
    this.loopRim = null;
    const pts = [...via, to].map(([x, z]) => new Vector3(x, 0, z));
    if (hurried) {
      const last = pts[pts.length - 1];
      const prev = pts.length > 1 ? pts[pts.length - 2] : this.obj.position;
      this.place([last.x, last.z], "stand");
      this.faceTo([last.x + (last.x - prev.x), last.z + (last.z - prev.z)]);
      return Promise.resolve();
    }
    this.pose = "stand";
    this.seat = 0;
    this.lean = 0;
    this.path = pts;
    this.loop(this.who === "mahant" ? "Walk_Formal_Loop" : "Walk_Loop", 0.3);
    return new Promise((done) => { this.onArrive = done; });
  }

  /** Bhavi's walk round the well's parapet (novel ¶169): round and round until told to stop. */
  walkRim(centre: V2, radius: number) {
    const a = Math.atan2(this.obj.position.x - centre[0], this.obj.position.z - centre[1]);
    this.pose = "stand";
    this.seat = 0;
    this.lean = 0;
    this.loopRim = { c: centre, r: radius, a };
    this.loop("Walk_Loop", 0.4);
  }

  stop() {
    this.loopRim = null;
    this.path = [];
    this.onArrive?.();
    this.onArrive = null;
    this.loop(POSE_CLIP[this.pose]?.[0] ?? "Idle_Loop");
  }

  /** Play a gesture or a clip once; resolves as it ends (a held gesture stays until the next). */
  act(name: string): Promise<void> {
    const g = GESTURES[name];
    if (!g) return Promise.resolve();
    this.gesture?.done();
    if (g.clip && !g.seconds) {
      const a = this.actions.get(g.clip);
      if (!a) return Promise.resolve();
      return new Promise((done) => {
        a.reset().setLoop(LoopOnce, 1).fadeIn(0.25).play();
        a.clampWhenFinished = true;
        const base = this.base;
        base?.fadeOut(0.25);
        const end = (e: { action: AnimationAction }) => {
          if (e.action !== a) return;
          this.mixer.removeEventListener("finished", end as never);
          a.fadeOut(0.3);
          base?.reset().fadeIn(0.3).play();
          done();
        };
        this.mixer.addEventListener("finished", end as never);
      });
    }
    if (g.clip) this.loop(g.clip, 0.3);
    return new Promise((done) => {
      this.gesture = { g, t: 0, done: () => { this.gesture = null; if (g.clip) this.loop(POSE_CLIP[this.pose]?.[0] ?? "Idle_Loop"); done(); } };
    });
  }

  /** Move the clips on by `seconds` (a crowd's people aren't all at the same moment). */
  skip(seconds: number) { this.mixer.update(seconds); }

  /** Hold an expression (each 0..1): a smile, a frown, the brows up. */
  express(face: Partial<{ smile: number; frown: number; brows: number }>) { Object.assign(this.face, face); }

  /** Look at something: a point, someone's head, or nothing (null: straight ahead). */
  lookAt(target: Vector3 | (() => Vector3) | null) { this.gaze = target; }

  /** Hold a prop in the right hand (its handle), or let it go (null). */
  hold(obj: Object3D | null) {
    const hand = this.bone("hand_r");
    if (this.carried && !obj) { this.carried.visible = false; this.carried.removeFromParent(); }
    this.carried = obj;
    if (obj && hand) {
      obj.visible = true;
      if (obj.parent) obj.parent.visible = true;
      hand.add(obj);
      obj.position.set(0, 0.08, 0.04);
      obj.quaternion.identity();
      obj.scale.setScalar(1 / hand.getWorldScale(new Vector3()).x);
    }
  }

  /** Speak: the mouth follows the voice's loudness (0..1, by the clip's time), and the hands the talk. */
  speak(level: (() => number) | null) {
    this.mouth = level;
    this.talking = !!level;
    if (!this.path.length && !this.loopRim) this.loop(POSE_CLIP[this.pose]?.[level ? 1 : 0] ?? "Idle_Loop", 0.5);
  }

  update(dt: number) {
    this.t += dt;
    // walking: along the path, turning into each leg; faster off stage
    if (this.path.length) {
      const p = this.obj.position;
      const next = this.path[0];
      const d = Math.hypot(next.x - p.x, next.z - p.z);
      const fast = this.env.seen(this.obj.getWorldPosition(new Vector3()).add(new Vector3(0, 1, 0))) ? 1 : 5;
      const speed = WALK_SPEED * (SLOW[this.who] ?? 1) * fast;
      const step = Math.min(d, speed * dt);
      if (d > 1e-3) {
        const want = Math.atan2(next.x - p.x, next.z - p.z);
        let turn = want - this.obj.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.obj.rotation.y += turn * Math.min(1, dt * 8);
        p.x += ((next.x - p.x) / d) * step;
        p.z += ((next.z - p.z) / d) * step;
      }
      p.y = this.env.ground(p.x, p.z, p.y + 0.6);
      if (this.base) this.base.timeScale = Math.min(2, speed / 1.15); // (the clip's stride: about 1.15 m/s)
      if (d - step < 0.02) {
        this.path.shift();
        if (!this.path.length) {
          if (this.base) this.base.timeScale = 1;
          this.loop("Idle_Loop", 0.4);
          this.onArrive?.();
          this.onArrive = null;
        }
      }
    }
    if (this.loopRim) {
      const r = this.loopRim;
      r.a += (0.55 / r.r) * dt; // a slow, careful step
      this.obj.position.set(r.c[0] + Math.sin(r.a) * r.r, 0, r.c[1] + Math.cos(r.a) * r.r);
      this.obj.position.y = this.env.ground(this.obj.position.x, this.obj.position.z, 3);
      this.obj.rotation.y = r.a + Math.PI / 2;
      if (this.base) this.base.timeScale = 0.55;
    }
    if (this.path.length || this.loopRim || this.turning) this.env.stir?.();
    if (this.turning) {
      const tr = this.turning;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.seconds);
      this.obj.rotation.y = tr.from + tr.by * (k * k * (3 - 2 * k));
      if (k >= 1) { this.turning = null; tr.done?.(); }
    }
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.mixer.update(dt);
    this.obj.updateMatrixWorld(true);
    // a gesture: its layer eased in and out over its time
    let layer: Layer = this.held;
    if (this.gesture) {
      const g = this.gesture.g;
      this.gesture.t += dt;
      const k = g.seconds ? Math.min(1, this.gesture.t / g.seconds) : 0;
      layer = g.at(this, k);
      if (g.hold) this.held = layer;
      const rise = Math.min(1, this.gesture.t / 0.35), fall = g.hold ? 1 : Math.min(1, (g.seconds - this.gesture.t) / 0.35);
      this.layerW = Math.max(0, Math.min(rise, fall));
      if (k >= 1) { const d = this.gesture.done; d(); }
    } else this.layerW = Object.keys(this.held).length ? Math.min(1, this.layerW + dt * 3) : Math.max(0, this.layerW - dt * 3);
    this.layer = layer;
    if (this.lean) this.pose_({ spine: this.lean }, 1);
    if (this.pose === "crosslegged") {
      // the legs folded, each foot under the other knee, the knees out and down; the back straight
      this.pose_({ spine: -0.25, footL: this.onFloor(0.14, 0.24), footR: this.onFloor(-0.14, 0.16) }, 1);
    }
    this.pose_(this.layer, this.layerW);
    // the eyes and head: towards what they look at (eased), within a neck's reach
    const target = typeof this.gaze === "function" ? this.gaze() : this.gaze;
    this.gazeW += ((target ? 1 : 0) - this.gazeW) * Math.min(1, dt * 3);
    const neck = this.bone("neck_01"), head = this.bone("head");
    if (neck && head && target) look(neck, head, target, this.facing(), this.gazeW * 0.9);
    // blinks and the mouth
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkT = 0; this.blinkIn = 2 + Math.random() * 4.5; }
    let blink = 0;
    if (this.blinkT >= 0) { this.blinkT += dt; blink = Math.max(0, 1 - Math.abs(this.blinkT - 0.08) / 0.08); if (this.blinkT > 0.16) this.blinkT = -1; }
    const want = this.mouth ? this.mouth() : 0;
    this.jaw += (want - this.jaw) * Math.min(1, dt * 18);
    for (const m of this.morphs) {
      const inf = m.mesh.morphTargetInfluences;
      if (!inf) continue;
      for (const b of m.blink) inf[b] = blink;
      if (m.jaw != null) inf[m.jaw] = this.jaw * 0.85;
      if (m.smile != null) inf[m.smile] = this.face.smile;
      if (m.frown != null) inf[m.frown] = this.face.frown;
      for (const b of m.brows) inf[b] = this.face.brows + this.jaw * 0.12; // (the brows lift a little with the words)
    }
    // no face shapes (the stand-in bodies): the head at least nods a little with the words
    if (!this.morphs.some((m) => m.jaw != null) && head && this.jaw > 0.05) {
      head.rotateX(-this.jaw * 0.05);
      head.updateMatrixWorld(true);
    }
  }

  /** Lay a gesture's pose over the clip's: the bend, the head, the hands. */
  private pose_(l: Layer, w: number) {
    if (w <= 0.001) return;
    const right = new Vector3(-1, 0, 0).applyQuaternion(this.obj.getWorldQuaternion(new Quaternion())); // (the body's own right, about which it bows)
    const bend = (b: Bone | undefined, rad: number) => {
      if (!b || !rad) return;
      const turn = new Quaternion().setFromAxisAngle(right, -rad * w);
      const world = b.getWorldQuaternion(new Quaternion()).premultiply(turn);
      b.quaternion.copy(b.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
      b.updateMatrixWorld(true);
    };
    if (l.spine) { bend(this.bone("spine_01"), l.spine * 0.4); bend(this.bone("spine_02"), l.spine * 0.35); bend(this.bone("spine_03"), l.spine * 0.25); }
    if (l.head) bend(this.bone("head"), l.head);
    for (const s of ["l", "r"] as const) {
      const goal = s === "l" ? l.footL : l.footR;
      const t = this.bone(`thigh_${s}`), c = this.bone(`calf_${s}`), f = this.bone(`foot_${s}`);
      if (!goal || !t || !c || !f) continue;
      const knee = new Vector3(s === "l" ? 1 : -1, 0.6, 0.5).applyQuaternion(this.obj.getWorldQuaternion(new Quaternion()));
      reach(t, c, f, goal, knee, w);
    }
    for (const s of ["l", "r"] as const) {
      const goal = s === "l" ? l.handL : l.handR;
      const u = this.bone(`upperarm_${s}`), lo = this.bone(`lowerarm_${s}`), h = this.bone(`hand_${s}`);
      if (!goal || !u || !lo || !h) continue;
      const out = new Vector3(s === "l" ? 1 : -1, -1.2, -0.3).applyQuaternion(this.obj.getWorldQuaternion(new Quaternion()));
      reach(u, lo, h, goal, out, w);
    }
  }

  /** Point the hand bone's fingers at a world point (for a gesture that needs it). */
  aimHand(s: "l" | "r", at: Vector3) {
    const h = this.bone(`hand_${s}`), tip = this.bone(`middle_01_${s}`);
    if (h && tip) aim(h, tip.getWorldPosition(new Vector3()), at);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.obj.removeFromParent();
  }
}

/** The people in a scene, and the beats that move them. */
export class Cast {
  readonly group = new Group();
  private actors = new Map<string, Actor>();
  /** The crowds: a name, and its people (each also in `actors` as name#k). */
  private crowds = new Map<string, Actor[]>();
  private frame = 0;
  private mouths: Record<string, string> | null = null;

  constructor(private info: PeopleInfo, private env: CastEnv) {
    this.group.name = "cast";
    env.root.add(this.group);
  }

  private load(who: string) {
    const p = this.info.people[who] ?? this.info.people[`${who}-a`] ?? this.info.people.default;
    if (!p) return null;
    if (!cache.has(p.file)) cache.set(p.file, loader.loadAsync(this.env.url(p.file)).then((g) => ({ scene: g.scene, clips: g.animations })));
    return cache.get(p.file)!;
  }

  /** Everyone in the scene's cast list, in their places (those who enter later, hidden). */
  /** `start`: where Dvij starts the scene (frame metres), for those who face him. */
  async setUp(list: CastSpec[], start?: V2) {
    this.start = start ?? null;
    await Promise.all(list.map(async (c) => {
      if (c.crowd && c.rect) return this.crowd(c);
      const made = await this.load(c.model ?? c.who)?.catch((e) => { console.warn(`no ${c.who}:`, e); return null; });
      if (!made) return;
      const a = new Actor(c.who, made, this.env);
      this.group.add(a.obj);
      this.actors.set(c.who, a);
      const face = c.face === "player" ? this.playerAt() : c.face;
      a.place(c.at, c.pose ?? "stand", c.on, face);
      if (c.holding) a.hold(this.env.prop(c.holding));
      a.lookAt(c.pose === "kneel" || c.face === "player" ? () => this.env.eyes() : null);
      if (c.enters) a.show(false);
    }));
    this.start = null;
  }

  private start: V2 | null = null;

  /** A crowd: sat in rows over its rect, a little out of line, each at their own moment in the clip. */
  private async crowd(c: CastSpec) {
    const looks = await Promise.all((c.models ?? [c.model ?? c.who]).map((m) => this.load(m)?.catch(() => null) ?? null));
    const made = looks.filter((x): x is { scene: Object3D; clips: AnimationClip[] } => !!x);
    if (!made.length) return;
    const [x0, z0, x1, z1] = c.rect!;
    const n = c.crowd!;
    const across = Math.max(1, Math.round(Math.sqrt((n * (x1 - x0)) / (z1 - z0))));
    const rows = Math.ceil(n / across);
    let seed = 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const people: Actor[] = [];
    for (let k = 0; k < n; k++) {
      const i = k % across, j = Math.floor(k / across);
      const at: V2 = [x0 + ((i + 0.5) / across) * (x1 - x0) + (rnd() - 0.5) * 0.3, z0 + ((j + 0.5) / rows) * (z1 - z0) + (rnd() - 0.5) * 0.3];
      const a = new Actor(c.who, made[k % made.length], this.env);
      this.group.add(a.obj);
      this.actors.set(`${c.who}#${k}`, a);
      people.push(a);
      const face = c.face === "player" ? this.playerAt() : c.face;
      a.place(at, c.pose ?? "stand", c.on, face ? [face[0] + (rnd() - 0.5) * 2, face[1] + (rnd() - 0.5) * 2] : undefined);
      a.obj.scale.setScalar(0.94 + rnd() * 0.1);
      a.obj.traverse((o) => { o.castShadow = false; }); // (sat still in the midday sun: their shadows are pools under them, and cost a pass)
      a.skip(rnd() * 4);
      if (c.enters) a.show(false);
    }
    this.crowds.set(c.who, people);
  }
  private playerAt(): V2 {
    if (this.start) return this.start; // (while setting up: Dvij isn't in his place yet)
    const e = this.env.root.worldToLocal(this.env.eyes().clone());
    return [e.x, e.z];
  }

  get(who: string) { return this.actors.get(who); }

  private me: Actor | null = null;
  /** Dvij's own body, on the layer only a reflection sees (the author, 21 Oct): it stands where he stands. */
  async self(model = "dvij"): Promise<Actor | null> {
    if (this.me) return this.me;
    const made = await this.load(model)?.catch(() => null);
    if (!made) return null;
    const a = new Actor("dvij", made, this.env);
    a.obj.traverse((o) => o.layers.set(SELF_LAYER));
    this.group.add(a.obj);
    this.me = a;
    return a;
  }

  /** A scene's `actor` beat (the story yaml): come on, walk, look, take, gesture, give, go. */
  async beat(a: Record<string, any>, hurried: boolean): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const many = this.crowds.get(a.who);
    if (many) { // a crowd does it together, each a moment apart
      await Promise.all(many.map((m, k) => new Promise<void>((done) => setTimeout(() => {
        if (a.show !== undefined) m.show(!!a.show);
        if (a.look) m.lookAt(this.target(a.look));
        void (a.anim && !hurried ? m.act(a.anim) : Promise.resolve()).then(done);
      }, hurried ? 0 : (k % 7) * 90))));
      return;
    }
    const ac = this.actors.get(a.who);
    if (!ac) return;
    if (a.from) { ac.place(a.from, "stand"); ac.show(true); }
    if (a.stop) ac.stop();
    if (a.pose) ac.place(ac.where(), a.pose, a.on);
    const face = () => ac.turnTo(a.face === "player" ? this.playerAt() : a.face, hurried ? 0.01 : 0.8);
    if (a.face && !a.walk) await face();
    if (a.anim === "turn" && !hurried) await ac.turnTo(a.look && a.look !== "player" && Array.isArray(a.look) ? (a.look as V2) : this.playerAt());
    if (a.holding) ac.hold(this.env.prop(a.holding));
    if (a.look) ac.lookAt(this.target(a.look));
    if (a.walk) {
      const going = ac.walk(a.walk, a.via ?? [], hurried);
      if (a.exit) { void going.then(() => ac.show(false)); return; } // they go; the story doesn't wait
      await going;
      if (a.face) await face();
      if (a.look) ac.lookAt(this.target(a.look));
    }
    if (a["walk-rim"]) { ac.walkRim([-18, 38], 1.42); return; }
    if (a.take) {
      const h = this.env.prop(a.take);
      if (!hurried) await ac.act(a.anim === "pick-up" || !a.anim ? "pick-up" : "interact");
      ac.hold(h);
    }
    if (a.wearing) ac.hold(null); // (the spectacles go on his face: the stand-ins have none to show)
    if (a.anim && !(a.take && a.anim === "pick-up") && !hurried) await ac.act(a.anim);
    if (a.give === "player") { if (!hurried) await ac.act("give"); ac.hold(null); }
    if (a.then) {
      if (typeof a.then === "string") { if (!hurried) await ac.act(a.then); }
      else await this.beat({ who: a.who, ...a.then }, hurried);
    }
    if (a.exit) ac.show(false);
  }

  private target(t: string | V2): Vector3 | (() => Vector3) | null {
    if (t === "player") return () => this.env.eyes();
    if (typeof t === "string") {
      const other = this.actors.get(t);
      if (other) return () => other.headAt();
      const h = this.env.prop(t);
      return h ? () => h.getWorldPosition(new Vector3()) : null;
    }
    return this.env.root.localToWorld(new Vector3(t[0], 1.0, t[1]));
  }

  /** Someone speaks (Dvij, or one of the cast): the others look at them, the speaker at Dvij. */
  speaking(who: string | null, level: (() => number) | null) {
    for (const [name, a] of this.actors) {
      if (!a.visible) continue;
      if (name === who) { a.speak(level); a.lookAt(() => this.env.eyes()); }
      else {
        a.speak(null);
        const s = who ? this.actors.get(who) : null;
        if (who === "dvij") a.lookAt(() => this.env.eyes());
        else if (s?.visible) a.lookAt(() => s.headAt());
      }
    }
  }

  /** The loudness of a voice file over its time (0..1), for a mouth: from pipeline/voice_mouths.py. */
  async level(file: string, time: () => number): Promise<() => number> {
    if (!this.mouths && this.info.mouths) {
      this.mouths = await fetch(this.env.url(this.info.mouths)).then((r) => r.json()).catch(() => ({}));
    }
    const env = this.mouths?.[file];
    if (!env) return () => 0.35 + Math.sin(time() * 17) * 0.3; // (no envelope: a plain flap)
    return () => {
      const i = Math.floor(time() * 25);
      return i < env.length ? (env.charCodeAt(i) - 48) / 9 : 0;
    };
  }

  update(dt: number) {
    this.frame++;
    if (this.me) {
      const at = this.env.root.worldToLocal(this.env.eyes().clone());
      this.me.obj.position.set(at.x, this.env.ground(at.x, at.z, at.y), at.z);
      this.me.obj.rotation.y = Math.PI - this.env.heading();
      this.me.update(dt);
    }
    const eyes = this.env.eyes();
    let k = 0;
    for (const a of this.actors.values()) {
      k++;
      if (!a.visible) continue;
      // the far ones move less often: a crowd's back rows every third frame
      const far = a.obj.getWorldPosition(new Vector3()).distanceTo(eyes) > 7;
      a.pending += dt;
      if (far && (this.frame + k) % 3) continue;
      a.update(a.pending);
      a.pending = 0;
    }
  }

  dispose() {
    this.me?.dispose();
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.group.removeFromParent();
  }
}
