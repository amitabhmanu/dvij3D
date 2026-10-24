// The story's people on the stage (design §10.4, graphics phase 5): the Professor, Bhavi, Maharaj,
// Mahant, Baldev, Vaidji and the rest, each a rigged body with its clips (pipeline/build_people.py).
// They stand, sit, walk and gesture as the scenes' `actor` beats say; between beats they breathe,
// blink and look at whoever is talking; as they speak their mouths move with their voices' loudness
// and brightness (pipeline/build_people.py) and their hands move with the talk. The cast list is in each scene's
// yaml; everyone in it is placed at the scene's start, and hidden until they come on if they enter.
import {
  AnimationMixer, Box3, Color, Group, LoopOnce, LoopRepeat, MeshPhysicalMaterial, Quaternion, Sphere, Vector3,
  type AnimationAction, type MeshStandardMaterial, type AnimationClip, type Bone, type Material, type Mesh, type Object3D, type SkinnedMesh,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { aim, bindLook, look, reach } from "./ik";
import { FaceLife } from "./face-life";
import { eyeMaterial, softCards } from "./eyes";
import { IdleLife, type Body as IdleBody } from "./idle";
import { pickUp, putDown, show } from "./handling";
import { SELF_LAYER } from "../walk/game";

const q0 = new Quaternion();

/** Turn a bone about a world axis by `rad`, over the pose it has. */
function bendAbout(b: Bone, axis: Vector3, rad: number) {
  if (!rad || !b.parent) return;
  const world = b.getWorldQuaternion(new Quaternion()).premultiply(new Quaternion().setFromAxisAngle(axis.normalize(), rad));
  b.quaternion.copy(b.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
  b.updateMatrixWorld(true);
}

/** Rhubarb Lip Sync's mouth shapes as [jaw open, lips wide, lips rounded, lips pressed] (the jaw scaled by loudness). */
const VISEME: Record<string, [number, number, number, number]> = {
  A: [0, 0, 0, 0.9], // m, b, p: shut
  B: [0.15, 0.55, 0, 0], // k, s, t, ee: the teeth together, lips drawn
  C: [0.4, 0.35, 0, 0], // eh, ae
  D: [0.75, 0.2, 0, 0], // ah: wide open
  E: [0.35, 0, 0.45, 0], // aw, er: rounded
  F: [0.12, 0, 1, 0], // oo, w: puckered
  G: [0.1, 0.25, 0, 0.45], // f, v: the lower lip under the teeth
  H: [0.3, 0.15, 0, 0], // l: the tongue up
  X: [0, 0, 0, 0], // at rest
};

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
  /** The lifelike layers (eyes.ts, skin, hair): on unless the quality is low. */
  lifelike?: boolean;
};
export type PeopleInfo = { people: Record<string, { file: string; height: number; face?: { smile?: number; frown?: number; brows?: number } }>; mouths?: string };

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
/** When, in Fixing_Kneeling, he is down on one knee and settled (seconds; lifelike pilot, the clip sampled). */
const KNEEL_AT = 1.6;
const WALK_SPEED = 1.05; // m/s (the old and the heavy go a little slower)
const SLOW: Record<string, number> = { professor: 0.85, vaidji: 0.8, maharaj: 0.9, baldev: 0.95 };

type Layer = {
  /** Bend at the waist (radians, forward +) and of the head (down +). */
  spine?: number; head?: number;
  /** Where the hands go (world), and how far the elbows point out. */
  handL?: Vector3 | null; handR?: Vector3 | null;
  /** Where the feet go (world): crossed under the knees, for sitting on the ground. */
  footL?: Vector3 | null; footR?: Vector3 | null;
  /** How far what the right hand holds is tipped forward (radians): a pitcher pouring. */
  tilt?: number;
  /** The hands turned in, each towards the other arm's elbow: tucked, as in arms folded. */
  tuck?: boolean;
  /** How much of each hand's reach to lay on (0..1, default 1): a hand let go of over a blend. */
  wL?: number; wR?: number;
};
/** Two layers mixed, `k` of the way from `a` to `b`: a gesture taking over from the one before, no pop. */
function mixLayers(a: Layer, b: Layer, k: number): Layer {
  const n = (x = 0, y = 0) => x + (y - x) * k;
  const hand = (x?: Vector3 | null, y?: Vector3 | null, wx = 1, wy = 1): [Vector3 | null, number] =>
    x && y ? [x.clone().lerp(y, k), n(wx, wy)] : y ? [y, wy * k] : x ? [x, wx * (1 - k)] : [null, 0];
  const [handL, wL] = hand(a.handL, b.handL, a.wL ?? 1, b.wL ?? 1), [handR, wR] = hand(a.handR, b.handR, a.wR ?? 1, b.wR ?? 1);
  return { spine: n(a.spine, b.spine), head: n(a.head, b.head), tilt: n(a.tilt, b.tilt), handL, handR, wL, wR,
           footL: b.footL ?? a.footL, footR: b.footR ?? a.footR, tuck: k < 0.5 ? a.tuck : b.tuck };
}
export type Gesture = { seconds: number; hold?: boolean; clip?: string; at: (a: Actor, t: number) => Layer };

/** Each main character's own gestures while they talk (keyed() below; their manner in the novel and the comic). */
const TALK: Record<string, string[]> = {
  professor: ["lecture", "explain", "spectacles", "lecture"], // (b1-p007-2: all hands, mid-digression)
  mahant: ["raised-palm", "hand-on-chest"],
  baldev: ["jab", "wave-off"],
  maharaj: ["palms-up", "hand-on-chest"],
  bhavi: ["tuck-hair", "open-hand", "hand-to-chin"],
  vaidji: ["palms-up", "hand-on-chest"], // (overblown: the palms spread, the hand to the heart)
  attendant: ["hand-on-chest"], // (obsequious)
};
/** Those of them that keep the hands by the body: for talking face to face, close up. */
const CLOSE_TALK = new Set(["tuck-hair", "hand-to-chin", "hand-on-chest", "spectacles"]);

const up = (a: Actor, h: number, fwd = 0.3, side = 0) => a.point(side, h, fwd);
/** A hand's place in a keyframe: [height (m, as if stood), forward of the chest, to the right], or none (the clip's). */
type Hand = [number, number, number] | null;
type Key = { t: number; spine?: number; head?: number; l?: Hand; r?: Hand };
/** A gesture keyed by hand, as an animator keys one: poses at moments through it (t: 0..1), eased from each to the next. */
function keyed(seconds: number, keys: Key[]): Gesture {
  const ease = (x: number) => x * x * (3 - 2 * x);
  return {
    seconds,
    at: (a, t) => {
      let k = 0;
      while (k < keys.length - 2 && t > keys[k + 1].t) k++;
      const A = keys[k], B = keys[Math.min(k + 1, keys.length - 1)];
      const f = B.t > A.t ? ease(Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)))) : 0;
      const mix = (x = 0, y = 0) => x + (y - x) * f;
      const hand = (x?: Hand, y?: Hand) => (x && y ? up(a, mix(x[0], y[0]), mix(x[1], y[1]), mix(x[2], y[2])) : null);
      return { spine: mix(A.spine, B.spine), head: mix(A.head, B.head), handL: hand(A.l, B.l), handR: hand(A.r, B.r) };
    },
  };
}

