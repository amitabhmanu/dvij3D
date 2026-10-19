import { expect, test } from "@playwright/test";

test("a new reader sees Codex spoilers veiled, and can reveal them", async ({ page }) => {
  await page.goto("/codex/");
  const chakras = page.locator("li", { has: page.getByRole("link", { name: "Chakras", exact: true }) });
  await expect(chakras).toHaveAttribute("data-veiled", "");
  await page.getByRole("button", { name: "Show everything" }).click();
  await expect(chakras).not.toHaveAttribute("data-veiled", "");
});

test("entries unlock once the reader reaches their first page", async ({ page }) => {
  await page.goto("/read/b1/7");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.goto("/codex/");
  const matrikas = page.locator("li", { has: page.getByRole("link", { name: /Saptamatrikas/ }) });
  await expect(matrikas).not.toHaveAttribute("data-veiled", "");
  const chakras = page.locator("li", { has: page.getByRole("link", { name: "Chakras", exact: true }) });
  await expect(chakras).toHaveAttribute("data-veiled", ""); // first seen in Book 3
});

test("a hotspot on the page opens the Codex drawer", async ({ page }) => {
  await page.goto("/read/b1/7");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Note: saptamatrikas" }).click();
  const drawer = page.getByRole("dialog", { name: "Codex" });
  await expect(drawer.getByRole("heading", { name: /Saptamatrikas/ })).toBeVisible();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toHaveCount(0);
});

test("the Notes toggle hides hotspots", async ({ page }) => {
  await page.goto("/read/b1/7");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await expect(page.getByRole("button", { name: "Note: saptamatrikas" })).toHaveCount(1);
  await page.getByRole("button", { name: "Notes" }).click();
  await expect(page.getByRole("button", { name: "Note: saptamatrikas" })).toHaveCount(0);
});

test("a Codex entry page renders its table and diagram", async ({ page }) => {
  await page.goto("/codex/dikpalas/");
  await expect(page.getByRole("heading", { level: 1, name: "Dikpalas" })).toBeVisible();
  await expect(page.locator(".body table")).toHaveCount(1);
  await expect(page.locator(".figures img")).toHaveCount(1);
});
