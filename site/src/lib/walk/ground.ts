// The land underfoot (design §10.2). One grid mesh follows the walker: its
// cells are under a metre wide at your feet and grow to over 100 m at the
// horizon, so the whole valley is one draw call. The vertex shader raises each
// vertex with exactly the heights and ripples heights.ts gives the player, so
// what you see is what you stand on.
import {
  BufferAttribute, BufferGeometry, DataTexture, FloatType, NearestFilter, RedFormat, ShaderMaterial,
  Texture, Vector2, Vector3, Vector4,
} from "three";
import { RIPPLE, RISE, type Field, type Flat } from "./heights";

/** Ground-mesh warp: mostly cubic, with a linear part so cells near you stay about 0.75 m. */
export function warp(t: number, reach: number, lin: number): number {
  const a = Math.abs(t);
  return Math.sign(t) * reach * (lin * a + (1 - lin) * a * a * a);
}

export function groundGeometry(n: number): BufferGeometry {
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      pos[k++] = (i / n) * 2 - 1;
      pos[k++] = 0;
      pos[k++] = (j / n) * 2 - 1;
    }
  const idx = new Uint32Array(n * n * 6);
  k = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

export function heightTexture(f: Field): DataTexture {
  const t = new DataTexture(f.data, f.w, f.h, RedFormat, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

const common = /* glsl */ `
  uniform sampler2D heights;
  uniform vec2 fieldSize;
  uniform float cell;
  uniform vec2 origin;
  uniform vec4 flatRect;   // heights.ts's flat pads: x0, z0, x1, z1 (the lodge's)
  uniform vec4 flatRect2;  // (the temple site's)
  uniform float flatBlend;

  float fetchH(int i, int j) {
    return texelFetch(heights, ivec2(clamp(i, 0, int(fieldSize.x) - 1), clamp(j, 0, int(fieldSize.y) - 1)), 0).r;
  }
  float sampleField(vec2 p) {
    vec2 uv = clamp((p - origin) / cell, vec2(0.0), fieldSize - 1.0001);
    ivec2 ij = ivec2(floor(uv));
    vec2 f = uv - vec2(ij);
    float a = fetchH(ij.x, ij.y), b = fetchH(ij.x + 1, ij.y);
    float c = fetchH(ij.x, ij.y + 1), d = fetchH(ij.x + 1, ij.y + 1);
    vec2 last = origin + (fieldSize - 1.0) * cell;
    vec2 out2 = max(max(origin - p, p - last), 0.0);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) + ${RISE.toFixed(3)} * length(out2);
  }
  // heights.ts's ripple(), line for line
  float hash(int ix, int iz) {
    uint n = uint(ix + 1000000) * 374761393u + uint(iz + 1000000) * 668265263u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    return float(n ^ (n >> 16u)) / 4294967296.0;
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = p - i;
    vec2 s = f * f * (3.0 - 2.0 * f);
    int ix = int(i.x), iz = int(i.y);
    float a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
  }
  float ripple(vec2 p) {
    return ${RIPPLE.map((o) => `(valueNoise(p / ${o.wave.toFixed(3)}) - 0.5) * ${(2 * o.amp).toFixed(4)}`).join(" + ")};
  }
  float padWeight(vec4 r, vec2 p) {
    vec2 d = max(max(r.xy - p, p - r.zw), 0.0);
    float t = clamp(length(d) / max(flatBlend, 1e-6), 0.0, 1.0);
    return flatBlend > 0.0 && r.z > r.x ? 1.0 - t * t * (3.0 - 2.0 * t) : 0.0;
  }
  float flatWeight(vec2 p) {
    return max(padWeight(flatRect, p), padWeight(flatRect2, p));
  }
  float groundAt(vec2 p) { return sampleField(p) + ripple(p) * (1.0 - flatWeight(p)); }
`;

const vertex = /* glsl */ `
  ${common}
  uniform vec2 center;
  uniform float reach;
  uniform float lin;
  varying vec3 vPos;
  varying vec3 vNormal;
  vec2 warp2(vec2 t) {
    vec2 a = abs(t);
    return sign(t) * reach * (lin * a + (1.0 - lin) * a * a * a);
  }
  void main() {
    vec2 p = center + warp2(position.xz);
    float h = groundAt(p);
    float e = max(length(warp2(position.xz + vec2(0.004)) - warp2(position.xz)), 0.5);
    float hx = groundAt(p + vec2(e, 0.0)) - groundAt(p - vec2(e, 0.0));
    float hz = groundAt(p + vec2(0.0, e)) - groundAt(p - vec2(0.0, e));
    vNormal = normalize(vec3(-hx, 2.0 * e, -hz));
    vPos = vec3(p.x, h, p.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${common}
  uniform sampler2D colours;  // the painting's colours, labels smoothed away (build_walk.py)
  uniform vec2 mapSize;
  uniform vec3 sun;
  uniform vec3 paper;
  uniform vec3 haze;
  uniform vec2 hazeRange;
  uniform float rimFade;
  varying vec3 vPos;
  varying vec3 vNormal;

  float fbm(vec2 p) {
    return valueNoise(p) * 0.55 + valueNoise(p * 2.13 + 17.0) * 0.3 + valueNoise(p * 4.7 + 41.0) * 0.15;
  }

  void main() {
    vec2 uv = vec2(vPos.x / mapSize.x + 0.5, vPos.z / mapSize.y + 0.5);
    vec2 outside = max(max(-uv, uv - 1.0), 0.0) * mapSize;
    float beyond = smoothstep(0.0, rimFade, length(outside));
    vec3 base = mix(texture2D(colours, clamp(vec2(uv.x, 1.0 - uv.y), 0.0, 1.0)).rgb, paper, beyond);

    // Up close the painting's colours become ground: grass where it is green,
    // earth where it is brown, rock where it is steep, all mottled.
    vec3 n = normalize(vNormal);
    float dist = distance(vPos, cameraPosition);
    float steep = 1.0 - n.y;
    float green = base.g - 0.5 * (base.r + base.b);
    float big = fbm(vPos.xz * 0.045), small = fbm(vPos.xz * 0.6);
    vec3 grass = vec3(0.16, 0.2, 0.06), earth = vec3(0.38, 0.25, 0.12), rock = vec3(0.3, 0.27, 0.23);
    vec3 near = mix(earth, grass, smoothstep(-0.012, 0.016, green + (big - 0.5) * 0.03));
    near = mix(near, rock, smoothstep(0.22, 0.45, steep + (small - 0.5) * 0.12));
    near = mix(near, base, 0.35) * (0.82 + 0.36 * small);
    vec3 skin = mix(base, near, (1.0 - smoothstep(80.0, 600.0, dist)) * (1.0 - beyond));

    float d = max(dot(n, sun), 0.0);
    float banded = floor(d * 4.0 + 0.5) / 4.0;
    vec3 col = skin * (0.5 + 0.75 * mix(d, banded, 0.35));
    float far = smoothstep(hazeRange.x, hazeRange.y, dist);
    gl_FragColor = vec4(mix(col, haze, max(far, beyond)), 1.0); // past the map: only haze, so the rim has no edge
    #include <colorspace_fragment>
  }
`;

export type GroundOptions = {
  field: Field; colours: Texture; mapW: number; mapD: number;
  paper: Vector3; haze: Vector3; hazeRange: [number, number]; reach: number; cells: number; flat?: Flat[];
};

export function groundMaterial(o: GroundOptions): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      heights: { value: heightTexture(o.field) },
      fieldSize: { value: new Vector2(o.field.w, o.field.h) },
      cell: { value: o.field.cell },
      origin: { value: new Vector2(o.field.x0, o.field.z0) },
      flatRect: { value: new Vector4(...(o.flat?.[0]?.rect ?? [0, 0, 0, 0])) },
      flatRect2: { value: new Vector4(...(o.flat?.[1]?.rect ?? [0, 0, 0, 0])) },
      flatBlend: { value: o.flat?.[0]?.blend ?? 0 },
      center: { value: new Vector2() },
      reach: { value: o.reach },
      lin: { value: Math.min(1, 0.75 / (o.reach * (2 / o.cells))) },
      colours: { value: o.colours },
      rimFade: { value: o.mapW * 0.05 },
      mapSize: { value: new Vector2(o.mapW, o.mapD) },
      sun: { value: new Vector3(0.85, 0.42, -0.2).normalize() },
      paper: { value: o.paper },
      haze: { value: o.haze },
      hazeRange: { value: new Vector2(...o.hazeRange) },
    },
  });
}
