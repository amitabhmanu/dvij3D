import { describe, expect, it } from "vitest";
import { levels } from "./audio";

describe("what you hear", () => {
  it("has a little wind on the valley floor and more up high", () => {
    const low = levels({ height: 0, trees: 0, water: 9999 }).wind;
    const high = levels({ height: 800, trees: 0, water: 9999 }).wind;
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low * 3);
  });
  it("has birds where the trees are, fewer as you climb", () => {
    expect(levels({ height: 0, trees: 0, water: 9999 }).birds).toBe(0);
    expect(levels({ height: 0, trees: 1, water: 9999 }).birds).toBe(1);
    expect(levels({ height: 600, trees: 1, water: 9999 }).birds).toBeLessThan(0.2);
  });
  it("hears the lake only near it", () => {
    expect(levels({ height: 0, trees: 0, water: 0 }).water).toBe(1);
    expect(levels({ height: 0, trees: 0, water: 80 }).water).toBeCloseTo(0.5, 5);
    expect(levels({ height: 0, trees: 0, water: 400 }).water).toBe(0);
  });
});
