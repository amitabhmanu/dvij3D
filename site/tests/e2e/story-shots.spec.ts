// Screenshots of story mode for review (not part of the gate: run with SHOTS=1).
import { expect, test } from "@playwright/test";

test.skip(!process.env.SHOTS, "review screenshots only");

test("story mode, Chapter 1, for review", async ({ page }) => {
  test.setTimeout(240_000);
  const out = process.env.SHOTS!;
  await page.goto("/valley/walk/?story&test");
  await page.getByRole("button", { name: "Play the story" }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 60_000 });
  await page.locator(".begin").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/1-wake.png` });
  const y = await page.evaluate(() => (window as any).walkGame.player().y); // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log("lying eye y", y);
  await page.keyboard.press("e");
  await page.keyboard.press("e");
  await expect(page.locator(".objective")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${out}/2-glass.png` });
  for (const beat of ["shutters", "window"]) {
    await page.evaluate((b) => { (window as any).walkStory.director.play("b1-ch01", b); }, beat); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/3-${beat}.png` });
  }
});

test("watch mode, for review", async ({ page }) => {
  test.setTimeout(240_000);
  const out = process.env.SHOTS!;
  await page.goto("/valley/walk/?test");
  await page.getByRole("button", { name: "Watch it play, like a film" }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 60_000 });
  await page.locator(".begin").click();
  await page.getByRole("button", { name: "4×" }).click();
  await expect(page.locator(".walk")).toHaveAttribute("data-beat", "study", { timeout: 120_000 });
  await page.getByRole("button", { name: "1×" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/4-watch-walking.png` });
  await page.getByRole("button", { name: "Next chapter" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/5-watch-comic.png` });
});

test("chapters 6 and 7, for review", async ({ page }) => {
  test.setTimeout(240_000);
  const out = process.env.SHOTS!;
  await page.goto("/valley/walk/?test");
  await page.getByRole("button", { name: "Watch it play, like a film" }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 60_000 });
  await page.locator(".begin").click();
  const bar = page.getByRole("toolbar");
  for (let i = 0; i < 5; i++) await bar.getByRole("button", { name: "Next chapter" }).click();
  await page.locator(".story-panel[data-panel='b1-p011-5']").waitFor({ timeout: 60_000 });
  await page.locator(".words").waitFor({ timeout: 20_000 });
  await bar.getByRole("button", { name: "Pause" }).click();
  await page.screenshot({ path: `${out}/6-mahant.png` });
  await bar.getByRole("button", { name: "Play", exact: true }).click();
  await bar.getByRole("button", { name: "Next chapter" }).click();
  await bar.getByRole("button", { name: "4×" }).click();
  await expect(page.locator(".walk")).toHaveAttribute("data-beat", "the-doctor", { timeout: 150_000 });
  await bar.getByRole("button", { name: "1×" }).click();
  await page.locator(".words").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: `${out}/7-clearing.png` });
});
