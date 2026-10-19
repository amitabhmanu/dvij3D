import { expect, test } from "@playwright/test";

test("the gallery filters by kind", async ({ page }) => {
  await page.goto("/bestiary/");
  const cards = page.locator(".beast");
  await expect(cards).toHaveCount(14);
  await page.getByRole("button", { name: "Temple carving" }).click();
  await expect(cards.filter({ visible: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Vyala" })).toBeVisible();
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(cards.filter({ visible: true })).toHaveCount(14);
});

test("creatures are veiled until the reader reaches the page that names them", async ({ page }) => {
  await page.goto("/read/b1/20");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.goto("/bestiary/");
  // Viraat's list is on b1 p18; the rakshasa is not until p30.
  const banmanus = page.locator(".beast", { has: page.getByRole("link", { name: "Banmanus" }) });
  await expect(banmanus).not.toHaveAttribute("data-veiled", "");
  const rakshasa = page.locator(".beast", { has: page.getByRole("link", { name: /Vraktaasura/ }) });
  await expect(rakshasa).toHaveAttribute("data-veiled", "");
});

test("an entry lists the pages it is named on and the ones it is only drawn on", async ({ page }) => {
  await page.goto("/bestiary/vyala/");
  await expect(page.getByRole("heading", { level: 1, name: "Vyala" })).toBeVisible();
  // Named on B1 p39; drawn, unnamed, on B3 p22 — the `alsoOn` mark.
  const pages = page.locator(".pages a");
  await expect(pages).toHaveText(["Book 1, page 39", "Book 3, page 22"]);
  await expect(page.locator(".figure img")).toHaveCount(1);
});

test("the Nagas are a Codex entry, not a creature", async ({ page }) => {
  await page.goto("/bestiary/");
  await expect(page.locator(".note").getByRole("link", { name: "Codex entry" })).toHaveAttribute("href", "/codex/nagas/");
  await page.goto("/codex/nagas/");
  await expect(page.getByRole("heading", { level: 1, name: "The Nagas" })).toBeVisible();
  // a picture of real people carries its own alt text and a credit line
  const img = page.locator(".figures img");
  await expect(img).toHaveAttribute("alt", /Naga warrior in ceremonial dress/);
  await expect(page.locator(".figures figcaption")).toContainText("licence");
});

test("a creature with no art says so instead of showing a placeholder", async ({ page }) => {
  await page.goto("/bestiary/gandharva/");
  await expect(page.locator(".figure .no-art")).toContainText("Never drawn");
  await expect(page.locator(".figure img")).toHaveCount(0);
});

test("one balloon opens every creature it names", async ({ page }) => {
  await page.goto("/read/b1/18");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: /Note: Banmanus/i }).click();
  const drawer = page.getByRole("dialog", { name: "Codex" });
  for (const name of ["Banmanus", "Pichhal peri", "Pishacha", "Kimpurusha", "Kinnara"]) {
    await expect(drawer.getByRole("heading", { name })).toBeVisible();
  }
});