/** The story's gestures that the clip library hasn't got: poses laid over the pose's own loop. */
const GESTURES: Record<string, Gesture> = {
  // keyed by hand, for talk: each person's own way of speaking with their hands (talk(), below)
  // the Professor lecturing: the right palm raised, swept across as he makes his point, beat twice on it
  lecture: keyed(2.6, [{ t: 0, r: [1.15, 0.3, 0.12] }, { t: 0.25, r: [1.42, 0.38, 0.22], head: -0.05 }, { t: 0.5, r: [1.38, 0.4, -0.05] },
                       { t: 0.62, r: [1.3, 0.42, -0.02], head: 0.06 }, { t: 0.74, r: [1.38, 0.4, -0.05] }, { t: 0.86, r: [1.3, 0.42, -0.02], head: 0.06 }, { t: 1, r: [1.15, 0.3, 0.12] }]),
  // both hands holding up an idea between them, opened out
  explain: keyed(2.4, [{ t: 0, l: [1.1, 0.28, -0.14], r: [1.1, 0.28, 0.14] }, { t: 0.3, l: [1.3, 0.38, -0.09], r: [1.3, 0.38, 0.09] },
                       { t: 0.65, l: [1.32, 0.4, -0.26], r: [1.32, 0.4, 0.26], spine: 0.06 }, { t: 1, l: [1.1, 0.28, -0.14], r: [1.1, 0.28, 0.14] }]),
  // the spectacles pushed up the nose with a finger
  spectacles: keyed(1.6, [{ t: 0, r: [1.15, 0.3, 0.1] }, { t: 0.4, r: [1.62, 0.13, 0.0], head: 0.05 }, { t: 0.6, r: [1.64, 0.12, 0.0], head: 0.05 }, { t: 1, r: [1.15, 0.3, 0.1] }]),
  // a palm raised slowly before the chest and held, as one who expects to be heard (Mahant)
  "raised-palm": keyed(3.0, [{ t: 0, l: [1.05, 0.25, -0.12] }, { t: 0.35, l: [1.38, 0.32, -0.1], head: -0.06 }, { t: 0.75, l: [1.4, 0.32, -0.1], head: -0.06 }, { t: 1, l: [1.05, 0.25, -0.12] }]),
  // a jab of the hand at whoever he's telling (Baldev)
  jab: keyed(1.6, [{ t: 0, r: [1.1, 0.3, 0.15] }, { t: 0.3, r: [1.3, 0.55, 0.05], spine: 0.1 }, { t: 0.45, r: [1.26, 0.4, 0.08] },
                   { t: 0.6, r: [1.3, 0.56, 0.05], spine: 0.12 }, { t: 1, r: [1.1, 0.3, 0.15] }]),
  // both palms up and out: what can one do (Maharaj)
  "palms-up": keyed(2.0, [{ t: 0, l: [1.0, 0.25, -0.15], r: [1.0, 0.25, 0.15] }, { t: 0.4, l: [1.12, 0.36, -0.32], r: [1.12, 0.36, 0.32], head: -0.08 },
                          { t: 0.65, l: [1.12, 0.36, -0.32], r: [1.12, 0.36, 0.32], head: -0.08 }, { t: 1, l: [1.0, 0.25, -0.15], r: [1.0, 0.25, 0.15] }]),
  // a lock of hair tucked behind her ear (Bhavi)
  "tuck-hair": keyed(1.8, [{ t: 0, r: [1.1, 0.28, 0.1] }, { t: 0.4, r: [1.58, 0.06, 0.1], head: -0.1 }, { t: 0.6, r: [1.56, 0.02, 0.11], head: -0.1 }, { t: 1, r: [1.1, 0.28, 0.1] }]),
  // an open hand turned out as she says it
  "open-hand": keyed(1.8, [{ t: 0, l: [1.05, 0.26, -0.12] }, { t: 0.4, l: [1.25, 0.4, -0.25], head: 0.05 }, { t: 0.7, l: [1.25, 0.4, -0.25], head: 0.05 }, { t: 1, l: [1.05, 0.26, -0.12] }]),
  namaste: { seconds: 2.4, at: (a) => ({ spine: 0.35, head: 0.3, handL: up(a, 1.18, 0.28, -0.02), handR: up(a, 1.18, 0.28, 0.02) }) },
  supplicate: { seconds: 3.2, at: (a, t) => { const k = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); return { spine: 1.1 * k, head: 0.4 * k, handL: up(a, 1.2 - 0.3 * k, 0.3 + 0.15 * k, -0.02), handR: up(a, 1.2 - 0.3 * k, 0.3 + 0.15 * k, 0.02) }; } },
  pray: { seconds: 1.2, hold: true, at: (a) => ({ head: 0.15, handL: up(a, 1.16, 0.26, -0.015), handR: up(a, 1.16, 0.26, 0.015) }) },
  bow: { seconds: 1.8, at: () => ({ spine: 0.45, head: 0.35 }) },
  nod: { seconds: 1.0, at: (_a, t) => ({ head: Math.sin(t * Math.PI * 2) * 0.22 }) },
  laugh: { seconds: 1.6, at: (_a, t) => ({ spine: -0.12 + Math.sin(t * 40) * 0.03, head: -0.35 }) },
  "lean-in": { seconds: 1.0, hold: true, at: () => ({ spine: 0.3, head: 0.1 }) },
  "finger-raise": { seconds: 1.8, at: (a) => (a.holding ? { handL: up(a, 1.5, 0.3, -0.18) } : { handR: up(a, 1.5, 0.3, 0.18) }) }, // (the free hand, if the right holds something)
  point: { seconds: 1.6, at: (a) => ({ spine: 0.1, handR: a.toward(a.eyesOf(), 0.55, -0.2) }) },
  // (the wrists at the middle, the fingers tucked towards the other elbow)
  "fold-arms": { seconds: 1.0, hold: true, at: (a) => ({ handL: up(a, 1.2, 0.25, 0.06), handR: up(a, 1.12, 0.18, -0.06), tuck: true }) },
  "hand-to-chin": { seconds: 2.4, at: (a) => ({ head: 0.1, handR: up(a, 1.48, 0.14, 0.02) }) },
  "hand-to-mouth": { seconds: 2.4, at: (a) => ({ head: 0.15, handR: up(a, 1.52, 0.12, 0.0) }) },
  // something held up to show him, turned to him, at the height of the face (the Professor "holds things up to the light", b1-p007-4)
  show: { seconds: 1.2, hold: true, at: (a) => show(a) },
  "hand-on-chest": { seconds: 1.8, at: (a) => ({ handR: up(a, 1.28, 0.16, -0.05) }) },
  "mop-brow": { seconds: 2.0, at: (a, t) => ({ head: 0.15, handR: up(a, 1.64, 0.12, 0.08 - Math.sin(t * Math.PI * 3) * 0.08) }) },
  "wipe-eyes": { seconds: 1.8, at: (a, t) => ({ head: 0.2, handR: up(a, 1.56, 0.1, Math.sin(t * Math.PI * 4) * 0.04) }) },
  offer: { seconds: 1.5, hold: true, at: (a) => ({ spine: 0.15, handL: a.toward(a.eyesOf(), 0.5, -0.45, -0.12), handR: a.toward(a.eyesOf(), 0.5, -0.45, 0.12) }) },
  give: { seconds: 1.4, at: (a) => ({ spine: 0.12, handR: a.toward(a.eyesOf(), 0.55, -0.35) }) },
  // the pitcher raised over the tumbler and tipped, then righted (comic b1-p012-5)
  pour: { seconds: 2.6, at: (a, t) => ({ spine: 0.2, head: 0.3, handL: up(a, 0.98, 0.4, -0.08), handR: up(a, 1.18, 0.42, 0.04),
                                          tilt: 1.2 * Math.sin(Math.min(1, Math.max(0, (t - 0.2) / 0.6)) * Math.PI) }) },
  // the thumb to Dvij's forehead, drawn up it, and away (¶314)
  tilak: { seconds: 2.8, at: (a, t) => {
    const k = Math.min(1, t / 0.35), stroke = Math.min(1, Math.max(0, (t - 0.4) / 0.35));
    return { spine: 0.1 * k, handR: a.eyesOf().add(new Vector3(0, 0.03 + 0.07 * stroke, 0)).addScaledVector(a.facing(), 0.05 + 0.1 * (1 - k)) };
  } },
  // a palm raised over his head, laid on it (comic b1-p014-5, b1-p015-8)
  bless: { seconds: 2.8, at: (a, t) => ({ spine: 0.08, head: 0.1, handR: a.eyesOf().add(new Vector3(0, 0.24 - 0.1 * Math.min(1, t / 0.45), 0)) }) },
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
// Skin: light under it comes back out warm and soft, most at the edges turned from the light (a sheen of red
// stands in for that, cheaply); one for every copy of a person.
const skins = new WeakMap<Material, Material>();
function skinOf(mat: Material): Material {
  let s = skins.get(mat);
  if (!s) {
    const m = mat as MeshStandardMaterial;
    s = new MeshPhysicalMaterial({
      name: m.name, map: m.map, normalMap: m.normalMap, normalScale: m.normalScale, roughness: 0.58, metalness: 0,
      sheen: 0.5, sheenColor: new Color(0.9, 0.38, 0.28), sheenRoughness: 0.55, specularIntensity: 0.6,
    });
    skins.set(mat, s);
  }
  return s;
}

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
  private morphs: { mesh: Mesh; blink: number[]; jaw?: number; smile?: number; brows: number[]; frown?: number;
                     pucker?: number; wide?: number; close?: number }[] = [];
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
  /** Where the eyes go, how the head follows, the blinks (face-life.ts). */
  private life: FaceLife;
  /** The breath, the weight from foot to foot, the chest joining big looks (idle.ts). */
  private idle: IdleLife;
  private idleBody: IdleBody;
  private wasTalking = false;
  /** The layer a new gesture takes over from, and how much of it was on. */
  private from: { layer: Layer; w: number } | null = null;
  private mouth: (() => number) | null = null;
  private tone: (() => number) | null = null;
  /** The lips' shape now, as Rhubarb Lip Sync's letter for it (A..H, X; pipeline/build_people.py's shapes()), if known. */
  private viseme: (() => string) | null = null;
  /** The lips' and jaw's shape keys, eased towards the viseme's. */
  private lips = { jaw: 0, wide: 0, pucker: 0, close: 0 };
  /** Talking: a moment before the next gesture of the hands (talk(), TALK). */
  private nextTalkGesture = 1.5 + Math.random() * 2;
  /** The hanging cloth's swing (radians; forward of the hips, and to their left), its speed, and where the hips were. */
  private swing = { f: 0, s: 0, vf: 0, vs: 0, at: null as Vector3 | null, yaw: 0 };
  private jaw = 0;
  private bright = 0.5;
  /** Shut between words: the lips pressed for a moment after a syllable (m, b, p), eased. */
  private shut = 0;
  private t = Math.random() * 10;
  private carried: Object3D | null = null;
  private hidden = false;
  talking = false;
  /** Time not yet played (a far one is moved every few frames). */
  pending = 0;
  /** Doing something (walking, turning, a gesture coming or going): moved every frame. */
  get busy() { return !!(this.path.length || this.loopRim || this.turning || this.gesture); }

  constructor(readonly who: string, made: { scene: Object3D; clips: AnimationClip[] }, private env: CastEnv) {
    this.life = new FaceLife(who);
    this.idle = new IdleLife(who);
    this.idleBody = { bone: (n) => this.bone(n), obj: this.obj, bend: bendAbout };
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
        // (a skinned body's own bounds would follow its pose: a sphere round the whole of it, generous, is cheaper and safe)
        m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox!;
        m.boundingSphere = new Sphere(box.getCenter(new Vector3()), box.getSize(new Vector3()).length() * 0.9);
        m.frustumCulled = true;
        const d = m.morphTargetDictionary;
        if (d && Object.keys(d).length) {
          this.morphs.push({ mesh: m, blink: [d.eyeBlinkLeft, d.eyeBlinkRight].filter((x) => x != null), jaw: d.jawOpen, smile: d.mouthSmileLeft,
                             brows: [d.browInnerUp, d.browOuterUpRight].filter((x) => x != null), frown: d.mouthFrownLeft,
                             pucker: d.mouthPucker, wide: d.mouthStretchLeft, close: d.mouthClose });
        }
        // hair, brows, lashes, the tilak: cut out where their textures are clear, not blended (no sorting troubles);
        // the brows and lashes soft-edged by the multisampling, and the eyes layered (eyes.ts), unless kept plain
        const life = env.lifelike !== false;
        for (const mat of ([] as Material[]).concat(m.material)) {
          if (mat.transparent) { mat.transparent = false; mat.alphaTest = 0.5; mat.depthWrite = true; }
          if (life && /^(eyebrows|eyelashes)/.test(mat.name)) softCards(mat);
        }
        if (!Array.isArray(m.material) && m.material.name.startsWith("skin")) m.material = skinOf(m.material);
        if (life && !Array.isArray(m.material) && m.material.name === "eyes") m.material = eyeMaterial(m.material, who.split(/[#-]/)[0], m, this.model);
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
    next.timeScale = 1; // (a held pose, the kneel, leaves it stopped)
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
    if (pose === "kneel" && this.base) {
      // the kneeling clip kneels, works at something on the floor, stands and kneels again: held still, knelt
      this.base.time = KNEEL_AT;
      this.base.timeScale = 0;
    }
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
  /** On their feet with their back half turned to `p` (frame metres): turn to it, as one does to talk to someone (the head alone can't reach). */
  turnToFace(p: V2) {
    if (this.pose !== "stand" || this.path.length || this.loopRim || this.turning) return;
    const want = Math.atan2(p[0] - this.obj.position.x, p[1] - this.obj.position.z);
    const off = Math.atan2(Math.sin(want - this.obj.rotation.y), Math.cos(want - this.obj.rotation.y));
    if (Math.abs(off) > 1.1 && Math.hypot(p[0] - this.obj.position.x, p[1] - this.obj.position.z) < 6) void this.turnTo(p, 0.9);
  }
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
    this.letGo(); // (a held gesture, the tumbler offered, doesn't walk with him)
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

  /** While they talk, now and then one of their own gestures (TALK), unless the story has them doing something else. */
  private talkHands(dt: number) {
    const own = TALK[this.who.split("#")[0]];
    if (!own || !this.talking || this.gesture || this.carried || Object.keys(this.held).length || this.path.length || this.turning) return;
    if (this.pose !== "stand" && this.pose !== "sit") return;
    this.nextTalkGesture -= dt;
    if (this.nextTalkGesture > 0) return;
    this.nextTalkGesture = 2.5 + Math.random() * 3.5;
    // right up to him (at work on his forehead): only what stays by their own body, not a hand thrust into his face
    const eyes = this.env.eyes(), at = this.obj.getWorldPosition(new Vector3());
    const near = Math.hypot(eyes.x - at.x, eyes.z - at.z) < 1.0;
    const can = near ? own.filter((g) => CLOSE_TALK.has(g)) : own;
    if (can.length) void this.act(can[Math.floor(Math.random() * can.length)]);
  }

  /** A held gesture let go of, eased out. */
  letGo() {
    if (Object.keys(this.held).length) { this.from = { layer: this.held, w: this.layerW }; this.held = {}; }
    if (this.gesture?.g.hold) this.gesture.done();
  }

  /** Is the right hand holding something? */
  get holding() { return !!this.carried; }

  /** Play a gesture or a clip once; resolves as it ends (a held gesture stays until the next). */
  act(name: string): Promise<void> {
    const g = GESTURES[name];
    return g ? this.perform(g) : Promise.resolve();
  }

  /** Play a gesture made for the moment (handling.ts: a reach for something where it lies). */
  perform(g: Gesture): Promise<void> {
    if (this.layerW > 0.02) this.from = { layer: this.layer, w: this.layerW }; // (the one before, blended out under it)
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
    if (this.carried && this.carried !== obj) { this.carried.visible = false; this.carried.removeFromParent(); } // (given away, or put aside for the next)
    this.carried = obj;
    if (obj) {
      obj.visible = true;
      if (obj.parent) obj.parent.visible = true;
      // it rides with the body, its middle in the palm, kept upright (update): where its middle is, in its own frame
      obj.removeFromParent();
      obj.position.set(0, 0, 0);
      obj.quaternion.identity();
      obj.scale.setScalar(1);
      obj.updateMatrixWorld(true); // (on its own, its world is its own frame)
      this.grip = new Box3().setFromObject(obj).getCenter(new Vector3());
      this.obj.add(obj);
    }
  }
  private grip = new Vector3();

  /** Put what the right hand holds down into `into`, its foot on `at` (world), upright. */
  release(into: Object3D, at: Vector3) {
    const o = this.carried;
    if (!o) return;
    this.carried = null;
    into.attach(o);
    // upright: only its turn about the vertical kept
    const ahead = new Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(ahead.x, ahead.z));
    o.quaternion.copy(into.getWorldQuaternion(new Quaternion()).invert().multiply(q));
    o.updateMatrixWorld(true);
    // then moved so the middle of its foot is on the spot
    const box = new Box3().setFromObject(o);
    const foot = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    o.position.copy(into.worldToLocal(o.getWorldPosition(new Vector3()).add(at.clone().sub(foot))));
    o.updateMatrixWorld(true);
  }

  /** Where what the right hand holds was taken from (its prop's own group), to put it back into. */
  carriedHome(): Object3D | null { return this.carried ? (this.carried.userData.home as Object3D) ?? this.obj.parent : null; }
  /** How tall what the right hand holds is (m). */
  carriedHeight(): number { return this.carried ? new Box3().setFromObject(this.carried).getSize(new Vector3()).y : 0; }

  /** The palm's middle now (world): where a held thing's middle rides. */
  palm(): Vector3 | null {
    const hand = this.bone("hand_r"), mid = this.bone("middle_01_r");
    return hand && mid ? hand.getWorldPosition(new Vector3()).lerp(mid.getWorldPosition(new Vector3()), 0.55) : null;
  }

  /** Where the right shoulder is (world). */
  shoulder(): Vector3 { return (this.bone("upperarm_r") ?? this.obj).getWorldPosition(new Vector3()); }

  /** What the right hand holds, in the palm, upright but for a tip forward; the fingers closed round it. */
  private carry(tilt: number) {
    const o = this.carried, hand = this.bone("hand_r"), mid = this.bone("middle_01_r");
    if (o && o.parent !== this.obj) { this.carried = null; this.letGo(); return; } // (taken from him: Dvij has the tumbler now, hands.ts; the offering hand comes down)
    if (!o || !hand || !mid) return;
    for (const f of ["index", "middle", "ring", "pinky"]) {
      for (const k of [1, 2, 3]) this.bone(`${f}_0${k}_r`)?.rotateX(k === 1 ? 0.55 : 0.7);
    }
    this.bone("thumb_02_r")?.rotateX(0.35);
    hand.updateMatrixWorld(true);
    const palm = hand.getWorldPosition(new Vector3()).lerp(mid.getWorldPosition(new Vector3()), 0.55);
    const body = this.obj.getWorldQuaternion(new Quaternion());
    const right = new Vector3(-1, 0, 0).applyQuaternion(body);
    const q = new Quaternion().setFromAxisAngle(right, -tilt).multiply(body);
    const at = palm.sub(this.grip.clone().applyQuaternion(q));
    o.quaternion.copy(body.clone().invert().multiply(q));
    o.position.copy(this.obj.worldToLocal(at));
    o.updateMatrixWorld(true);
  }

  /** Speak: the mouth follows the voice's loudness (0..1, by the clip's time), and the hands the talk. */
  speak(level: (() => number) | null, bright: (() => number) | null = null, shape: (() => string) | null = null) {
    this.mouth = level;
    this.tone = bright;
    this.viseme = level ? shape : null;
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
    this.idle.undo(this.idleBody);
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
      const ease = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
      const rise = ease(this.gesture.t / 0.45), fall = g.hold ? 1 : ease((g.seconds - this.gesture.t) / 0.45);
      this.layerW = Math.min(rise, fall);
      // taking over from the gesture before: from its pose into this one, not from the clip's
      if (this.from && rise < 1) { layer = mixLayers(this.from.layer, layer, rise); this.layerW = Math.min(fall, this.from.w + (1 - this.from.w) * rise); }
      else this.from = null;
      if (k >= 1) { const d = this.gesture.done; d(); }
    } else if (this.from) { // a held gesture let go of: eased out of its own pose
      this.layerW = Math.max(0, this.layerW - dt * 2.2);
      layer = this.from.layer;
      if (this.layerW <= 0) this.from = null;
    } else this.layerW = Object.keys(this.held).length ? Math.min(1, this.layerW + dt * 3) : Math.max(0, this.layerW - dt * 3);
    this.layer = layer;
    if (this.lean) this.pose_({ spine: this.lean }, 1);
    const tilt = (this.layer.tilt ?? 0) * this.layerW;
    if (this.pose === "crosslegged") {
      // the legs folded, each foot under the other knee, the knees out and down; the back straight
      this.pose_({ spine: -0.25, footL: this.onFloor(0.14, 0.24), footR: this.onFloor(-0.14, 0.16) }, 1);
    }
    if (this.pose === "kneel") {
      // knelt by him: the back up a little from the clip's stoop; the left hand on the knee; what the right holds, off the floor
      this.pose_({ spine: -0.2, head: -0.1, handL: this.point(-0.16, 0.95, 0.32), handR: this.carried ? this.point(0.14, 1.05, 0.34) : null }, 1);
    }
    this.pose_(this.layer, this.layerW);
    // between beats: the breath, and stood still, the weight from foot to foot (the feet kept planted)
    const still = this.pose === "stand" && !this.path.length && !this.loopRim && !this.turning && !this.gesture && !Object.keys(this.held).length && !this.from;
    this.idle.apply(dt, this.idleBody, still, this.talking, this.talking && !this.wasTalking);
    this.wasTalking = this.talking;
    this.carry(tilt);
    // the eyes and head: towards what they look at (eased), within a neck's reach
    const target = typeof this.gaze === "function" ? this.gaze() : this.gaze;
    this.gazeW += ((target ? 1 : 0) - this.gazeW) * Math.min(1, dt * 3);
    const neck = this.bone("neck_01"), head = this.bone("head");
    // the head turns to an eased aim (no snaps when the speaker changes), and a share of the way the eyes look off
    const aimAt = this.life.headTarget(dt, target, this.talking, head?.getWorldPosition(new Vector3()));
    this.idle.chestTo(this.idleBody, aimAt, this.gazeW); // (a look further round than the neck goes takes the chest with it)
    if (neck && head && aimAt) look(neck, head, aimAt, this.facing(), this.gazeW * 0.9);
    // never quite still: the head drifts a little, more when talking (a nod to the words, a turn of thought)
    if (head) {
      const k = this.talking ? 1 : 0.4;
      bendAbout(head, new Vector3(-1, 0, 0).applyQuaternion(this.obj.getWorldQuaternion(q0)), (Math.sin(this.t * 0.7) * 0.02 + Math.sin(this.t * 1.9 + 1) * 0.012) * k - this.jaw * 0.04);
      bendAbout(head, new Vector3(0, 1, 0), (Math.sin(this.t * 0.43 + 2) * 0.03 + Math.sin(this.t * 1.3) * 0.01) * k);
    }
    this.talkHands(dt);
    // the skirts, the lungi, the dhoti's pleats swing on their spring bones (blender/build_human.py SPRINGS): lagging
    // behind the hips as they move and turn, overshooting, settling; swaying a little with each step
    const pelvis = this.bone("pelvis"), springs = ["skirt_f", "skirt_b", "skirt_l", "skirt_r"].map((n) => this.bone(n)).filter((b) => b) as Bone[];
    if (pelvis && springs.length) {
      const sw = this.swing, at = pelvis.getWorldPosition(new Vector3()), yaw = this.obj.rotation.y;
      if (sw.at && dt > 0 && dt < 0.2) {
        const v = at.clone().sub(sw.at).divideScalar(dt).applyQuaternion(this.obj.getWorldQuaternion(new Quaternion()).invert());
        const turn = Math.atan2(Math.sin(yaw - sw.yaw), Math.cos(yaw - sw.yaw)) / dt;
        const step = Math.min(1, Math.hypot(v.x, v.z) / 1.2) * Math.sin(this.t * 5.6) * 0.05;
        const goalF = Math.max(-0.3, Math.min(0.3, -0.14 * v.z)), goalS = Math.max(-0.3, Math.min(0.3, -0.14 * v.x + 0.05 * turn + step));
        sw.vf += (40 * (goalF - sw.f) - 6 * sw.vf) * dt;
        sw.vs += (40 * (goalS - sw.s) - 6 * sw.vs) * dt;
        sw.f = Math.max(-0.4, Math.min(0.4, sw.f + sw.vf * dt));
        sw.s = Math.max(-0.4, Math.min(0.4, sw.s + sw.vs * dt));
      }
      sw.at = at;
      sw.yaw = yaw;
      const body = this.obj.getWorldQuaternion(new Quaternion());
      const right = new Vector3(-1, 0, 0).applyQuaternion(body), ahead = new Vector3(0, 0, 1).applyQuaternion(body);
      for (const b of springs) { bendAbout(b, right.clone(), sw.f); bendAbout(b, ahead.clone(), sw.s); }
    }
    // the eyes: on the target, both converging on it, the saccades, looks away and blinks of face-life.ts
    const blink = head ? this.life.eyes(dt, head, this.bone("eye_l"), this.bone("eye_r"), this.gazeW > 0.5 ? target : null, bendAbout) : 0;
    // Baldev chews his tobacco between words (¶108): the jaw working slowly, a pause now and then
    const chew = this.who.startsWith("baldev") && !this.mouth ? Math.max(0, Math.sin(this.t * 5.5)) * 0.12 * (Math.sin(this.t * 0.3) > -0.4 ? 1 : 0) : 0;
    const want = this.mouth ? this.mouth() : chew;
    const wasOpen = this.jaw;
    this.jaw += (want - this.jaw) * Math.min(1, dt * 18);
    const vis = this.viseme ? VISEME[this.viseme()] ?? VISEME.X : null;
    this.bright += ((this.tone ? this.tone() : 0.5) - this.bright) * Math.min(1, dt * 10);
    this.shut = this.mouth && want < 0.05 && wasOpen > 0.15 ? 1 : Math.max(0, this.shut - dt * 6);
    for (const m of this.morphs) {
      const inf = m.mesh.morphTargetInfluences;
      if (!inf) continue;
      for (const b of m.blink) inf[b] = blink;
      // the lips' shape: the viseme's when there is one (its jaw opened as far as the voice is loud); else wide for
      // bright sounds, rounded for dark ones, pressed shut between words
      const talking = Math.min(1, this.jaw * 2.5);
      const goal = vis ? { jaw: vis[0] * (0.55 + 0.6 * want), wide: vis[1], pucker: vis[2], close: vis[3] }
        : { jaw: this.jaw * 0.85, wide: talking * Math.max(0, this.bright - 0.45) * 1.4, pucker: talking * Math.max(0, 0.45 - this.bright) * 1.6, close: this.shut * 0.7 };
      if (m === this.morphs[0]) for (const k of ["jaw", "wide", "pucker", "close"] as const) this.lips[k] += (goal[k] - this.lips[k]) * Math.min(1, dt * 22);
      if (m.jaw != null) inf[m.jaw] = this.lips.jaw;
      if (m.wide != null) inf[m.wide] = this.lips.wide;
      if (m.pucker != null) inf[m.pucker] = this.lips.pucker;
      if (m.close != null) inf[m.close] = this.lips.close;
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
      reach(u, lo, h, goal, out, w * ((s === "l" ? l.wL : l.wR) ?? 1));
    }
    if (l.tuck) {
      for (const s of ["l", "r"] as const) {
        const h = this.bone(`hand_${s}`), tip = this.bone(`middle_01_${s}`), elbow = this.bone(`lowerarm_${s === "l" ? "r" : "l"}`);
        if (!h || !tip || !elbow) continue;
        const was = h.quaternion.clone();
        aim(h, tip.getWorldPosition(new Vector3()), elbow.getWorldPosition(new Vector3()));
        if (w < 0.999) { h.quaternion.copy(was.slerp(h.quaternion, w)); h.updateMatrixWorld(true); }
      }
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
      if (!made || this.gone) return; // (gone: the scene moved on while they loaded)
      const a = new Actor(c.who, made, this.env);
      this.group.add(a.obj);
      this.actors.set(c.who, a);
      a.express(this.info.people[c.model ?? c.who]?.face ?? {}); // their face at rest: the Professor's upturned lips, Baldev's scowl (characters.md)
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
    if (!made.length || this.gone) return;
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
      a.obj.traverse((o) => { o.castShadow = false; o.receiveShadow = false; }); // (sat still in the midday sun: shadows under them and on them cost more than they show)
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
      // a reach for it where it lies, after walking up to it (handling.ts); with nothing to take, the clip's grab
      if (h) await pickUp(ac, h, hurried);
      else if (!hurried) await ac.act(a.anim === "pick-up" || !a.anim ? "pick-up" : "interact");
    }
    if (a.put) { // [x, z] in the frame: put down on whatever is there (a desk, the floor)
      const y = this.env.ground(a.put[0], a.put[1], 2.5);
      await putDown(ac, this.env.root.localToWorld(new Vector3(a.put[0], y, a.put[1])), hurried);
    }
    if (a.wearing) ac.hold(null); // (the spectacles go on his face: the stand-ins have none to show)
    if (a.anim && !(a.take && (a.anim === "pick-up" || a.anim === "talk")) && !hurried) await ac.act(a.anim);
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
      if (name === who) { a.speak(level); a.lookAt(() => this.env.eyes()); a.turnToFace(this.playerAt()); }
      else {
        a.speak(null);
        const s = who ? this.actors.get(who) : null;
        if (who === "dvij") a.lookAt(() => this.env.eyes());
        else if (s?.visible) a.lookAt(() => s.headAt());
      }
    }
  }

  /** A voice file's loudness and brightness over its time (0..1 each, 25 a second), for a mouth: from
   * pipeline/build_people.py's mouths(). Loud opens the jaw; bright (ee, ay) draws the lips wide, dark (oo, oh) rounds them. */
  async level(file: string, time: () => number): Promise<{ open: () => number; bright: () => number; shape: (() => string) | null }> {
    if (!this.mouths && this.info.mouths) {
      this.mouths = await fetch(this.env.url(this.info.mouths)).then((r) => r.json()).catch(() => ({}));
    }
    const [loud, tone, shapes] = (this.mouths?.[file] ?? "").split("|");
    const at = (s: string | undefined, fallback: number) => () => {
      const i = Math.floor(time() * 25);
      return s && i < s.length ? (s.charCodeAt(i) - 48) / 9 : s ? 0 : fallback;
    };
    if (!loud) return { open: () => 0.35 + Math.sin(time() * 17) * 0.3, bright: () => 0.5 + Math.sin(time() * 5) * 0.3, shape: null }; // (no envelope: a plain flap)
    const shape = shapes ? () => shapes[Math.floor(time() * 25)] ?? "X" : null;
    return { open: at(loud, 0), bright: at(tone, 0.5), shape };
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
    for (const [name, a] of this.actors) {
      k++;
      if (name.includes("#") && a.visible && !a.busy) { // a crowd sat still: a breath every sixth frame is enough
        a.pending += dt;
        if ((this.frame + k) % 6) continue;
        a.update(a.pending);
        a.pending = 0;
        continue;
      }
      if (!a.visible) continue;
      // the far ones, and those he isn't looking at, move less often: every third frame
      const at = a.obj.getWorldPosition(new Vector3());
      const d = at.distanceTo(eyes);
      const slow = d > 7 || (d > 2.5 && !this.env.seen(at.add(new Vector3(0, 1.2, 0))));
      a.pending += dt;
      if (slow && (this.frame + k) % 3) continue;
      a.update(a.pending);
      a.pending = 0;
    }
  }

  /** Disposed: anyone still loading is not to be added. */
  private gone = false;

  dispose() {
    this.gone = true;
    this.me?.dispose();
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.group.removeFromParent();
  }
}
