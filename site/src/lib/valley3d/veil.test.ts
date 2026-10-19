import { describe, expect, it } from "vitest";
import { labelText } from "./veil";

const fort = { name: "Fort Ruins", pin: "Daulatabad Fort" };

describe("labelText", () => {
  it("names the place as the book's map does", () => {
    expect(labelText(fort, false)).toEqual({ text: "Fort Ruins", aria: "Fort Ruins" });
  });
  it("gives its real counterpart with Real India on, and keeps the book's name for screen readers", () => {
    expect(labelText(fort, true)).toEqual({ text: "Daulatabad Fort", aria: "Fort Ruins, most like Daulatabad Fort" });
  });
});
