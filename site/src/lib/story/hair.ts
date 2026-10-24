// Hair cards (lifelike pilot, step 5; built by blender/lifelike.py): strips of drawn strands, seen from both sides,
// their edges soft with the picture's multisampling (alpha to coverage: no sorting), and the long streak of
// highlight hair has along it (anisotropy, along the card's length).
// And the swing: hair lags behind the head as it turns and moves, overshoots and settles (a spring, as the skirts'
// in cast.ts), bending each lock more towards its tip: done in the cards' vertex shader from one offset a person a
// frame, so it costs nothing on the CPU and needs no hair bones.
import { DoubleSide, MeshPhysicalMaterial, Quaternion, Vector3, type Material, type MeshStandardMaterial, type Object3D } from "three";

/** One person's hair: its materials (one per card set), and the spring that swings it. */
export class Hair {
  readonly mats: MeshPhysicalMaterial[] = [];
  private at: Vector3 | null = null;
  private off = new Vector3();
  private vel = new Vector3();
  /** The swing in the hair's own frame (where the shader adds it). */
  private local = new Vector3();

  /** The game's material for a card hair's material (one per person: each swings on its own). `give`: how far it
   * swings (long hair more than curls). */
  material(m: Material, give: number): Material {
    const src = m as MeshStandardMaterial;
    const mat = new MeshPhysicalMaterial({
      name: src.name, map: src.map, color: src.color, roughness: 0.58, metalness: 0, side: DoubleSide,
      alphaTest: 0.28, alphaToCoverage: true, transparent: false, depthWrite: true,
      anisotropy: 0.45, anisotropyRotation: Math.PI / 2, // (the streak runs along the strands: the card's length)
      sheen: 0.12, sheenRoughness: 0.6, specularIntensity: 0.35,
    });
    const swing = this.local;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSwing = { value: swing };
      sh.uniforms.uGive = { value: give };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uSwing;\nuniform float uGive;")
        .replace("#include <skinning_vertex>", `#include <skinning_vertex>
          // the cards' v runs 1 at the root to 0 at the tip: the tip swings most
          { float k = 1.0 - uv.y; transformed += uSwing * uGive * k * k; }`);
    };
    mat.customProgramCacheKey = () => `hair-cards-${give}`;
    this.mats.push(mat);
    return mat;
  }

  /** Each frame: the spring from where the head went (world), into the hair mesh's frame. */
  update(dt: number, head: Vector3, mesh: Object3D) {
    if (!this.mats.length || dt <= 0 || dt > 0.2) { this.at = head.clone(); return; }
    if (!this.at) { this.at = head.clone(); return; }
    const v = head.clone().sub(this.at).divideScalar(dt);
    this.at.copy(head);
    // the hair is left behind by the head's motion, pulled back to rest, and damped (as the skirts, cast.ts)
    const goal = v.multiplyScalar(-0.06).clampLength(0, 0.12);
    goal.y = Math.min(goal.y, 0.02);
    this.vel.addScaledVector(goal.sub(this.off), 60 * dt).multiplyScalar(Math.max(0, 1 - 7 * dt));
    this.off.addScaledVector(this.vel, dt).clampLength(0, 0.15);
    // into the mesh's own frame (a direction: its turn only)
    const q = mesh.getWorldQuaternion(new Quaternion()).invert();
    this.local.copy(this.off).applyQuaternion(q);
  }
}
