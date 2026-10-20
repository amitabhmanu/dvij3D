// The comic's ink, over the rendered valley (design §10.2): a dark line where
// the depth jumps (a ridge against what lies behind it, a rock against the
// ground), and a little paper grain. Medium and high quality only.
import { BlendFunction, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import { HalfFloatType, Uniform, type Camera, type Scene, type WebGLRenderer } from "three";

const ink = /* glsl */ `
  uniform float strength;
  float dist(vec2 uv) { return abs(getViewZ(readDepth(uv))); } // view distance, whichever sign the library uses
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // Ink only where something stands in front of what lies behind it: a crest
    // against the far valley, a rock against the ground. Distances, not depths.
    float dc = dist(uv);
    vec2 t = texelSize * 1.2;
    float behind = max(max(dist(uv + vec2(t.x, 0.0)), dist(uv - vec2(t.x, 0.0))),
                       max(dist(uv + vec2(0.0, t.y)), dist(uv - vec2(0.0, t.y))));
    float line = smoothstep(0.1, 0.22, (behind - dc) / max(dc, 1.0));
    line *= 1.0 - smoothstep(1200.0, 2500.0, dc); // no ink in the haze, nor on the world's far edge
    vec3 inkColour = vec3(0.045, 0.03, 0.02);
    float grain = fract(sin(dot(floor(uv / texelSize), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 c = mix(inputColor.rgb, inkColour, line * strength) * (0.975 + 0.05 * grain);
    outputColor = vec4(c, inputColor.a);
  }
`;

export class InkEffect extends Effect {
  constructor(strength = 0.8) {
    super("InkEffect", ink, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([["strength", new Uniform(strength)]]),
    });
  }
}

/** The ink, and any other passes over the picture (story mode's sight effects). */
export function inkComposer(renderer: WebGLRenderer, scene: Scene, camera: Camera, extra: Effect[] = [], ink = true): EffectComposer {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  const effects = [...(ink ? [new InkEffect()] : []), ...extra];
  if (effects.length) composer.addPass(new EffectPass(camera, ...effects));
  return composer;
}
