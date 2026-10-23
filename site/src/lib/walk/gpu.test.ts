import { describe, expect, it } from "vitest";
import { discreteGpu } from "./gpu";

describe("discreteGpu", () => {
  it("knows a graphics card of its own", () => {
    for (const n of ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)", "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)", "Apple M3 Max"]) {
      expect(discreteGpu(n)).toBe(true);
    }
  });
  it("leaves the chips built into the processor (and unknowns) on the screen's choice", () => {
    for (const n of ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)", "Apple M2", "Mali-G78", "", "WebKit WebGL"]) {
      expect(discreteGpu(n)).toBe(false);
    }
  });
});
