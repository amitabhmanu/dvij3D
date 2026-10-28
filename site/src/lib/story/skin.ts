// Skin that light goes into (lifelike pilot, step 4), cheaply enough for the laptop's GPU: what made the faces read as
// plastic was one flat diffuse, one roughness everywhere, and a red sheen standing in for the light under the skin.
//   - Pre-integrated subsurface scattering (Penner and Borshukov, GPU Pro 2): light diffused under the skin, integrated
//     ahead of time over a ring of each radius for each angle to the light, from the six-Gaussian skin profile of d'Eon
//     and Luebke (GPU Gems 3, ch. 14), into a small table made here at load. The table is read by the angle to the
//     light and the surface's curvature (from the pixel's own derivatives): the soft red edge where light turns to
//     shadow, wider on curved and thin parts. One table read a light a pixel.
//   - Light through thin parts: from behind, the ears, the nose's wings and the fingers glow red (where the surface
//     curves most), the way ears do in the garden's sun.
//   - Fine detail: a tiling pore normal over the sculpted one, so close up the skin isn't smooth as wax.
//   - Roughness: the face's own map when the build has painted one (an oilier T-zone, glossy lips), else a skin's.
// Off when CastEnv.lifelike is false (the old sheen stand-in, cast.ts).
import {
  ClampToEdgeWrapping, Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat,
  ShaderChunk, UnsignedByteType, type Material, type MeshStandardMaterial,
} from "three";

/** The skin's diffusion profile: six Gaussians, variance (mm^2) and RGB weight (d'Eon and Luebke). */
const PROFILE: [number, [number, number, number]][] = [
  [0.0064, [0.233, 0.455, 0.649]], [0.0484, [0.1, 0.336, 0.344]], [0.187, [0.118, 0.198, 0]],
  [0.567, [0.113, 0.007, 0.007]], [1.99, [0.358, 0.004, 0]], [7.41, [0.078, 0, 0]],
];
/** The table's curvature runs 0..MAX_CURV per mm (a radius of 1/MAX_CURV mm at the top: a nose's wing, an ear's rim). */
const MAX_CURV = 0.25;

function profile(d: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const [v, w] of PROFILE) {
    const g = Math.exp((-d * d) / (2 * v)) / (2 * Math.PI * v);
    out[0] += w[0] * g; out[1] += w[1] * g; out[2] += w[2] * g;
  }
  return out;
}

let lut: DataTexture | null = null;
/** The pre-integrated table: x the light's angle (cos -1..1), y the curvature (0..MAX_CURV /mm). Made once. */
export function skinTable(w = 64, h = 32): DataTexture {
  if (lut) return lut;
  const data = new Uint8Array(w * h * 4);
  const steps = 96;
  for (let j = 0; j < h; j++) {
    const curv = Math.max(1e-3, ((j + 0.5) / h) * MAX_CURV), r = 1 / curv;
    for (let i = 0; i < w; i++) {
      const theta = Math.acos(((i + 0.5) / w) * 2 - 1);
      const sum = [0, 0, 0], norm = [0, 0, 0];
      for (let k = 0; k < steps; k++) {
        const x = -Math.PI + ((k + 0.5) / steps) * 2 * Math.PI;
        const p = profile(Math.abs(2 * r * Math.sin(x / 2)));
        const c = Math.max(0, Math.cos(theta + x));
        for (let ch = 0; ch < 3; ch++) { sum[ch] += c * p[ch]; norm[ch] += p[ch]; }
      }
      const o = (j * w + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const lin = Math.min(1, sum[ch] / norm[ch]);
        data[o + ch] = Math.round(Math.sqrt(lin) * 255); // (stored as its square root: more steps where it is dark)
      }
      data[o + 3] = 255;
    }
  }
  lut = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  lut.wrapS = lut.wrapT = ClampToEdgeWrapping;
  lut.magFilter = lut.minFilter = LinearFilter;
  lut.needsUpdate = true;
  return lut;
}

