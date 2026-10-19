import { describe, expect, it } from "vitest";
import { lineOfSight, toScreen } from "./labels";

describe("toScreen", () => {
  it("puts the centre of view in the middle of the overlay", () => {
    expect(toScreen({ x: 0, y: 0, z: 0.5 }, 800, 600)).toEqual({ x: 400, y: 300, behind: false, offscreen: false });
  });
  it("puts the top-left corner of view at the top-left, inside the padding", () => {
    const s = toScreen({ x: -1, y: 1, z: 0.5 }, 800, 600, 14);
    expect([s.x, s.y, s.offscreen]).toEqual([14, 14, true]);
  });
  it("pins a label off to the right onto the right edge", () => {
    const s = toScreen({ x: 3, y: 0, z: 0.5 }, 800, 600, 14);
    expect([s.x, s.y, s.offscreen]).toEqual([786, 300, true]);
  });
  it("drops a label behind the camera to the bottom edge, mirrored", () => {
    const s = toScreen({ x: 0.5, y: 0, z: 1.2 }, 800, 600, 14);
    expect(s.behind).toBe(true);
    expect(s.y).toBe(586);
    expect(s.x).toBe(200);
  });
});

describe("lineOfSight", () => {
  const ridge = (x: number) => (Math.abs(x) < 10 ? 100 : 0);
  it("sees over flat ground", () => {
    expect(lineOfSight([-50, 50, 0], [50, 50, 0], () => 0)).toBe(true);
  });
  it("is blocked by a ridge between the two points", () => {
    expect(lineOfSight([-50, 50, 0], [50, 50, 0], (x) => ridge(x))).toBe(false);
  });
  it("clears a ridge it passes above", () => {
    expect(lineOfSight([-50, 150, 0], [50, 150, 0], (x) => ridge(x))).toBe(true);
  });
});
