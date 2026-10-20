import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Story mode (design §10.4): /valley/walk/?story. The book's scenes play out,
// and Dvij (the player) does what each beat asks.
const story = JSON.parse(readFileSync(new URL("../../src/content/generated/story.json", import.meta.url), "utf8"));
type Act = { objective: string; kind: string; target?: string | number[]; radius?: number };
const acts = new Map<string, Act>();
for (const sc of story.scenes) for (const b of sc.beats) if (b.act) acts.set(`${sc.scene}/${b.id}`, b.act);

type G = {
  walkGame: {
    teleport: (x: number, z: number, h?: number) => void;
    player: () => { x: number; y: number; z: number };
    body: { fromLodge: (x: number, y: number, z: number) => number[]; face: (p: number[]) => void };
  };
  walkStory: { stage: { props: { point: (id: string) => number[] | null } } };
};

async function begin(page: Page, button: string) {
  await page.getByRole("button", { name: button }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 60_000 });
  await page.locator(".begin").click();
  await expect(page.locator(".walk")).toHaveAttribute("data-screen", "playing");
}

const state = (page: Page) => page.evaluate(() => {
  const w = document.querySelector<HTMLElement>(".walk")!;
  return {
    scene: w.dataset.story ?? "", beat: w.dataset.beat ?? "",
    words: !!document.querySelector(".words"), overlay: document.querySelector<HTMLElement>(".story-overlay")?.dataset.overlay ?? null,
    objective: document.querySelector(".objective .what")?.textContent?.trim() ?? null,
    ready: !!document.querySelector(".objective[data-ready]"),
  };
});

/** Do what the story asks, the way a player would (walking is a teleport here), until `done`. */
async function drive(page: Page, done: (s: Awaited<ReturnType<typeof state>>) => boolean, seen: string[] = []) {
  for (let i = 0; i < 400; i++) {
    const s = await state(page);
    if (done(s)) return s;
    if (!seen.includes(`${s.scene}/${s.beat}`)) seen.push(`${s.scene}/${s.beat}`);
    if (s.words || s.overlay) {
      await page.keyboard.press("e");
    } else if (s.objective) {
      // the act on screen (the beat shown on the page can lag a moment behind it)
      const act = [...acts].find(([k, a]) => k.startsWith(`${s.scene}/`) && a.objective === s.objective)?.[1];
      expect(act, s.objective).toBeTruthy();
      if (!act) return s;
      if (act.kind === "reach" || act.kind === "look-press" || act.kind === "use") {
        await page.evaluate(([act]) => {
          const w = window as unknown as G, g = w.walkGame;
          const t = typeof act.target === "string"
            ? g.body.fromLodge(...(w.walkStory.stage.props.point(act.target) as [number, number, number]))
            : act.target!.length === 2 ? g.body.fromLodge(act.target![0], 1.2, act.target![1]) : g.body.fromLodge(...(act.target as [number, number, number]));
          const me = g.player();
          const d = Math.hypot(t[0] - me.x, t[2] - me.z);
          if (act.kind === "reach") g.teleport(t[0], t[2]);
          else {
            if (d > 2.2) g.teleport(t[0] + ((me.x - t[0]) / d) * 1.2, t[2] + ((me.z - t[2]) / d) * 1.2);
            g.body.face(t);
          }
        }, [act] as const);
      }
      if (act.kind !== "reach") {
        await expect(page.locator(".objective[data-ready]")).toBeVisible();
        await page.keyboard.press("e");
      }
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`the story stalled at ${JSON.stringify(await state(page))}`);
}

test.describe("story mode", () => {
  test.skip(({ isMobile }) => isMobile, "driven with the keyboard; phones tap the same buttons");

  test("Chapter 1 plays through by Dvij's own actions, into Chapter 2's pages", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/valley/walk/?story&test");
    await begin(page, "Play the story");
    await expect(page.locator(".walk")).toHaveAttribute("data-story", "b1-ch01");
    await expect(page.locator(".minimap")).toBeHidden(); // no map in the story

    // He wakes lying in the bed, under the ceiling, and can't walk yet.
    const lying = await page.evaluate(() => (window as unknown as G).walkGame.player());
    const bed = await page.evaluate(() => (window as unknown as G).walkGame.body.fromLodge(-15, 0, 7.5));
    expect(Math.hypot(lying.x - bed[0], lying.z - bed[2])).toBeLessThan(0.3);
    await page.keyboard.down("w");
    await page.waitForTimeout(500);
    await page.keyboard.up("w");
    const still = await page.evaluate(() => (window as unknown as G).walkGame.player());
    expect(Math.hypot(still.x - lying.x, still.z - lying.z)).toBeLessThan(0.05);

    const seen: string[] = [];
    await drive(page, (s) => s.scene === "b1-ch02" && s.overlay === "page", seen);
    expect(seen.filter((b) => b.startsWith("b1-ch01/"))).toEqual(
      story.scenes[0].beats.map((b: { id: string }) => `b1-ch01/${b.id}`),
    );
    await expect(page.locator(".comic-page img")).toHaveAttribute("src", /b1-p005/);
    const furthest = await page.evaluate(() => JSON.parse(localStorage.getItem("twice-born:v1") || "{}").furthest?.b1);
    expect(furthest).toBeGreaterThanOrEqual(4); // he's lived through page 4: its spoilers lift
    expect(errors).toEqual([]);
  });

  test("the story resumes from its checkpoint, and a scene can be skipped", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem("twice-born:story:v1", JSON.stringify({ scene: "b1-ch01", beat: "shutters" })));
    await page.goto("/valley/walk/?story&test");
    await expect(page.getByRole("button", { name: "Start from the beginning" })).toBeVisible();
    await begin(page, "Continue the story");
    await expect(page.locator(".objective")).toHaveText(/Open the boarded window/, { timeout: 15_000 });
    // resuming put him on his feet, with what came before already done (the glass drunk)
    const p = await page.evaluate(() => (window as unknown as G).walkGame.player());
    const floor = await page.evaluate(() => (window as unknown as G).walkGame.body.fromLodge(0, 0.6, 0)[1]);
    expect(p.y - floor).toBeGreaterThan(1.3);

    await page.keyboard.press("k");
    await expect(page.locator(".walk")).toHaveAttribute("data-story", "b1-ch02", { timeout: 15_000 });
  });

  test("the reflection is the comic's own panel", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem("twice-born:story:v1", JSON.stringify({ scene: "b1-ch01", beat: "window" })));
    await page.goto("/valley/walk/?story&test");
    await begin(page, "Continue the story");
    await drive(page, (s) => s.overlay === "reflection");
    const img = page.locator(".reflection-frame img");
    await expect(img).toHaveAttribute("src", /b1-p004/);
    await expect(img).toHaveAttribute("alt", /reflection/i);
  });
});