let pores: DataTexture | null = null;
/** A tiling normal map of pores and fine creases (made here: no download), 128 px. */
export function poreNormals(n = 128): DataTexture {
  if (pores) return pores;
  // a height field: pits at random, and a faint cross-hatch of fine lines, then its slopes as a normal map
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hgt = new Float32Array(n * n);
  for (let k = 0; k < 900; k++) {
    const cx = rnd() * n, cy = rnd() * n, rad = 0.8 + rnd() * 1.4, depth = 0.5 + rnd() * 0.5;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = (Math.floor(cx) + dx + n) % n, y = (Math.floor(cy) + dy + n) % n;
      const d = Math.hypot(Math.floor(cx) + dx - cx, Math.floor(cy) + dy - cy) / rad;
      if (d < 1) hgt[y * n + x] -= depth * (1 - d * d);
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    hgt[y * n + x] += 0.12 * Math.sin((x + y * 0.3) * 0.9) * Math.sin((y - x * 0.2) * 0.7);
  }
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const hx = hgt[y * n + ((x + 1) % n)] - hgt[y * n + ((x - 1 + n) % n)];
    const hy = hgt[((y + 1) % n) * n + x] - hgt[((y - 1 + n) % n) * n + x];
    const nx = -hx * 0.6, ny = -hy * 0.6, nz = 1, l = Math.hypot(nx, ny, nz);
    const o = (y * n + x) * 4;
    data[o] = Math.round((nx / l * 0.5 + 0.5) * 255); data[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255); data[o + 3] = 255;
  }
  pores = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
  pores.wrapS = pores.wrapT = RepeatWrapping;
  pores.magFilter = LinearFilter;
  pores.minFilter = LinearMipmapLinearFilter;
  pores.generateMipmaps = true;
  pores.needsUpdate = true;
  return pores;
}

/** Each person's skin: how red the light comes back under it, how much through the thin parts, how fine the pores. */
const LOOK: Record<string, { scatter: number; through: number; pores: number }> = {
  default: { scatter: 1, through: 1, pores: 0.25 },
  professor: { scatter: 0.9, through: 1, pores: 0.35 },
  bhavi: { scatter: 1.1, through: 1.1, pores: 0.18 },
  dvij: { scatter: 1, through: 1, pores: 0.25 },
};

const made = new Map<string, Material>();

/** The lifelike skin for a body's "skin" material (shared by every copy of that person). */
export function skinMaterial(m: Material, who: string): Material {
  const key = `${m.uuid}:${who}`;
  const had = made.get(key);
  if (had) return had;
  const src = m as MeshStandardMaterial;
  const look = LOOK[who] ?? LOOK.default;
  const mat = new MeshPhysicalMaterial({
    name: "skin-lifelike", map: src.map, normalMap: src.normalMap, normalScale: src.normalScale,
    roughness: src.roughnessMap ? 1 : 0.5, roughnessMap: src.roughnessMap ?? null, metalness: 0, specularIntensity: 0.55,
    specularColor: new Color(1, 1, 1),
  });
  const table = skinTable(), detail = poreNormals();
  const curv = "skinCurv";
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSkinLUT = { value: table };
    sh.uniforms.uPores = { value: detail };
    sh.uniforms.uSkin = { value: [look.scatter, look.through, look.pores] };
    const direct = ShaderChunk.lights_physical_pars_fragment
      .replace("void RE_Direct_Physical(", `uniform sampler2D uSkinLUT;\nuniform vec3 uSkin;\nfloat ${curv} = 0.0;\nvoid RE_Direct_Physical(`)
      .replace("reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );", `
        // under the skin: the pre-integrated table by the light's angle and the curvature, in place of N.L
        float wrapNL = dot( geometryNormal, directLight.direction );
        vec3 sss = texture2D( uSkinLUT, vec2( wrapNL * 0.5 + 0.5, ${curv} ) ).rgb;
        sss *= sss;
        vec3 under = mix( vec3( saturate( wrapNL ) ), sss, uSkin.x );
        reflectedLight.directDiffuse += under * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
        // through the thin parts, lit from behind: the ears and the nose's wings glow red
        float behind = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 );
        float thin = smoothstep( 0.35, 0.9, ${curv} );
        reflectedLight.directDiffuse += vec3( 0.9, 0.28, 0.16 ) * behind * thin * uSkin.y * directLight.color * material.diffuseContribution * 0.6;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uPores;")
      .replace("#include <lights_physical_pars_fragment>", direct)
      .replace("#include <normal_fragment_maps>", ShaderChunk.normal_fragment_maps.replace(
        "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;",
        `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        // the pores, tiled fine over the sculpt's normals (fading out with distance, where they'd only shimmer)
        vec2 poreUv = vNormalMapUv * 38.0;
        float poreFade = 1.0 - smoothstep( 0.8, 3.0, length( vViewPosition ) );
        mapN.xy += ( texture2D( uPores, poreUv ).xy * 2.0 - 1.0 ) * uSkin.z * poreFade;`))
      .replace("#include <lights_fragment_begin>", `
        // the curvature here, from how fast the normal turns against how fast the surface moves (1/mm, as the table)
        {
          vec3 gn = normalize( vNormal );
          float dn = length( fwidth( gn ) ), dp = length( fwidth( vViewPosition ) );
          ${curv} = clamp( dn / max( dp, 1e-5 ) / 1000.0 / ${MAX_CURV.toFixed(3)}, 0.0, 1.0 );
        }
        #include <lights_fragment_begin>`);
  };
  mat.customProgramCacheKey = () => `skin-lifelike-${who}`;
  made.set(key, mat);
  return mat;
}
