import { describe, expect, it } from "vitest";
import { clampTarget, ease, lerp3, viewFrom } from "./camera";

describe("camera", () => {
  const b = { halfWidth: 5000, halfDepth: 3400 };
  it("keeps the orbit point on the map", () => {
    expect(clampTarget([9000, 50, -9000], b)).toEqual([5000, 50, -3400]);
    expect(clampTarget([100, 50, 200], b)).toEqual([100, 50, 200]);
  });
  it("eases from rest to rest", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 10);
    expect(ease(-1)).toBe(0);
    expect(ease(0.1)).toBeLessThan(0.1); // slow start
  });
  it("views a place from the side the camera is already on", () => {
    const p = viewFrom([0, 0, 0], [0, 500, 1000], 1000, 0);
    expect(p[0]).toBeCloseTo(0, 10);
    expect(p[1]).toBeCloseTo(0, 10);
    expect(p[2]).toBeCloseTo(1000, 10);
    const up = viewFrom([0, 0, 0], [1000, 0, 0], 1000, Math.PI / 2);
    expect(up[1]).toBeCloseTo(1000, 10);
  });
  it("still works from straight above", () => {
    const p = viewFrom([10, 0, 10], [10, 900, 10], 100, 0);
    expect(Math.hypot(p[0] - 10, p[2] - 10)).toBeCloseTo(100, 6);
  });
  it("interpolates between poses", () => {
    expect(lerp3([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });
});
