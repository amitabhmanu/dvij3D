import { describe, expect, it } from "vitest";
import { decodeHeight, gridSize, mapToGrid, mapToWorld, worldToMap } from "./terrain";
import { terrain } from "./terrain-data";

describe("terrain frames", () => {
  it("maps the map's centre to the world's origin and its corners to its edges", () => {
    expect(mapToWorld(terrain, 0.5, 0.5)).toEqual([0, 0]);
    expect(mapToWorld(terrain, 0, 0)).toEqual([-terrain.worldWidth / 2, -terrain.worldDepth / 2]);
  });
  it("round-trips map and world coordinates", () => {
    for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1], [0.164, 0.548]]) {
      const [x, z] = mapToWorld(terrain, u, v);
      const [u2, v2] = worldToMap(terrain, x, z);
      expect(u2).toBeCloseTo(u, 10);
      expect(v2).toBeCloseTo(v, 10);
    }
  });
  it("puts the map inside the heightmap's rim", () => {
    const [g0u, g0v] = mapToGrid(terrain, 0, 0);
    const [g1u, g1v] = mapToGrid(terrain, 1, 1);
    expect(g0u).toBeGreaterThan(0);
    expect(g0v).toBeGreaterThan(0);
    expect(g1u).toBeLessThan(1);
    expect(g1v).toBeLessThan(1);
    expect(g0u).toBeCloseTo(1 - g1u, 10);
    const [w, d] = gridSize(terrain);
    expect(w / d).toBeCloseTo(terrain.height.w / terrain.height.h, 2);
  });
  it("decodes the heightmap's ends to its recorded range", () => {
    expect(decodeHeight(terrain, 0)).toBe(terrain.height.min);
    expect(decodeHeight(terrain, 255)).toBeCloseTo(terrain.height.max, 10);
  });
  it("anchors all 8 labelled places, with Dronagiri's summit the highest", () => {
    expect(Object.keys(terrain.anchors)).toHaveLength(8);
    const top = Object.entries(terrain.summits).sort((a, b) => b[1][1] - a[1][1])[0][0];
    expect(top).toBe("dronagiri");
  });
});
