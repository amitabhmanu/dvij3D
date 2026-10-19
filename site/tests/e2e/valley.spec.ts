import { expect, test } from "@playwright/test";
import { unloadedImages } from "./images";

test("the Real India toggle puts a real name on each labelled place", async ({ page }) => {
  await page.goto("/valley/");
  const pins = page.locator(".pin");
  await expect(pins.first()).toBeHidden();
  await page.getByRole("button", { name: "Real India" }).click();
  await expect(pins.first()).toBeVisible();
  await expect(pins).toHaveCount(8);
  // the fort's label carries Daulatabad, the pairing the map is keyed to
  await expect(page.locator(".pin", { hasText: "Daulatabad Fort" })).toBeVisible();
  await expect(page.locator("#map")).toHaveAttribute("data-real", "on");
});

test("every photograph carries its photographer, licence and source", async ({ page }) => {
  await page.goto("/valley/");
  const shots = page.locator(".shots li");
  await expect(shots).toHaveCount(25);
  for (const shot of await shots.all()) {
    await expect(shot.locator("img")).toHaveAttribute("alt", /.{30,}/); // a description, not a word
    const credit = shot.locator(".credit");
    await expect(credit).toContainText("via Wikimedia Commons");
    await expect(credit.getByRole("link").first()).toHaveAttribute(
      "href", /commons\.wikimedia\.org\/wiki\/File:/);
  }
  // a CC BY-SA photo links the deed; a CC0 one says the credit is a courtesy
  const dolmen = page.locator("#dolmen-field .credit");
  await expect(dolmen.getByRole("link", { name: "CC BY-SA 4.0" }))
    .toHaveAttribute("href", /creativecommons\.org\/licenses\/by-sa\/4\.0/);
  await expect(page.locator("#vidgati-shrine .credit").first()).toContainText("credited by choice");
  // and every photograph actually arrives. The credits above all passed while
  // the 25 files were missing from the bucket and every one was a broken image.
  await expect.poll(() => unloadedImages(page, ".shots img"), { timeout: 30_000 }).toEqual([]);
});

test("a pairing links to the pages of the comic that name it", async ({ page }) => {
  await page.goto("/valley/");
  await expect(page.locator("#mount-dronagiri .pages a").first()).toHaveAttribute("href", /^\/read\/b\d+\/\d+$/);
  // Dunagiri is the Chamoli peak, not the Navi Mumbai suburb of the same spelling
  await expect(page.locator("#mount-dronagiri h4")).toContainText("Dunagiri, Chamoli");
});

test("places are veiled until the reader reaches them, and say they are guesses", async ({ page }) => {
  await page.goto("/read/b1/12");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  // the reader records progress just after it hydrates; wait for it rather than race it
  await page.waitForFunction(() => !!localStorage.getItem("twice-born:v1"));
  await page.goto("/valley/");
  // the fort is searched on b1 p29, the epilogue's flowers not until b5
  await expect(page.locator("#fort-ruins")).toHaveAttribute("data-veiled", "");
  await expect(page.locator("#white-flowers")).toHaveAttribute("data-veiled", "");
  await page.locator("#fort-ruins").getByRole("button", { name: "Show it" }).click();
  await expect(page.locator("#fort-ruins")).not.toHaveAttribute("data-veiled", "");
  await expect(page.locator(".caveat")).toContainText("resemblances, not sources");
});

test("the places left fictional are named as such", async ({ page }) => {
  await page.goto("/valley/");
  const nowhere = page.locator(".nowhere-list li");
  await expect(nowhere).toHaveCount(6);
  await expect(nowhere.filter({ hasText: "Madangi Van" })).toContainText("Best left fictional");
});
