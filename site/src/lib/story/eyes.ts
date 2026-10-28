// The eyes of the story's people, as film rigs layer them (lifelike pilot, step 2), in one material on MakeHuman's
// eyeballs: what made them read as painted marbles was a flat white ball, one gloss, and nothing where the lids shade it.
//   - The cornea: a clear coat of high gloss over the eye, so it carries the light's reflection.
//   - The occlusion: the eyeball darkened towards its edges and corners and under the upper lid, where the lids shade
//     it (a film rig's occlusion shell, done in the eye's own shader: the eyeball is a sphere, so how far a point is
//     from looking straight out says how near the lids it is).
//   - The inner corner pink and wet (the caruncle and the tear line where they meet the eye).
//   - The sclera an off-white, a little warm; the iris tinted to the character's (sampled from the comic: IRIS).
//   - A catchlight on purpose: a small highlight tied to the key light's side, so a close-up always has its spark.
// Its cost is a few lines in the eyes' own pixels, which are few. On by default (CastEnv.lifelike: off for "low").
import { Color, Matrix3, MeshPhysicalMaterial, Vector3, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from "three";

/** Each character's iris (sRGB), from their comic panels: a darker, less red brown than MakeHuman's. */
export const IRIS: Record<string, string> = {
  professor: "#3b2818", // dark brown behind the spectacles (b1-p012-6, b1-p013-1)
  bhavi: "#4a2c16", // a warm brown, a little lighter in the sun (b1-p008-4, b1-p012-28)
  dvij: "#33241a", // dark brown (b1-p004-4, b1-p013-19)
  default: "#3a281b",
};

const made = new Map<string, Material>();

/** The layered eye for a person, from MakeHuman's eye material (shared by every copy of that person). `mesh` and
 * `body`: the eyes' mesh and the body it is in, standing as made (facing +z), to tell which way the eyes look in the
 * mesh's own frame. */
export function eyeMaterial(m: Material, who: string, mesh: Mesh, body: Object3D): Material {
  const key = `${m.uuid}:${who}`;
  let e = made.get(key);
  if (e) return e;
  const src = m as MeshStandardMaterial;
  const mat = new MeshPhysicalMaterial({
    name: "eyes-lifelike", map: src.map, roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035,
    specularIntensity: 0.5, envMapIntensity: 0.8,
  });
  const iris = new Color(IRIS[who] ?? IRIS.default);
  // the body's ahead, up and left in the mesh's own frame (its points are in it, before the skinning)
  body.updateMatrixWorld(true);
  const toMesh = new Matrix3().setFromMatrix4(mesh.matrixWorld).invert().multiply(new Matrix3().setFromMatrix4(body.matrixWorld));
  const fwd = new Vector3(0, 0, 1).applyMatrix3(toMesh).normalize(), up = new Vector3(0, 1, 0).applyMatrix3(toMesh).normalize();
  const left = new Vector3(1, 0, 0).applyMatrix3(toMesh).normalize();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uIris = { value: iris };
    sh.uniforms.uFwd = { value: fwd };
    sh.uniforms.uUp = { value: up };
    sh.uniforms.uLeft = { value: left };
    // each point's direction on the eyeball as the body has it, before the skinning turns the eye (x: to the body's
    // left, y: up, z: straight out), and which eye it is on
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeN;\nvarying float vEyeSide;\nuniform vec3 uFwd;\nuniform vec3 uUp;\nuniform vec3 uLeft;")
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
        vec3 n0 = normalize(normal);
        vEyeN = vec3(dot(n0, uLeft), dot(n0, uUp), dot(n0, uFwd));
        vEyeSide = dot(position, uLeft) > 0.0 ? 1.0 : -1.0;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeN;\nvarying float vEyeSide;\nuniform vec3 uIris;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        {
          // the sclera and the iris told apart by the texture: the iris is the dark, saturated middle
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float sclera = smoothstep(0.1, 0.24, lum);
          vec3 irisCol = uIris * (0.45 + 1.6 * lum / 0.08);
          irisCol = mix(vec3(0.004), irisCol, smoothstep(0.0025, 0.009, lum)); // the pupil
          diffuseColor.rgb = mix(irisCol, vec3(0.74, 0.7, 0.64), sclera);
          // how far from looking straight out (1 at the pupil, 0 at the eye's rim), and how high up
          float out_ = clamp(vEyeN.z, 0.0, 1.0);
          float occ = smoothstep(0.72, 0.985, out_);
          occ *= mix(1.0, 0.55, smoothstep(0.04, 0.3, vEyeN.y)); // the upper lid's shadow
          // the inner corner, towards the nose (x towards 0 from each side): pink and wet
          float nasal = smoothstep(0.25, 0.6, -vEyeSide * vEyeN.x);
          float corner = nasal * (1.0 - smoothstep(0.6, 0.85, out_)) * sclera;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.47, 0.44), corner * 0.6);
          diffuseColor.rgb *= mix(0.3, 1.0, occ);
        }`)
      .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>
        float eyeOcc = smoothstep(0.72, 0.985, clamp(vEyeN.z, 0.0, 1.0));`)
      .replace("#include <opaque_fragment>", `
        // the catchlight: a small spot on the cornea, up and to the side of the key light (the person's right), where a
        // portrait's key light sits; on the eye's own sphere, so it stays put as the head turns a little
        float spark = smoothstep(0.9972, 0.999, dot(normalize(vEyeN), normalize(vec3(-0.13, 0.085, 0.988))));
        outgoingLight += vec3(1.0, 0.97, 0.92) * spark * 1.1;
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "eyes-lifelike";
  made.set(key, mat);
  return mat;
}

/** Brows and lashes: soft-edged with the picture's multisampling (alpha to coverage), not cut hard at half. */
export function softCards(m: Material) {
  m.transparent = false;
  m.alphaTest = 0.22;
  m.alphaToCoverage = true;
  m.depthWrite = true;
  m.needsUpdate = true;
}
