import { describe, expect, it } from "vitest";
import { Blockers, direction, inside, step, type Move, type World } from "./player";

const rules = { eye: 1.7, walk: 5, run: 12, maxSlope: 38, radius: 0.4 };
const still: Move = { forward: 0, strafe: 0, run: false, turn: 0, look: 0 };
const flat: World = { ground: () => 0, blocked: () => false };
const start = { x: 0, z: 0, y: 0, heading: 0, pitch: 0 };

describe("walking", () => {
  it("faces north at heading 0 and east at a quarter turn", () => {
    expect(direction(0)).toEqual([0, -1]);
    const [x, z] = direction(Math.PI / 2);
    expect(x).toBeCloseTo(1, 10);
    expect(z).toBeCloseTo(0, 10);
  });
  it("walks 5 m a second and runs 12", () => {
    let p = step(start, { ...still, forward: 1 }, 1, rules, flat);
    expect(p.z).toBeCloseTo(-5, 6);
    p = step(start, { ...still, forward: 1, run: true }, 1, rules, flat);
    expect(p.z).toBeCloseTo(-12, 6);
  });
  it("doesn't walk faster diagonally", () => {
    const p = step(start, { ...still, forward: 1, strafe: 1 }, 1, rules, flat);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(5, 6);
  });
  it("keeps the eye 1.7 m above the ground", () => {
    const p = step(start, still, 1 / 60, rules, { ...flat, ground: () => 42 });
    expect(p.y).toBeCloseTo(43.7, 6);
  });
  it("won't climb ground steeper than 38 degrees, but slides along it", () => {
    const wall: World = { ...flat, ground: (x) => (x > 0.05 ? x * 2 : 0) }; // 63 degrees going east
    let p = step({ ...start, heading: Math.PI / 2 }, { ...still, forward: 1 }, 0.1, rules, wall);
    expect(p.x).toBe(0);
    p = step({ ...start, heading: Math.PI / 4 }, { ...still, forward: 1 }, 0.1, rules, wall);
    expect(p.x).toBe(0);
    expect(p.z).toBeLessThan(0); // slid north along the face
  });
  it("goes downhill however steep", () => {
    const drop: World = { ...flat, ground: (x) => -x * 3 };
    const p = step({ ...start, heading: Math.PI / 2 }, { ...still, forward: 1 }, 0.1, rules, drop);
    expect(p.x).toBeGreaterThan(0);
  });
  it("stops at whatever blocks the way", () => {
    const rocks = new Blockers();
    rocks.add(0, -1, 0.5);
    const p = step(start, { ...still, forward: 1 }, 0.2, rules, { ...flat, blocked: (x, z, r) => rocks.hits(x, z, r) });
    expect(p.z).toBe(0);
  });
  it("clamps looking up and down", () => {
    const p = step(start, { ...still, look: 5 }, 1 / 60, rules, flat);
    expect(p.pitch).toBeCloseTo(1.45, 10);
  });
});

describe("blockers and polygons", () => {
  it("finds a blocker across a cell border", () => {
    const b = new Blockers(16);
    b.add(15.9, 0, 0.3);
    expect(b.hits(16.3, 0, 0.4)).toBe(true);
    expect(b.hits(18, 0, 0.4)).toBe(false);
  });
  it("tells inside from outside", () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(inside(sq, 5, 5)).toBe(true);
    expect(inside(sq, 15, 5)).toBe(false);
  });
});
