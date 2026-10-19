import { expect, test } from "@playwright/test";

test("the PDF asks you to read online first, and unlocks once you have", async ({ page }) => {
  await page.goto("/read/b1/");
  await expect(page.getByRole("link", { name: "Read it online first" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download PDF/ })).toBeHidden();
  await expect(page.locator(".why")).toContainText("3 pages");

  // read the first pages, and the download is there
  for (const n of [1, 2, 3]) {
    await page.goto(`/read/b1/${n}`);
    await page.locator('.reader[data-hydrated="true"]').waitFor();
  }
  await page.goto("/read/b1/");
  await expect(page.getByRole("link", { name: /Download PDF/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read it online first" })).toBeHidden();
});

test("the link is in the HTML, so no-JS readers and crawlers still have it", async ({ page }) => {
  // the gate is progressive enhancement: the served markup carries the real href
  const res = await page.request.get("/read/b3/");
  expect(await res.text()).toMatch(/href="[^"]*the-twice-born-b3\.pdf"\s+download/);
});

test("B1 p1 is the map alone, with the source's black half cropped away", async ({ page }) => {
  await page.goto("/read/b1/1");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  const img = page.locator(".reader img").first();
  // 2115x1680: the page cut at the map image's own bottom edge, not 2115x3375
  await expect(img).toHaveAttribute("width", "2115");
  await expect(img).toHaveAttribute("height", "1680");
  // and the file served really is that shape, whichever variant the viewport picked.
  // Wait for it to arrive: before it loads both sizes are 0 and the ratio is NaN,
  // which is also what a file missing from the bucket looks like.
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    { message: "B1 p1 never loaded - is it in the bucket?" }).toBe(true);
  const ratio = await img.evaluate((el: HTMLImageElement) => el.naturalHeight / el.naturalWidth);
  expect(ratio).toBeLessThan(0.85); // landscape; the uncropped page was 1.6
});
