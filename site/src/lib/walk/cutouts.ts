// The painted cut-outs standing in the valley (design §10.2): trees and
// buildings lifted off the painted map, each a flat picture that turns about
// its upright to face you, as in a paper theatre. One instanced draw for all
// of them; the far ones fade into the haze and stop being drawn.
import {
  BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial,
  Texture, Vector2, Vector3,
} from "three";

export type Sprite = { id: string; kind: string; x: number; y: number; w: number; h: number; height?: number };
export type Atlas = { w: number; h: number; sprites: Sprite[] };
/** One cut-out standing somewhere: its foot, its height in metres, and which picture. */
export type Stand = { x: number; y: number; z: number; height: number; sprite: number };

/** Gzip'd rows of int16 x and z in quarter metres, uint8 sprite, uint8 height in decimetres. */
export async function decodeTrees(buf: ArrayBuffer): Promise<{ x: number; z: number; sprite: number; height: number }[]> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  const raw = new DataView(await new Response(stream).arrayBuffer());
  const out = [];
  for (let o = 0; o + 6 <= raw.byteLength; o += 6) {
    out.push({ x: raw.getInt16(o, true) / 4, z: raw.getInt16(o + 2, true) / 4, sprite: raw.getUint8(o + 4), height: raw.getUint8(o + 5) / 10 });
  }
  return out;
}

const vertex = /* glsl */ `
  attribute vec3 foot;
  attribute vec2 size;     // width, height in metres
  attribute vec4 rect;     // x, y, w, h in the atlas, 0-1
  varying vec2 vUv;
  varying float vDist;
  varying float vShade;
  void main() {
    vec3 toCam = cameraPosition - foot;
    toCam.y = 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(1e-4, 0.0, 0.0))));
    vec3 p = foot + right * (position.x * size.x) + vec3(0.0, position.y * size.y, 0.0);
    vUv = rect.xy + vec2(position.x + 0.5, 1.0 - position.y) * rect.zw;
    vDist = distance(foot, cameraPosition);
    vShade = 0.85 + 0.15 * position.y; // a little darker at the foot
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec3 haze;
  uniform vec2 hazeRange;
  uniform vec2 drawRange;
  varying vec2 vUv;
  varying float vDist;
  varying float vShade;
  void main() {
    vec4 c = texture2D(atlas, vUv);
    // fade out past the draw range by dithering, so nothing pops
    float keep = 1.0 - smoothstep(drawRange.x, drawRange.y, vDist);
    float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (c.a < 0.5 || dither > keep) discard;
    vec3 col = c.rgb * vShade;
    gl_FragColor = vec4(mix(col, haze, smoothstep(hazeRange.x, hazeRange.y, vDist)), 1.0);
    #include <colorspace_fragment>
  }
`;

export function cutoutMesh(stands: Stand[], atlas: Atlas, texture: Texture, haze: Vector3, hazeRange: [number, number], drawRange: [number, number]): Mesh {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const foot = new Float32Array(stands.length * 3);
  const size = new Float32Array(stands.length * 2);
  const rect = new Float32Array(stands.length * 4);
  stands.forEach((s, i) => {
    const sp = atlas.sprites[s.sprite];
    foot.set([s.x, s.y - 0.15, s.z], i * 3); // sink a little, so they don't float on slopes
    size.set([(s.height * sp.w) / sp.h, s.height], i * 2);
    rect.set([sp.x / atlas.w, sp.y / atlas.h, sp.w / atlas.w, sp.h / atlas.h], i * 4);
  });
  g.setAttribute("foot", new InstancedBufferAttribute(foot, 3));
  g.setAttribute("size", new InstancedBufferAttribute(size, 2));
  g.setAttribute("rect", new InstancedBufferAttribute(rect, 4));
  g.instanceCount = stands.length;
  const m = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: DoubleSide,
    uniforms: {
      atlas: { value: texture },
      haze: { value: haze },
      hazeRange: { value: new Vector2(...hazeRange) },
      drawRange: { value: new Vector2(...drawRange) },
    },
  });
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false; // spread across the whole valley; the shader drops the far ones
  return mesh;
}
