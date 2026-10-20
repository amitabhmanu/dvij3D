import { describe, expect, it } from "vitest";
import { findRoute } from "./route";

// A wall along x = 0 from z = -5 to z = 5, with a doorway at z 3 to 4.
const wall = (x: number, z: number) => Math.abs(x) < 0.3 && z > -5 && z < 5 && !(z > 3 && z < 4);

describe("findRoute", () => {
  it("goes straight when nothing is in the way", () => {
    expect(findRoute([0, 0], [3, 4], () => false)).toEqual([[3, 4]]);
  });

  it("goes round a wall through its doorway, never through it", () => {
    const r = findRoute([-3, 0], [3, 0], wall);
    expect(r[r.length - 1]).toEqual([3, 0]);
    let at: [number, number] = [-3, 0];
    for (const p of r) {
      for (let k = 1; k <= 40; k++) {
        const x = at[0] + ((p[0] - at[0]) * k) / 40, z = at[1] + ((p[1] - at[1]) * k) / 40;
        expect(wall(x, z), `${x},${z}`).toBe(false);
      }
      at = p;
    }
    expect(r.some(([, z]) => z > 3 && z < 4)).toBe(true);
  });
});
