// Ultra quality, for Chapter 1 only (where Dvij wakes in the lodge): the picture as a film camera would take it.
// Ambient occlusion in the corners and under things, the sun's light glowing where it is brightest (bloom) and
// streaming through the boarded shutters' gaps (god rays, the dust hanging in them: lodge-fx.ts), the AgX tone
// curve and a warm grade, a shallow depth of field on what he looks at, a vignette, and soft shadows (the fan's
// too: game.ts). Other chapters, and the other qualities, keep the plain picture. Its cost on this laptop's
// integrated GPU is measured and kept in docs/ultra.md.
import {
  BloomEffect, BrightnessContrastEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, GodRaysEffect,
  HueSaturationEffect, KernelSize, NormalPass, RenderPass, SSAOEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from "postprocessing";
import {
  AdditiveBlending, CircleGeometry, Color, PlaneGeometry, HalfFloatType, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3,
  type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer,
} from "three";
import { InkEffect } from "./post";

/** Whether the Ultra look is on now (Ultra chosen, and Chapter 1 playing): read by what adds to it (the glass's splash). */
export const ultra = { on: false };

/** The chapters Ultra dresses (the rest play as High). */
export const ULTRA_SCENES = new Set(["b1-ch01"]);

export type UltraLook = {
  composer: EffectComposer;
  /** Each frame: the sun's disc kept out along its direction, and the focus eased to what's at the middle of the view. */
  update: (dt: number, sunDir: Vector3, focusOn: Object3D[]) => void;
  dispose: () => void;
};

/** Ultra's parts; a test page (?test&ultra-without=ao,dof) can leave some out, to weigh what each costs. */
const WITHOUT = new Set(typeof location !== "undefined" && new URLSearchParams(location.search).has("test")
  ? (new URLSearchParams(location.search).get("ultra-without") ?? "").split(",") : []);
export const ultraHas = (part: "ao" | "rays" | "bloom" | "dof" | "soft" | "fan") => !WITHOUT.has(part);

/** The window of the room he wakes in (west, behind its boarded shutters: story/props.ts WINDOWS), lodge frame: the
 * daylight the god rays stream from, through the gaps between the boards. */
export const WAKE_WINDOW = { at: [-15.98, 2.05, 5.25] as [number, number, number], size: [1.1, 1.3] as [number, number] };

export function ultraLook(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, extra: Effect[],
                          window: { at: Vector3; size: [number, number] } | null = null): UltraLook {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: Math.min(4, renderer.capabilities.maxSamples) });
  composer.addPass(new RenderPass(scene, camera));
  const normals = new NormalPass(scene, camera, { resolutionScale: 0.5 });
  if (ultraHas("ao")) composer.addPass(normals);

  // what the god rays stream from: the daylight in the boarded window (outside it, facing in), or else the sun's disc
  // far out along its direction, where it shows through a gap
  const glow = new MeshBasicMaterial({ color: new Color(1.0, 0.9, 0.72), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const sun = window ? new Mesh(new PlaneGeometry(window.size[0], window.size[1]), glow) : new Mesh(new CircleGeometry(14, 24), glow);
  if (window) { sun.position.copy(window.at); sun.rotation.y = Math.PI / 2; } // (facing east, into the room)
  sun.frustumCulled = false;
  sun.renderOrder = -0.5;
  scene.add(sun);

  const ao = new SSAOEffect(camera, normals.texture, {
    samples: 11, rings: 4, radius: 0.2, intensity: 3.2, bias: 0.03, fade: 0.02, luminanceInfluence: 0.35,
    worldDistanceThreshold: 30, worldDistanceFalloff: 6, worldProximityThreshold: 0.6, worldProximityFalloff: 0.3,
    resolutionScale: 0.5, color: new Color(0.12, 0.07, 0.04),
  });
  const rays = new GodRaysEffect(camera, sun, { samples: 48, density: 0.96, decay: 0.93, weight: 0.55, exposure: 0.5, clampMax: 0.9, resolutionScale: 0.5, kernelSize: KernelSize.SMALL, blur: true });
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.82, luminanceSmoothing: 0.18, intensity: 0.55, radius: 0.7 });
  const dof = new DepthOfFieldEffect(camera, { focusDistance: 2, focusRange: 2.2, bokehScale: 1.6, resolutionScale: 0.5 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const warm = new HueSaturationEffect({ hue: 0.015, saturation: 0.2 }); // (AgX greys the colours a little: some back, and toward amber)
  const contrast = new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.15 });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.5 });
  // (the occlusion, the rays and the bloom on the scene's light; the focus; then the tone curve and the grade; the
  // comic's ink and story mode's sight effects on top, as on High; the vignette last)
  const light = [ao, rays, bloom].filter((_, k) => ultraHas((["ao", "rays", "bloom"] as const)[k]));
  if (light.length) composer.addPass(new EffectPass(camera, ...light));
  if (ultraHas("dof")) composer.addPass(new EffectPass(camera, dof));
  composer.addPass(new EffectPass(camera, tone, warm, contrast, new InkEffect(0.55), ...extra, vignette));
  renderer.toneMappingExposure = 1.25; // (AgX's curve sits lower than the untoned picture this was lit for)

  const ray = new Raycaster();
  const mid = new Vector2(0, 0);
  let focus = 2, every = 0;
  return {
    composer,
    update: (dt, sunDir, focusOn) => {
      if (!window) {
        sun.position.copy(camera.position).addScaledVector(sunDir, 400);
        sun.lookAt(camera.position);
      }
      // the focus: what the middle of the view rests on, looked for a few times a second, eased
      if (++every % 6 === 0 && focusOn.length) {
        ray.setFromCamera(mid, camera);
        ray.far = 40;
        const hit = ray.intersectObjects(focusOn, true).find((h) => h.object.visible);
        if (hit) focus = hit.distance;
      }
      dof.cocMaterial.focusDistance += (focus - dof.cocMaterial.focusDistance) * Math.min(1, dt * 4);
      dof.cocMaterial.focusRange = Math.max(1.2, focus * 0.9);
    },
    dispose: () => {
      scene.remove(sun);
      sun.geometry.dispose();
      (sun.material as MeshBasicMaterial).dispose();
      renderer.toneMappingExposure = 1;
      composer.dispose();
    },
  };
}
