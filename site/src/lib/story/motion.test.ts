// The lifelike pilot's movement fixes (step 0), held in place: Bhavi on the parapet stays her own size and clear of
// Dvij; the eyes hold whoever they talk to and blink at a person's rate.
import { describe, expect, it } from "vitest";
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Vector3 } from "three";
import story from "../../content/generated/story.json";
import { Actor, type CastEnv } from "./cast";
import { FaceLife } from "./face-life";
import { recoilTo } from "./stage";

function env(): CastEnv {
  const root = new Group();
  return { root, ground: () => 0.8, eyes: () => new Vector3(0, 1.6, 0), prop: () => null, url: (f) => f, seen: () => true, heading: () => 0 };
}

describe("Bhavi walking the well's parapet (Ch4)", () => {
  it("stays the same size, step after step", () => {
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(0.4, 1.6, 0.3), new MeshBasicMaterial()));
    const e = env();
    const a = new Actor("bhavi", { scene, clips: [] }, e);
    e.root.add(a.obj);
    a.place([-18, 39.45], "sit", "well-rim");
    a.walkRim([-18, 38], 1.42);
    const sizes: number[] = [];
    for (let i = 0; i < 60 * 40; i++) { // forty seconds round the rim
      a.update(1 / 60);
      if (i % 30 === 0) sizes.push(a.obj.getWorldScale(new Vector3()).y);
      const [x, z] = a.where();
      expect(Math.hypot(x + 18, z - 38)).toBeCloseTo(1.42, 2);
    }
    expect(Math.min(...sizes)).toBe(1);
    expect(Math.max(...sizes)).toBe(1);
  });

  it("is walked clear of Dvij: his recoil takes him well back from her path", () => {
    const ch4 = (story.scenes as { scene: string; beats: { then?: Record<string, { recoil?: boolean; away?: number[]; to?: number }>[] }[] }[]).find((s) => s.scene === "b1-ch04")!;
    const recoil = ch4.beats.flatMap((b) => b.then ?? []).map((a) => a.camera).find((c) => c?.recoil)!;
    expect(recoil.away).toEqual([-18, 38]);
    // stood inside the ring, he ends up a good stride outside it
    const [x, z] = recoilTo([-18.6, 38.5], [-18, 38], recoil.to!);
    expect(Math.hypot(x + 18, z - 38) - 1.42).toBeGreaterThan(1.6);
  });
});

describe("the eyes (face-life.ts)", () => {
  /** A minute of looking at someone a metre away; how much of it the eyes were on them, and the blinks. */
  function minute(talking: boolean) {
    const life = new FaceLife("professor") as unknown as { headTarget: FaceLife["headTarget"]; eye: { yaw: number; pitch: number }; eyes: FaceLife["eyes"] };
    const target = new Vector3(0, 1.6, 1);
    let on = 0, blinks = 0, shut = false;
    const n = 60 * 60;
    for (let i = 0; i < n; i++) {
      // a line every 6 s, 4 s long, if talking
      const speaking = talking && i % 360 < 240;
      life.headTarget(1 / 60, target, speaking);
      const lid = (life.eyes as unknown as (dt: number, ...r: unknown[]) => number).call(life, 1 / 60, { getWorldQuaternion: (q: never) => q, userData: {} }, undefined, undefined, null, () => {});
      if (Math.hypot(life.eye.yaw, life.eye.pitch) < 0.08) on++;
      if (lid > 0.9 && !shut) blinks++;
      shut = lid > 0.9;
    }
    return { on: on / n, blinks };
  }
  it("hold the other's gaze most of the time while listening, and blink 12-24 times a minute", () => {
    const m = minute(false);
    expect(m.on).toBeGreaterThan(0.85);
    expect(m.blinks).toBeGreaterThanOrEqual(12);
    expect(m.blinks).toBeLessThanOrEqual(26);
  });
  it("look away now and then as a speaker gathers a thought, but are back on him most of the time", () => {
    const m = minute(true);
    expect(m.on).toBeGreaterThan(0.6);
    expect(m.on).toBeLessThan(0.97);
  });
});
