import { expect, test } from "@playwright/test";

/** The Hall unlocks on B2 p8, where the Professor explains the technique. */
async function unlock(page: import("@playwright/test").Page) {
  await page.goto("/read/b2/8");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
}

test("the Hall is veiled until the reader reaches the page that teaches it", async ({ page }) => {
  await page.goto("/avadhana/");
  await expect(page.locator("[data-first-book][data-veiled]")).toHaveCount(1);
  await unlock(page);
  await page.goto("/avadhana/");
  await expect(page.locator("[data-first-book][data-veiled]")).toHaveCount(0);
});

test("the ladder climbs pada to ghana and generates each pattern", async ({ page }) => {
  await unlock(page);
  await page.goto("/avadhana/");
  await page.locator('.memory-hall[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Show me the next word" }).click();
  await page.getByRole("button", { name: "Begin with the words" }).click();

  for (const rung of ["pada", "krama", "jaṭā", "ghana"]) {
    await expect(page.locator(".ladder h2")).toContainText(rung);
    // In guided mode the next correct word carries .hint.
    while (await page.locator(".chips .chip.hint").count()) {
      await page.locator(".chips .chip.hint").first().click();
    }
    await expect(page.locator(".level-done")).toBeVisible();
    await page.locator(".level-done .btn").click();
  }
  await expect(page.locator(".why h2")).toBeVisible();
});

test("the corruption demo shows one word breaking several groups at once", async ({ page }) => {
  await unlock(page);
  await page.goto("/avadhana/");
  await page.locator('.memory-hall[data-hydrated="true"]').waitFor();
  await page.evaluate(() => localStorage.setItem("twice-born:memory:v1", JSON.stringify({ phase: "why", verse: "gopi-bhagya" })));
  await page.reload();

  // pada says every word once: a slip there has nothing to contradict it.
  await page.locator(".controls").getByRole("button", { name: "pada" }).click();
  await expect(page.locator(".utt.lit")).toHaveCount(1);
  await expect(page.locator(".count")).toContainText("spoken 1 time");

  // ghana says it many times over, in several groups.
  await page.locator(".controls").getByRole("button", { name: "ghana" }).click();
  await expect(page.locator(".utt.lit")).toHaveCount(3);
  await expect(page.locator(".count")).toContainText("13");
});

test("the avadhana ring takes the items back in order and grows", async ({ page }) => {
  await unlock(page);
  await page.goto("/avadhana/");
  await page.locator('.memory-hall[data-hydrated="true"]').waitFor();
  await page.evaluate(() => localStorage.setItem("twice-born:memory:v1", JSON.stringify({ phase: "ring", verse: "gopi-bhagya" })));
  await page.reload();

  const given: string[] = [];
  for (let i = 0; i < 4; i++) {
    const line = await page.locator(".asking .item").innerText();
    given.push(line.replace(/^.*Hold this: /, "").replace(/[.”"]+$/, "").trim());
    await page.locator(".asking .btn").click();
  }
  await expect(page.locator(".interrupted")).toBeVisible();
  await page.locator(".interrupted .btn").click();
  for (const item of given) {
    await page.locator(".answering .chips .chip", { hasText: new RegExp(`^${item}$`) }).click();
  }
  await expect(page.locator(".ring .result")).toContainText("4 of 4");
  await expect(page.getByRole("button", { name: /Try 6 questioners/ })).toBeVisible();
});

test("a hotspot in the comic leads from the Professor's balloon to the Hall", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Note: The memory technique" }).click();
  const drawer = page.getByRole("dialog", { name: "Codex" });
  await expect(drawer.getByRole("link", { name: /Learn it yourself/ })).toHaveAttribute("href", "/avadhana/");
  // The same mark also carries the Codex entry for the patterns.
  await expect(drawer.getByRole("heading", { name: /recitation patterns/i })).toBeVisible();
});

test("the Codex entries for the technique exist and cross-link", async ({ page }) => {
  await page.goto("/codex/avadhana/");
  await expect(page.getByRole("heading", { level: 1, name: "Avadhana" })).toBeVisible();
  await page.goto("/codex/vedic-pathas/");
  await expect(page.locator(".body table")).toHaveCount(1); // the patha ladder
  await expect(page.getByRole("link", { name: "the Memory Hall" }).first()).toHaveAttribute("href", "/avadhana/");
});
