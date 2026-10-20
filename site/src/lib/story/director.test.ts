import { describe, expect, it } from "vitest";
import story from "../../content/generated/story.json";
import { Director, type Act, type Scene, type Stage } from "./director";

function fake(opts: { autoAct?: boolean } = {}) {
  const log: string[] = [];
  let release: (() => void) | null = null;
  const stage: Stage = {
    perform: async (verb, arg) => { log.push(`${verb}:${typeof arg === "string" ? arg : JSON.stringify(arg)}`); },
    await: (act: Act) => {
      log.push(`act:${act.objective}`);
      return opts.autoAct ? Promise.resolve() : new Promise<void>((r) => { release = r; });
    },
    setUp: async (sc) => { log.push(`setup:${sc.scene}`); },
    finished: (sc, next) => { log.push(`end:${sc.scene}->${next}`); },
    save: (sc, beat) => { log.push(`save:${sc}/${beat}`); },
  };
  return { stage, log, act: () => { const r = release; release = null; r?.(); } };
}

const scenes = story.scenes as unknown as Scene[];
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the director", () => {
  it("plays chapter 1 in order and waits for each of Dvij's actions", async () => {
    const f = fake();
    const d = new Director(f.stage, scenes);
    const done = d.play("b1-ch01");
    await tick();
    expect(f.log.at(-1)).toBe("act:Reach for the glass on the stool.");
    expect(f.log.some((l) => l.startsWith("caption:He had been staring at the ceiling"))).toBe(true);
    // nothing happens until he reaches for the glass
    await tick();
    expect(f.log.at(-1)).toBe("act:Reach for the glass on the stool.");
    for (let k = 0; k < 8; k++) {
      f.act();
      await tick();
      await tick();
    }
    await done;
    expect(f.log).toContain("save:b1-ch01/stand");
    expect(f.log.at(-1)).toBe("end:b1-ch01->b1-ch02");
    const order = f.log.filter((l) => l.startsWith("act:"));
    expect(order).toEqual([
      "act:Reach for the glass on the stool.", "act:Sit up.", "act:Stand up.", "act:Open the boarded window.",
      "act:Find water.", "act:Look for someone.", "act:Go to the windows.",
    ]);
  });

  it("resumes from a checkpoint", async () => {
    const f = fake({ autoAct: true });
    await new Director(f.stage, scenes).play("b1-ch01", "shutters");
    expect(f.log[0]).toBe("setup:b1-ch01");
    expect(f.log.filter((l) => l.startsWith("act:"))[0]).toBe("act:Open the boarded window.");
  });

  it("skipping plays the scene's consequences but not its words or waits", async () => {
    const f = fake();
    const d = new Director(f.stage, scenes);
    const done = d.play("b1-ch05");
    await tick();
    d.skip();
    f.act();
    await done;
    expect(f.log.some((l) => l.startsWith("say:"))).toBe(false);
    expect(f.log).toContain(`progress:${JSON.stringify({ book: 1, page: 10 })}`);
    expect(f.log.at(-1)).toBe("end:b1-ch05->b1-ch06");
  });
});
