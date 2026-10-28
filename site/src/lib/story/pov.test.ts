import { describe, expect, it } from "vitest";
import story from "../../content/generated/story.json";
import { Director, type Scene, type Stage } from "./director";
import { film, inBeat, presence, switchTo, type Pov } from "./pov";

const all = [...story.scenes, ...story.offstage] as unknown as Scene[];
const pov = story.pov as unknown as Pov;
const scene = (id: string) => all.find((s) => s.scene === id)!;
const ends = (sc: Scene) => sc.beats.flatMap((b) => [...(b.do ?? []), ...(b.then ?? [])]).filter((a) => "end" in a).map((a) => (a.end as { next: string | null }).next);

describe("points of view", () => {
  it("Dvij's film is the story as it plays today", () => {
    const f = film("dvij", all, pov);
    expect(f.scenes.map((s) => s.scene)).toEqual(story.scenes.map((s) => s.scene));
    // all of it but the Professor's way in from the garden, which he is there for alone
    expect(f.scenes.flatMap((s) => s.beats.filter((b) => b.offstage).map((b) => `${s.scene}#${b.id}`))).toEqual(["b1-ch03#on-his-way"]);
    // and a card for the garden he misses, before Chapter 3's first words
    const water = f.scenes.find((s) => s.scene === "b1-ch03")!.beats.find((b) => b.id === "water-face")!;
    expect(String(water.do![0].caption)).toMatch(/^Meanwhile, out in the garden/);
    expect(f.missed["b1-ch03"]).toEqual(["b1-ch02"]);
    expect(f.missed["b1-ch07"]).toEqual(["b1-ch06"]);
    for (const [i, sc] of f.scenes.entries()) expect(ends(sc)).toEqual([f.scenes[i + 1]?.scene ?? null]);
  });

  it("the Professor's pilot film is Chapters 2 and 3, then a card", () => {
    const f = film("professor", all, pov);
    expect(f.scenes.map((s) => s.scene)).toEqual(["b1-ch02", "b1-ch03"]);
    expect(ends(f.scenes[0])).toEqual(["b1-ch03"]);
    expect(ends(f.scenes[1])).toEqual([null]);
    expect(f.joins.at(-1)).toEqual({ kind: "end", from: "b1-ch03", card: "The Professor's story continues in Chapter 7." });
    // the garden to the study, the same mid-morning: he walks it
    expect(f.joins[0]).toEqual({ kind: "walk", from: "b1-ch02", to: "b1-ch03" });
    // he has gone indoors by the time Mahant stands thinking
    expect(f.scenes[0].beats.find((b) => b.id === "the-thought")!.offstage).toBe(true);
    // his waking is told from inside Dvij: its caption is his film's alone
    const waking = (g: typeof f) => g.scenes.find((s) => s.scene === "b1-ch03")!.beats.find((b) => b.id === "water-face")!.do!.some((a) => "caption" in a);
    // he walks in from the garden by way of the kitchen, in his film only
    expect(f.scenes[1].beats[0]).toMatchObject({ id: "on-his-way" });
    expect(f.scenes[1].beats[0].offstage).toBeFalsy();
    expect(waking(f)).toBe(false);
    expect(waking(film("dvij", all, pov))).toBe(true);
  });

  it("works out who is in each beat from the script", () => {
    const ch7 = presence(scene("b1-ch07"), pov);
    expect([...ch7.get("days")!].sort()).toEqual(["bhavi", "dvij", "professor"]);
    expect(ch7.get("the-doctor")!.has("maharaj")).toBe(false);          // he comes up the path later
    expect(ch7.get("the-bow")!.has("maharaj")).toBe(true);
    expect(ch7.get("the-huff")!.has("bhavi")).toBe(true);               // still there as she leaves
    expect(ch7.get("what-you-know")!.has("bhavi")).toBe(false);
    const ch8 = presence(scene("b1-ch08"), pov);
    expect(ch8.get("the-gong")!.has("bhavi")).toBe(true);
    expect(ch8.get("the-summons")!.has("bhavi")).toBe(true);            // back through the door
    const ch2 = presence(scene("b1-ch02"), pov);
    expect([...ch2.get("the-sapling")!].sort()).toEqual(["mahant", "professor", "vaidji"]);   // Baldev's foot comes next
    expect(ch2.get("the-crush")!.has("baldev")).toBe(true);
    expect(ch2.get("the-thought")!.has("professor")).toBe(false);
    expect(ch2.get("the-thought")!.has("dvij")).toBe(false);
  });

  it("pov.yaml's tags keep the Professor out of Dvij's waking in Chapter 7", () => {
    expect(inBeat(scene("b1-ch07"), "days", pov)).toEqual(["dvij"]);
    expect(inBeat(scene("b1-ch07"), "the-clearing", pov)).toEqual(["dvij", "professor"]);
  });

  it("switches to the same beat, the scene alongside, or the next scene", () => {
    expect(switchTo("professor", { scene: "b1-ch03", beat: "veena" }, all, pov)).toEqual({ scene: "b1-ch03", beat: "veena" });
    expect(switchTo("professor", { scene: "b1-ch01", beat: "study" }, all, pov)).toEqual({ scene: "b1-ch02" });
    expect(switchTo("dvij", { scene: "b1-ch02", beat: "the-scroll" }, all, pov)).toEqual({ scene: "b1-ch01" });
    expect(switchTo("professor", { scene: "b1-ch04", beat: "talk" }, all, pov)).toEqual({ scene: "b1-ch03" });
    expect(switchTo("dvij", { scene: "b1-ch03", beat: "veena" }, all, pov, true)).toEqual({ scene: "b1-ch03", beat: "veena" });
  });

  it("the director plays a beat its person isn't there for unseen", async () => {
    const log: string[] = [];
    const stage: Stage = {
      perform: async (verb, _arg, _sc, hurried) => { log.push(`${verb}${hurried ? "*" : ""}`); },
      await: async () => { log.push("act"); },
      setUp: async () => {},
      finished: (_sc, next) => { log.push(`end:${next}`); },
      save: () => {},
    };
    const ch7 = film("professor", [scene("b1-ch07")], { ...pov, films: { ...pov.films, professor: { name: "The Professor" } } }).scenes[0];
    await new Director(stage, [ch7]).play("b1-ch07");
    const first = log.indexOf("act");
    // the waking plays hurried and silent: no captions, no waiting for Dvij
    expect(log.slice(0, first).every((l) => l.endsWith("*"))).toBe(true);
    expect(log.slice(0, first).some((l) => l.startsWith("caption"))).toBe(false);
    expect(log.at(-1)).toBe("end:null");
  });
});
