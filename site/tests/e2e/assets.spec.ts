import { expect, test } from "@playwright/test";
import { unloadedImages } from "./images";

// Every page here leads with images served from the R2 bucket. A file that is
// committed but never uploaded only shows up as a broken image in the browser:
// that is how B1 p1 (the home page's hero) and all 25 Real India photographs
// reached main while every other test passed. `npm run verify-assets` catches
// it before a push; this catches it in the pages people actually open.
const PAGES = ["/", "/read/", "/read/b1/1", "/codex/", "/bestiary/", "/voices/", "/valley/"];

for (const path of PAGES) {
  test(`every image on ${path} loads`, async ({ page }) => {
    await page.goto(path);
    await expect.poll(() => unloadedImages(page), { timeout: 30_000 }).toEqual([]);
  });
}
