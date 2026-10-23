import { describe, expect, it } from "vitest";
import type { Game } from "../walk/game";
import type { Scene } from "./director";
import { PovStage } from "./pov-stage";
import type { StoryScreen, StoryStage } from "./stage";

/** A stage that only notes what it was asked to do, and a game that notes the camera it was given. */
function rig(who: string) {
  const log: string[] = [];
  let set: Scene | null = null;
  const inner = {
    setUp: async (sc: Scene) => { set = sc; },
    perform: async (verb: string, arg: unknown) => { log.push(`${verb} ${JSON.stringify(arg)}`); },
    setAuto: (on: boolean) => log.push(`auto ${on}`),
    finished: () => log.push("saved and ended"),
    save: () => log.push("saved"),
    people: null,
    stance: "stand",
  } as unknown as StoryStage;
  const filmed: unknown[] = [];
  const game = { body: { film: (r: unknown) => filmed.push(r), every: () => () => {}, sight: { set: () => {} }, lodgeRoot: () => null } } as unknown as Game;
  const screen = { ended: () => log.push("ended") } as unknown as StoryScreen;
  return { stage: new PovStage(game, inner, screen, who), log, filmed, scene: () => set };
}
const sc = { scene: "s", book: 1, pages: [], title: "", start: { pose: "floor", at: [1, 2] }, cast: [{ who: "professor", at: [0, 0] }], beats: [] } as unknown as Scene;

describe("someone else's film", () => {
  it("Dvij is one of the cast, the camera is the film's, and only their own effects play", async () => {
    const { stage, log, filmed, scene } = rig("professor");
    await stage.setUp(sc);
    expect(scene()!.cast!.map((c) => c.who)).toEqual(["professor", "dvij"]);
    expect(typeof filmed[0]).toBe("function");
    stage.setAuto(false);
    expect(log.at(-1)).toBe("auto true"); // no one plays Dvij here
    await stage.perform("effect", { blur: 0.6 }, sc, false);
    await stage.perform("effect", { swirl: 1, for: "professor" }, sc, false);
    await stage.perform("effect", { swirl: 1, for: "dvij" }, sc, false);
    await stage.perform("look", { at: "arm" }, sc, false);
    await stage.perform("reflection", { panel: "x" }, sc, false);
    await stage.perform("say", { who: "dvij", line: "Hello" }, sc, false);
    expect(log.slice(1)).toEqual(['effect {"swirl":1}', 'say {"who":"dvij","line":"Hello"}']);
    stage.finished(sc, null);
    stage.save("s", "b");
    expect(log.slice(-1)).toEqual(["ended"]); // Dvij's place in his own film is kept
  });

  it("Dvij's own film plays as it always has, but an effect for someone else", async () => {
    const { stage, log, filmed, scene } = rig("dvij");
    await stage.setUp(sc);
    expect(scene()!.cast!.map((c) => c.who)).toEqual(["professor"]);
    expect(filmed).toEqual([null]);
    await stage.perform("effect", { swirl: 1, for: "professor" }, sc, false);
    await stage.perform("look", { at: "arm" }, sc, false);
    expect(log).toEqual(['look {"at":"arm"}']);
  });
});
