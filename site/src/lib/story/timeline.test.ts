// The film bar's slider (timeline.ts): where the film is, and where a seek lands.
import { describe, expect, it } from "vitest";
import { beatAt, mmss, positionAt, type Timeline } from "./timeline";

const tl: Timeline = { "b1-ch01": { beats: [{ id: "wake", at: 0 }, { id: "water", at: 17.5 }, { id: "sit-up", at: 30 }], total: 150 } };

describe("the film bar's timeline", () => {
  it("runs on from the beat's own start, held short of the next while a beat runs long", () => {
    expect(positionAt(tl, "b1-ch01", "water", 4)).toEqual({ at: 21.5, total: 150 });
    expect(positionAt(tl, "b1-ch01", "water", 40)!.at).toBeCloseTo(29.9, 5);
    expect(positionAt(tl, "b1-ch01", "sit-up", 500)!.at).toBeCloseTo(149.9, 5); // (the last beat: held short of the end)
    expect(positionAt(tl, "b1-ch99", "x", 1)).toBeNull();
  });

  it("lands a seek at the start of the beat it was let go in, back or forth", () => {
    expect(beatAt(tl, "b1-ch01", 25)).toEqual({ id: "water", at: 17.5 });
    expect(beatAt(tl, "b1-ch01", 17.5)!.id).toBe("water");
    expect(beatAt(tl, "b1-ch01", 3)!.id).toBe("wake");
    expect(beatAt(tl, "b1-ch01", 149)!.id).toBe("sit-up");
    expect(beatAt(tl, "b1-ch01", -2)!.id).toBe("wake");
  });

  it("reads as m:ss", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(72.9)).toBe("1:12");
    expect(mmss(-3)).toBe("0:00");
  });
});
