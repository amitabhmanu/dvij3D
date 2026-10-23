import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { Actor } from "./cast";
import { FilmCamera } from "./film-camera";

/** A stand-in person: a head 1.6 m up, facing along `face`. */
const person = (x: number, z: number, face: [number, number]) => {
  const at = new Vector3(x, 0, z);
  return { at, visible: true, headAt: () => at.clone().add(new Vector3(0, 1.6, 0)), facing: () => new Vector3(face[0], 0, face[1]).normalize() } as unknown as Actor & { at: Vector3 };
};

describe("the film's camera", () => {
  // the Professor at the origin facing +z; Mahant 2 m in front of him, facing back
  const prof = person(0, 0, [0, 1]), mahant = person(0, 2, [0, -1]);
  let speaking: Actor | null = null;
  const cam = new FilmCamera({ who: () => prof, speaker: () => speaking, others: () => [prof, mahant], walls: () => null });
  const camera = new PerspectiveCamera();
  const shoot = () => { cam.cut(); cam.rig(camera); return camera.position.clone(); };

  it("listens over his shoulder, and turns round to him when he speaks, keeping to one side of the line", () => {
    speaking = mahant;
    const listen = shoot();
    expect(listen.z).toBeLessThan(0);                 // behind the Professor, looking at Mahant
    speaking = prof;
    const speak = shoot();
    expect(speak.z).toBeGreaterThan(2);               // behind Mahant, looking at the Professor
    expect(Math.sign(speak.x)).toBe(Math.sign(listen.x)); // the same side of the line between them
  });

  it("cuts to a close-up of someone's eyes, and back", () => {
    speaking = null;
    cam.shoot(mahant);
    cam.rig(camera);
    expect(camera.position.distanceTo(mahant.headAt())).toBeLessThan(0.4);
    cam.shoot(null);
    cam.rig(camera);
    expect(camera.position.distanceTo(prof.headAt())).toBeLessThan(2.5);
  });
});
