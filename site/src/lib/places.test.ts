import { describe, expect, it } from "vitest";
import { located, pinStyle, rectStyle } from "./places";

describe("places", () => {
  it("places a rect as percentages of the map", () => {
    expect(rectStyle([0.1, 0.2, 0.3, 0.5])).toBe("left:10.00%;top:20.00%;width:20.00%;height:30.00%");
  });
  it("puts a pin at its rect's centre", () => {
    expect(pinStyle([0.1, 0.2, 0.3, 0.4])).toBe("left:20.00%;top:30.00%");
  });
  it("labels 8 places on the map", () => {
    expect(located).toHaveLength(8);
  });
});
