// Seeing as Dvij (design §10.4): what his eyes do to the picture. One
// postprocessing pass: blur and double vision as he wakes, darkness as he
// faints, the white flash of sunlight through the shutters, a glare when he
// walks into the sun. Every amount eases toward its target over time.
import { BlendFunction, Effect } from "postprocessing";
import { Uniform, Vector2 } from "three";

const shader = /* glsl */ `
  uniform float blur;
  uniform float ghosting; // double vision ("double" is reserved in GLSL)
  uniform float dark;
  uniform float flash;
  uniform float glare;
  uniform vec2 sunAt;
  // 12 taps on a disc, weighted to the middle: cheap enough for any GPU (a 7x7 kernel lost
  // the context on software WebGL)
  const vec2 DISC[12] = vec2[12](
    vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
    vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
    vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
  vec3 sampleBlur(vec2 uv, float r) {
    vec3 c = texture2D(inputBuffer, uv).rgb;
    float w = 1.0;
    for (int i = 0; i < 12; i++) {
      float k = 1.0 - 0.5 * length(DISC[i]);
      c += texture2D(inputBuffer, uv + DISC[i] * texelSize * r).rgb * k;
      w += k;
    }
    return c / w;
  }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = blur > 0.01 ? sampleBlur(uv, blur * 14.0) : inputColor.rgb;
    if (ghosting > 0.01) {
      vec2 off = vec2(0.035 * ghosting, 0.006 * ghosting);
      c = mix(c, texture2D(inputBuffer, uv + off).rgb, 0.4 * ghosting);
    }
    float vignette = smoothstep(0.25, 0.95, length(uv - 0.5) * 1.4);
    c *= 1.0 - dark * (0.55 + 0.45 * vignette);
    c = mix(c, vec3(1.0, 0.98, 0.9), flash);
    float g = glare * (1.0 - smoothstep(0.0, 0.9, length(uv - sunAt)));
    c = mix(c, vec3(1.0, 0.95, 0.82), g);
    outputColor = vec4(c, inputColor.a);
  }
`;

export type Sight = { blur: number; double: number; dark: number; flash: number; glare: number };
export const CLEAR: Sight = { blur: 0, double: 0, dark: 0, flash: 0, glare: 0 };

export class SightEffect extends Effect {
  private target: Sight = { ...CLEAR };
  private now: Sight = { ...CLEAR };
  private rate: Record<keyof Sight, number> = { blur: 1, double: 1, dark: 1, flash: 1, glare: 1 };

  constructor() {
    super("SightEffect", shader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["blur", new Uniform(0)], ["ghosting", new Uniform(0)], ["dark", new Uniform(0)],
        ["flash", new Uniform(0)], ["glare", new Uniform(0)], ["sunAt", new Uniform(new Vector2(0.5, 0.6))],
      ]),
    });
  }

  /** Move toward these amounts over `seconds` (0: at once). */
  set(to: Partial<Sight>, seconds = 0): void {
    for (const k of Object.keys(to) as (keyof Sight)[]) {
      this.target[k] = to[k]!;
      const gap = Math.abs(this.target[k] - this.now[k]);
      this.rate[k] = seconds > 0 ? gap / seconds : Infinity;
    }
  }

  get current(): Sight {
    return { ...this.now };
  }

  override update(_r: unknown, _i: unknown, dt?: number): void {
    const step = dt ?? 1 / 60;
    for (const k of Object.keys(this.now) as (keyof Sight)[]) {
      const gap = this.target[k] - this.now[k];
      const move = Math.min(Math.abs(gap), this.rate[k] * step);
      this.now[k] += Math.sign(gap) * move;
      (this.uniforms.get(k === "double" ? "ghosting" : k) as Uniform).value = this.now[k];
    }
  }
}
