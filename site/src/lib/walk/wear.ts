// The lodge's decay (lodge.yaml `character`): "decaying magnificence" drawn over
// its materials. Blender bakes where it has built up into three masks over the
// occlusion atlas (blender/build_lodge.py wear_masks); here each material draws
// what that looks like close to, from noise in the lodge's own frame, so a mask
// eight centimetres to the texel still gives sharp streaks, flakes and spots.
//   red    grime: darker toward the feet of walls, in corners, round the hearth
//   green  damp: mould streaks running down below the roof line and the windows
//   blue   wear: paint flaking off about the openings (painted plaster), or rust
//          dripped from the courtyard's bars (its floor)
import { LinearFilter, MeshStandardMaterial, NoColorSpace, type Material, type Mesh, type Object3D, type Texture, type Vector3 } from "three";

const PAINTED = new Set(["whitewash", "whitewash-grey", "soot"]);
const RUSTED = new Set(["flags-court"]);

const noise = /* glsl */ `
  uniform sampler2D wearMap;
  uniform vec3 wearOrigin;
  varying vec3 vWearPos;
  varying vec3 vWearNormal;
  float wearHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wearNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    return mix(mix(wearHash(i), wearHash(i + vec2(1.0, 0.0)), s.x), mix(wearHash(i + vec2(0.0, 1.0)), wearHash(i + vec2(1.0)), s.x), s.y);
  }
`;

const draw = (kind: number) => /* glsl */ `
  {
    vec3 wear = texture2D(wearMap, vAoMapUv).rgb;
    vec3 wn = normalize(vWearNormal);
    vec3 wp = vWearPos - wearOrigin;
    // a place on the surface: along and up a wall, or across a floor
    vec2 sp = abs(wn.y) > 0.6 ? wp.xz : vec2(abs(wn.x) > abs(wn.z) ? wp.z : wp.x, wp.y);
    float g = clamp(wear.r * (0.7 + 0.6 * wearNoise(sp * 3.1)), 0.0, 1.0);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.42, 0.36, 0.29), g * 0.85);
    // damp runs down in streaks: noise stretched up the wall
    float streak = wearNoise(vec2(sp.x * 9.0, sp.y * 0.6)) * 0.7 + wearNoise(sp * 2.3) * 0.3;
    float damp = smoothstep(0.3, 0.75, wear.g * 1.2 + (streak - 0.5) * 0.8) * min(1.0, wear.g * 1.6);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.53, 0.43), damp * 0.85);
    ${kind === 1 ? `
    // whitewash flaking off: crisp-edged flakes, old plaster under them, a shadow line at the edge
    float flakes = wearNoise(sp * 3.7) * 0.6 + wearNoise(sp * 12.0) * 0.4;
    float cut = wear.b * 0.75 - 0.17 - flakes * 0.75;
    float peel = smoothstep(-0.015, 0.015, cut);
    float rim = smoothstep(-0.045, -0.015, cut) * (1.0 - peel);
    vec3 under = vec3(0.6, 0.47, 0.35) * (0.8 + 0.35 * wearNoise(sp * 23.0));
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.35 * rim), under, peel);` : ""}
    ${kind === 2 ? `
    // rust dripped from the bars above: spots, thickest under them
    float spots = wearNoise(sp * 5.0) * 0.6 + wearNoise(sp * 17.0) * 0.4;
    float rust = smoothstep(0.5, 0.62, spots + wear.b * 0.5 - 0.3) * wear.b;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.17, 0.06), rust * 0.8);` : ""}
  }
`;

/** Draw the decay over every lodge material that has the occlusion atlas (uv channel 1). */
export function applyWear(root: Object3D, wear: Texture, origin: Vector3): void {
  wear.flipY = false; // as glTF's own textures
  wear.colorSpace = NoColorSpace;
  wear.generateMipmaps = false; // the atlas's islands would bleed into each other
  wear.minFilter = LinearFilter;
  wear.needsUpdate = true;
  const done = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const mat of ([] as Material[]).concat(mesh.material)) {
      if (!(mat instanceof MeshStandardMaterial) || !mat.aoMap || mat.transparent || done.has(mat)) continue;
      done.add(mat);
      const kind = PAINTED.has(mat.name) ? 1 : RUSTED.has(mat.name) ? 2 : 0;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.wearMap = { value: wear };
        sh.uniforms.wearOrigin = { value: origin };
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vWearPos;\nvarying vec3 vWearNormal;")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvWearPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWearNormal = mat3(modelMatrix) * objectNormal;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", `#include <common>\n${noise}`)
          .replace("#include <map_fragment>", `#include <map_fragment>\n${draw(kind)}`);
      };
      mat.customProgramCacheKey = () => `wear${kind}`;
      mat.needsUpdate = true;
    }
  });
}
