// The valley's look (design §10.1): the painted map as the land's skin, lit in
// a few soft bands like the comic's colouring, with a faint ink line at every
// ring interval, paper grain, and a haze of the paper's own colour in the
// distance. One ShaderMaterial and no post-processing, to keep the 3D code small.
import { ShaderMaterial, Texture, Vector2, Vector3 } from "three";

/** The painting's own paper colour, for the rim beyond the map and the haze. */
export const PAPER = new Vector3(0.79, 0.66, 0.47);
export const INK = new Vector3(0.24, 0.17, 0.1);

const vertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D drape;
  uniform vec2 mapSize;      // metres: the map's width and depth
  uniform vec3 sun;          // direction toward the sun
  uniform vec3 paper;
  uniform vec3 ink;
  uniform float lineStep;    // metres (stretched) between ink lines
  uniform vec2 haze;         // near and far distance of the paper haze
  uniform float rimFade;     // metres past the map's edge over which the land turns to paper
  varying vec3 vPos;
  varying vec3 vNormal;

  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vec2(vPos.x / mapSize.x + 0.5, vPos.z / mapSize.y + 0.5);
    float onMap = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec3 skin = mix(paper, texture2D(drape, vec2(uv.x, 1.0 - uv.y)).rgb, onMap);

    float d = max(dot(normalize(vNormal), sun), 0.0);
    float banded = floor(d * 4.0 + 0.5) / 4.0;
    vec3 col = skin * (0.62 + 0.5 * mix(d, banded, 0.55));

    float f = fract(vPos.y / lineStep);
    float px = min(f, 1.0 - f) * lineStep / max(fwidth(vPos.y), 1e-3);
    col = mix(col, ink, (1.0 - smoothstep(0.4, 1.4, px)) * 0.28 * onMap);

    col *= 0.965 + 0.07 * grain(floor(gl_FragCoord.xy));
    // Past the map's edge the land fades into plain paper, so the rim reads as
    // the page the valley is drawn on rather than a wall around it.
    vec2 out2 = max(max(-uv, uv - 1.0), 0.0) * mapSize;
    float beyond = smoothstep(0.0, rimFade, length(out2));
    float far = smoothstep(haze.x, haze.y, distance(vPos, cameraPosition));
    gl_FragColor = vec4(mix(col, paper, max(far, beyond)), 1.0);
  }
`;

export function landMaterial(drape: Texture, mapW: number, mapD: number, lineStep: number, haze: [number, number]) {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      drape: { value: drape },
      mapSize: { value: new Vector2(mapW, mapD) },
      // low in the east: the sun "comes late over the eastern rim" (ch50)
      sun: { value: new Vector3(0.85, 0.42, -0.2).normalize() },
      paper: { value: PAPER },
      ink: { value: INK },
      lineStep: { value: lineStep },
      haze: { value: new Vector2(haze[0], haze[1]) },
      rimFade: { value: mapW * 0.06 },
    },
  });
}
