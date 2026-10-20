import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeHeights, fieldFor, heightAt, integrate, ripple, RIPPLE, RISE, sampleField } from "./heights";
import { walk } from "./walk-data";

function encode(q: number[][]): Int16Array {
  const h = q.length, w = q[0].length, out = new Int16Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const pred = i && j ? q[j][i - 1] + q[j - 1][i] - q[j - 1][i - 1] : i ? q[j][i - 1] : j ? q[j - 1][i] : 0;
      out[j * w + i] = q[j][i] - pred;
    }
  return out;
}

describe("walk heights", () => {
  it("undoes the planar prediction exactly", () => {
    const q = [[5, 7, 9, 4], [6, -3, 12, 0], [100, 101, 99, -200]];
    const back = integrate(encode(q), 4, 3, 0.1);
    expect(Array.from(back).map((v) => Math.round(v * 10))).toEqual(q.flat());
  });

  it("decodes the real file to the heights the pipeline recorded", async () => {
    const buf = readFileSync(new URL(`../../../../site-assets/walk/${walk.height.file}`, import.meta.url));
    const data = await decodeHeights(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), walk.height.w, walk.height.h, walk.height.scale);
    for (const c of walk.check) expect(data[c.j * walk.height.w + c.i]).toBeCloseTo(c.h, 1);
    // and the samples land where the world says they are
    const f = fieldFor(data, walk.height.w, walk.height.h, walk);
    expect(f.cell).toBeCloseTo((walk.worldWidth * (1 + 2 * walk.margin)) / walk.height.w, 9);
    const c = walk.check[2];
    expect(sampleField(f, f.x0 + c.i * f.cell, f.z0 + c.j * f.cell)).toBeCloseTo(c.h, 1);
  });

  it("interpolates between samples", () => {
    const f = fieldFor(new Float32Array([0, 10, 20, 30]), 2, 2, { worldWidth: 2, worldDepth: 2, margin: 0 });
    expect(sampleField(f, f.x0 + f.cell / 2, f.z0)).toBeCloseTo(5, 5);
    expect(sampleField(f, f.x0 + f.cell / 2, f.z0 + f.cell / 2)).toBeCloseTo(15, 5);
  });

  it("keeps climbing past the last sample, so the world's edge has no shelf", () => {
    const f = fieldFor(new Float32Array([5, 5, 5, 5]), 2, 2, { worldWidth: 2, worldDepth: 2, margin: 0 });
    const edge = f.x0 + f.cell;
    expect(sampleField(f, edge, f.z0)).toBeCloseTo(5, 5);
    expect(sampleField(f, edge + 100, f.z0)).toBeCloseTo(5 + 100 * RISE, 3);
  });

  it("adds ripples that stay small and repeat exactly", () => {
    const max = RIPPLE.reduce((s, o) => s + o.amp, 0);
    for (let k = 0; k < 500; k++) {
      const x = k * 3.7 - 900, z = k * -2.3 + 400;
      expect(Math.abs(ripple(x, z))).toBeLessThanOrEqual(max);
      expect(ripple(x, z)).toBe(ripple(x, z));
    }
    const f = fieldFor(new Float32Array([0, 0, 0, 0]), 2, 2, { worldWidth: 10, worldDepth: 10, margin: 0 });
    expect(heightAt(f, 1, 1)).toBe(ripple(1, 1));
  });
});
