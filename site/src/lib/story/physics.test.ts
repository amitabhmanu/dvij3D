import { describe, expect, it } from "vitest";
import { Object3D, Vector3 } from "three";
import { body, step } from "./physics";

const rim = (y: number) => Array.from({ length: 8 }, (_, k) => new Vector3(Math.cos((k / 8) * Math.PI * 2) * 0.034, y, Math.sin((k / 8) * Math.PI * 2) * 0.034));

describe("story physics", () => {
  it("lets a dropped tumbler come to rest on the floor, not in it", () => {
    const o = new Object3D();
    o.position.set(0, 0.6, 0);
    let knocks = 0;
    const b = body(o, [...rim(0), ...rim(0.11)], { v: new Vector3(0.4, 0, 0.2), w: new Vector3(0, 0, 6), mass: 0.22, inertia: 0.00035, onHit: () => knocks++ });
    for (let t = 0; t < 6 && !b.asleep; t += 1 / 60) step(b, 1 / 60, () => 0);
    expect(b.asleep).toBe(true);
    expect(knocks).toBeGreaterThan(0); // it struck the floor
    o.updateMatrix();
    const lowest = Math.min(...b.points.map((p) => p.clone().applyMatrix4(o.matrix).y));
    expect(lowest).toBeGreaterThan(-0.005);
    expect(lowest).toBeLessThan(0.01);
    expect(Math.hypot(o.position.x, o.position.z)).toBeLessThan(2); // it rolled a little, not across the room
  });

  it("rests on a raised surface (a bed) when dropped above it, and falls past its edge", () => {
    const bed = (x: number) => (x < 0.5 ? 0.6 : 0); // a bed top 60 cm up, ending at x = 0.5
    const onBed = new Object3D();
    onBed.position.set(0, 0.8, 0);
    const a = body(onBed, [...rim(0), ...rim(0.11)]);
    for (let t = 0; t < 4 && !a.asleep; t += 1 / 60) step(a, 1 / 60, (x) => bed(x));
    expect(onBed.position.y).toBeGreaterThan(0.55);
    const rolling = new Object3D(); // on its side (its axis along z), rolling towards the edge
    rolling.position.set(0.25, 0.66, -0.055);
    rolling.rotation.x = Math.PI / 2;
    rolling.updateMatrix();
    const b = body(rolling, [...rim(0), ...rim(0.11)], { v: new Vector3(0.8, 0, 0), w: new Vector3(0, 0, -0.8 / 0.034) });
    for (let t = 0; t < 5 && !b.asleep; t += 1 / 60) step(b, 1 / 60, (x) => bed(x));
    expect(rolling.position.x).toBeGreaterThan(0.5);
    expect(rolling.position.y).toBeLessThan(0.2); // on the floor
  });
});
