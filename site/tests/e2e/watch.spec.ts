import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Watch mode (design §10.4): the story plays itself, like a film, with a
// player bar: pause, restart, slow motion, fast forward, chapter back and forward.
const story = JSON.parse(readFileSync(new URL("../../src/content/generated/story.json", import.meta.url), "utf8"));
type G = { walkGame: { player: () => { x: number; y: number; z: number }; body: { fromLodge: (x: number, y: number, z: number) => number[] } } };

async function watch(page: Page) {
  await page.goto("/valley/walk/?test");
  await page.getByRole("button", { name: "Watch it play, like a film" }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 60_000 });
  await page.locator(".begin").click();
  await expect(page.locator(".walk")).toHaveAttribute("data-story", "b1-ch01");
}
const walkEl = (page: Page) => page.locator(".walk");
const bar = (page: Page) => page.getByRole("toolbar", { name: "The story's controls" });

test.describe("watch mode", () => {
  test("Chapter 1 plays by itself, Dvij walking from his bed to the study window", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await watch(page);
    await expect(page.locator(".objective")).toHaveCount(0); // nothing asked of the viewer
    await bar(page).getByRole("button", { name: "4×" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-rate", "4");

    const seen = new Set<string>();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const beat = await walkEl(page).getAttribute("data-beat");
      const sc = await walkEl(page).getAttribute("data-story");
      if (sc === "b1-ch01" && beat) seen.add(beat);
      if (sc === "b1-ch01" && beat === "faint") {
        // he got to the study's west window by himself
        const p = await page.evaluate(() => (window as unknown as G).walkGame.player());
        const w = await page.evaluate(() => (window as unknown as G).walkGame.body.fromLodge(-15.0, 0, -13.25));
        expect(Math.hypot(p.x - w[0], p.z - w[2])).toBeLessThan(1.5);
      }
      if (sc === "b1-ch03") break;
      await page.waitForTimeout(250);
    }
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch03"); // Chapter 2 is without him: skipped
    expect([...seen]).toEqual(story.scenes[0].beats.map((b: { id: string }) => b.id));
    expect(errors).toEqual([]);
  });

  test("the bar pauses, changes speed and chapter, and starts again from the beginning", async ({ page }) => {
    test.setTimeout(120_000);
    await watch(page);
    const b = bar(page);

    await b.getByRole("button", { name: "Pause" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-held", "");
    const beat = await walkEl(page).getAttribute("data-beat");
    const caption = await page.locator(".words").textContent().catch(() => null);
    await page.waitForTimeout(3000);
    await expect(walkEl(page)).toHaveAttribute("data-beat", beat!); // nothing moves on while paused
    if (caption) await expect(page.locator(".words")).toHaveText(caption);
    await b.getByRole("button", { name: "Play", exact: true }).click();
    await expect(walkEl(page)).not.toHaveAttribute("data-held", "");

    await b.getByRole("button", { name: "½×" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-rate", "0.5");

    await b.getByRole("button", { name: "Next chapter" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch03");
    await b.getByRole("button", { name: "Next chapter" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch04");
    await expect(page.locator(".words")).toHaveCount(0, { timeout: 5000 }); // Chapter 3's words went with it
    await page.keyboard.press("ArrowLeft");
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch03");

    await b.getByRole("button", { name: "From the beginning" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch01");
    await expect(walkEl(page)).toHaveAttribute("data-beat", "wake");
    const p = await page.evaluate(() => (window as unknown as G).walkGame.player());
    const bed = await page.evaluate(() => (window as unknown as G).walkGame.body.fromLodge(-15, 0, 7.5));
    expect(Math.hypot(p.x - bed[0], p.z - bed[2])).toBeLessThan(0.3); // back in bed
  });

  test("you can take over and play it yourself", async ({ page, isMobile }) => {
    test.skip(isMobile, "the take-over is driven with the keyboard here");
    test.setTimeout(120_000);
    await watch(page);
    await bar(page).getByRole("button", { name: "4×" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-beat", "water", { timeout: 30_000 });
    await bar(page).getByRole("button", { name: "Play it yourself" }).click();
    await expect(bar(page)).toHaveCount(0);
    // the glass waits for him now (unless the story had already reached for it)
    await expect(page.locator(".objective")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("l"); // the pointer is locked while you play: the key, not the button
    await expect(page.getByRole("button", { name: /Let it play/ })).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
  });

  test("each character speaks their lines in their own voice", async ({ page }) => {
    test.setTimeout(120_000);
    const voices = JSON.parse(readFileSync(new URL("../../src/content/generated/story-voices.json", import.meta.url), "utf8")).lines;
    const heard: string[] = [];
    page.on("response", (r) => { if (r.url().includes("/_assets/story/voices/") && r.status() < 400) heard.push(r.url()); });
    await watch(page);
    await bar(page).getByRole("button", { name: "Next chapter" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch03");
    await bar(page).getByRole("button", { name: "4×" }).click();
    // the Professor asks for his glasses, Dvij answers: two voices
    await expect.poll(() => new Set(heard.map((u) => u.split("/").pop()!.split("-")[0])).size, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    const files = new Set(Object.values(voices).map((v) => (v as { file: string }).file));
    for (const u of heard) expect(files.has(u.split("/").pop()!)).toBe(true);
  });

  test("only the chapters Dvij is in play: 1, 3, 4, 5, 7 and 8", async ({ page }) => {
    test.setTimeout(120_000);
    await watch(page);
    const went: string[] = ["b1-ch01"];
    for (let i = 0; i < 5; i++) {
      await bar(page).getByRole("button", { name: "Next chapter" }).click();
      await expect(walkEl(page)).not.toHaveAttribute("data-story", went.at(-1)!);
      went.push((await walkEl(page).getAttribute("data-story"))!);
      if (went.at(-1) === "b1-ch07") await expect(page.locator(".story-panel[data-panel='b1-p012-1']")).toBeVisible({ timeout: 30_000 }); // his days going by
    }
    expect(went).toEqual(["b1-ch01", "b1-ch03", "b1-ch04", "b1-ch05", "b1-ch07", "b1-ch08"]);
    await expect(bar(page).getByRole("button", { name: "Next chapter" })).toBeDisabled();
  });

  test("Chapter 8 plays by itself: Dvij walks himself out of the study to the front door", async ({ page }) => {
    test.setTimeout(240_000);
    await watch(page);
    for (let i = 0; i < 5; i++) await bar(page).getByRole("button", { name: "Next chapter" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-story", "b1-ch08");
    await bar(page).getByRole("button", { name: "4×" }).click();
    await expect(walkEl(page)).toHaveAttribute("data-screen", "the-end", { timeout: 200_000 });
    const p = await page.evaluate(() => (window as unknown as G).walkGame.player());
    const steps = await page.evaluate(() => (window as unknown as G).walkGame.body.fromLodge(0, 0, 20.4));
    expect(Math.hypot(p.x - steps[0], p.z - steps[2])).toBeLessThan(1.5);
  });
});
