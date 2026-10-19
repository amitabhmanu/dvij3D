import { expect, test, type Page } from "@playwright/test";

async function readTo(page: Page, furthest: Record<string, number>) {
  await page.goto("/about/");
  await page.evaluate((f) => localStorage.setItem("twice-born:v1", JSON.stringify({ furthest: f })), furthest);
}

test("the Council gallery veils figures the reader hasn't met", async ({ page }) => {
  await readTo(page, { b1: 42 });
  await page.goto("/voices/");
  const mahant = page.locator("li.voice", { has: page.getByRole("heading", { name: "The Mahant" }) });
  await expect(mahant).not.toHaveAttribute("data-veiled", "");
  const monk = page.locator("li.voice", { has: page.getByRole("heading", { name: "The monk under the tree" }) });
  await expect(monk).toHaveAttribute("data-veiled", ""); // Book 5
});

test("a Voice card shows the figure, their line and where they appear", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 34, b4: 32, b5: 29 });
  await page.goto("/voices/tantric-baba/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The tantric baba");
  await expect(page.locator("blockquote")).toContainText("Knowledge that hides in the darkness");
  await expect(page.locator(".facts")).toContainText("Book 1, page 40");
  await expect(page.locator(".portrait img")).toBeVisible();
});

test("the journey page filters by lens and never lights Sahasrara", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 34, b4: 32, b5: 29 });
  await page.goto("/journey/");
  await expect(page.locator(".timeline .node")).toHaveCount(10);
  await page.getByRole("button", { name: "The party" }).click();
  await expect(page.locator(".timeline .node:visible")).toHaveCount(4);
  await expect(page.locator(".node.unlit")).toContainText("never reached");
});

test("the rail in the reader lights what the reader has passed", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 34, b4: 32, b5: 20 });
  await page.goto("/read/b4/22");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Journey", exact: true }).click();
  const rail = page.locator(".journey-rail");
  await expect(rail.locator("li.lit")).toHaveCount(7);
  await expect(rail.getByRole("button", { name: /Sahasrara \(never reached\)/ })).toBeVisible();
  await rail.getByRole("button", { name: "Anahata" }).click();
  await expect(page.locator(".rail-card")).toContainText("the heart");
});

test("Charvaka fragments unlock their page once all five are found", async ({ page }) => {
  await readTo(page, { b1: 42, b2: 34, b3: 34, b4: 32, b5: 29 });
  await page.goto("/charvaka/");
  await expect(page.locator("#locked")).toBeVisible();
  await expect(page.locator("#unlocked")).toBeHidden();

  await page.goto("/read/b4/22");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: /While life is yours/ }).click();
  await expect(page.getByRole("dialog", { name: /Codex|fragment/i })).toContainText("Fragment found: 1 of 5");

  await page.evaluate(() =>
    localStorage.setItem("twice-born:fragments:v1", JSON.stringify(["manuscript", "fools", "not-destroyed", "shrine", "joyously"])));
  await page.goto("/charvaka/");
  await expect(page.locator("#unlocked")).toBeVisible();
  await expect(page.locator("#locked")).toBeHidden();
  await expect(page.locator(".found li")).toHaveCount(5);
});
