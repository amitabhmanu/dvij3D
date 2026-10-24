// The people lab (dev only, /dev/lab/people): one of the story's people alone, lit as for a portrait, seen from any
// angle, for the lifelike pilot's likeness rig (pipeline/likeness/score.py) and its matched comparisons. The person is
// made by the cast's own code (cast.ts), so what is seen here is what the story shows.
import {
  Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import people from "../../content/generated/people.json";
import { Cast, type PeopleInfo } from "./cast";
import { walkAsset } from "../walk/walk-data";

export type View = {
  /** Degrees: the camera round the head from straight in front (+ to the person's left), and above it (+ up). */
  yaw?: number; pitch?: number;
  /** Vertical field of view (degrees) and distance from the eyes (m): a 50-85 mm portrait lens is 27-16 degrees. */
  fov?: number; dist?: number;
  /** Where they look: at the camera, or straight ahead. */
  look?: "camera" | "ahead";
  /** A held expression (0..1 each). */
  face?: { smile?: number; frown?: number; brows?: number };
  /** Seconds of life to play first (the breath, the eyes): the same each time for a person. */
  settle?: number;
  background?: string;
};

export function startLab(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);
  const scene = new Scene();
  scene.background = new Color("#8f8b86");
  const pm = new PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  // a portrait's light: a soft warm key high on one side, a cool fill low on the other, a rim behind for the hair
  const key = new DirectionalLight("#fff2e2", 2.4); key.position.set(1.2, 2.4, 2.0);
  const fill = new DirectionalLight("#dfe8ff", 0.7); fill.position.set(-2.0, 1.2, 1.4);
  const rim = new DirectionalLight("#fff6ea", 1.6); rim.position.set(-0.6, 2.2, -2.2);
  scene.add(key, fill, rim, new HemisphereLight("#efe6da", "#5a4a3c", 0.45));
  const root = new Group();
  scene.add(root);
  const camera = new PerspectiveCamera(22, canvas.width / canvas.height, 0.02, 50);
  let cast: Cast | null = null;
  let who = "";
  const lab = {
    async load(name: string) {
      cast?.dispose();
      who = name;
      cast = new Cast(people as PeopleInfo, {
        root, ground: () => 0, eyes: () => camera.position.clone(), prop: () => null, url: walkAsset,
        seen: () => true, heading: () => 0,
      });
      await cast.setUp([{ who: name, at: [0, 0], pose: "stand", face: [0, 5] }]);
      return !!cast.get(name);
    },
    /** Draw the person from a view; returns the picture as a data URL (JPEG). */
    shot(v: View = {}, w = 768, h = 768): string {
      const a = cast?.get(who);
      if (!a) return "";
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = v.fov ?? 22;
      camera.updateProjectionMatrix();
      if (v.background) scene.background = new Color(v.background);
      a.express({ smile: 0, frown: 0, brows: 0, ...(v.face ?? {}) });
      const head = () => a.headAt().add(new Vector3(0, -0.07, 0)); // (headAt is a little over the eyes)
      // place the camera, then let them live a moment looking at it (or ahead), then place it again on the head
      const put = () => {
        const yaw = ((v.yaw ?? 0) * Math.PI) / 180, pitch = ((v.pitch ?? 0) * Math.PI) / 180, d = v.dist ?? 1.0;
        const at = head();
        camera.position.set(at.x + Math.sin(yaw) * Math.cos(pitch) * d, at.y + Math.sin(pitch) * d, at.z + Math.cos(yaw) * Math.cos(pitch) * d);
        camera.lookAt(at);
      };
      put();
      a.lookAt(v.look === "ahead" ? null : () => camera.position.clone());
      const steps = Math.round((v.settle ?? 1.2) * 60);
      for (let i = 0; i < steps; i++) a.update(1 / 60);
      put();
      renderer.render(scene, camera);
      return canvas.toDataURL("image/jpeg", 0.92);
    },
    renderer,
  };
  (window as unknown as { lab: typeof lab }).lab = lab;
  return lab;
}
