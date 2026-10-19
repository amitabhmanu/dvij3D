import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;
const status = (page: Page) => page.locator(".reader [aria-live]");

/** Open a reader URL and wait until the island has hydrated (controls live). */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.locator('.reader[data-hydrated="true"]').waitFor();
}

/** How far the art runs under the Text sidebar, in px; 0 when it sits clear. */
function artUnderText(page: Page) {
  return page.evaluate(() => {
    const text = document.querySelector(".reader .transcript")!.getBoundingClientRect();
    const art = [...document.querySelectorAll(".reader .page-frame, .reader .panel-focus")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0);
    return Math.max(0, ...art.map((r) => Math.round(r.right - text.left)));
  });
}

test("deep link opens the requested page", async ({ page }) => {
  await open(page, "/read/b1/7");
  await expect(page.locator(".reader .pages img").first()).toHaveAttribute("src", /b1-p00[67]-/);
  await expect(status(page)).toContainText(/Pages? .*7/);
});

test("arrow keys turn pages and update the URL", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard navigation is a desktop feature");
  await open(page, "/read/b1/2");
  await page.locator(".reader .stage").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/read\/b1\/4$/); // spread 2-3 -> 4-5
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/read\/b1\/2$/);
});

test("wide screens show two-page spreads", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only");
  await open(page, "/read/b1/4");
  await expect(page.locator(".reader .pages img")).toHaveCount(2);
  await expect(status(page)).toContainText("Pages 4–5");
});

test("phones show single pages and panel mode steps through panels", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await open(page, "/read/b1/4");
  await expect(page.locator(".reader .pages img")).toHaveCount(1);
  await page.getByRole("button", { name: "Panels" }).click();
  await expect(page).toHaveURL(/#p1$/);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/#p2$/);
  await expect(status(page)).toContainText("panel 2 of");
});

test("the Text sidebar sits beside the art, not over it", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only");
  // 1280 is where it was worst: the sidebar hid 47% of a spread's right-hand page
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/read/b2/6");
  await expect(page.locator(".reader .pages img")).toHaveCount(2);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect.poll(() => artUnderText(page)).toBe(0);
  // panel mode sizes itself from the stage too, so it moves over as well
  await page.getByRole("button", { name: "Panels", exact: true }).click();
  await expect.poll(() => artUnderText(page)).toBe(0);
  // and closing the text gives the art its width back
  await page.getByRole("button", { name: "Spread", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.locator(".reader .stage")).toHaveCSS("padding-right", "0px");
});

test("on a phone, Text stays an overlay with no gutter", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await open(page, "/read/b3/10");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.locator(".reader .transcript")).toBeVisible();
  await expect(page.locator(".reader .stage")).toHaveCSS("padding-right", "0px");
});

test("zoom steps in and out by button and key, and a page turn resets it", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones pinch instead; the zoom buttons are hidden there");
  await open(page, "/read/b2/6");
  const level = page.locator(".reader .zoom .level");
  await expect(level).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(level).toHaveText("125%");
  await page.keyboard.press("=");
  await expect(level).toHaveText("156%");
  await page.keyboard.press("-");
  await expect(level).toHaveText("125%");
  await page.keyboard.press("0");
  await expect(level).toHaveText("100%");
  await expect(page.locator(".reader .zoom-layer")).not.toHaveClass(/zoomed/);
  for (let i = 0; i < 12; i++) await page.keyboard.press("=");
  await expect(level).toHaveText("600%"); // capped
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/read\/b2\/8$/);
  await expect(level).toHaveText("100%");
});

test("zoomed in, a drag pans and a click doesn't turn the page", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse panning is a desktop feature");
  await open(page, "/read/b2/6");
  await page.getByRole("button", { name: "Notes", exact: true }).click(); // keep clicks off hotspots
  const box = (await page.locator(".reader .stage").boundingBox())!;
  const rightThird = { x: box.x + box.width * 0.85, y: box.y + box.height / 2 };
  // at fit, a click in the right third turns the page
  await page.mouse.click(rightThird.x, rightThird.y);
  await expect(page).toHaveURL(/\/read\/b2\/8$/);
  await page.keyboard.press("="); // the bars hide on a page turn, so zoom by key
  await expect(page.locator(".reader .zoom .level")).toHaveText("125%");
  const layer = page.locator(".reader .zoom-layer");
  // a drag pans instead of swiping to the next page
  const before = await layer.getAttribute("style");
  await page.mouse.move(rightThird.x, rightThird.y);
  await page.mouse.down();
  await page.mouse.move(rightThird.x - 160, rightThird.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/read\/b2\/8$/);
  expect(await layer.getAttribute("style")).not.toBe(before);
  // and a click where the page would turn leaves both the page and the zoom alone
  await page.mouse.click(rightThird.x, rightThird.y);
  await expect(page).toHaveURL(/\/read\/b2\/8$/);
  await expect(page.locator(".reader .zoom .level")).toHaveText("125%");
});

test("the bottom bar keeps its controls clear of the host's badge", async ({ page }) => {
  await open(page, "/read/b2/6");
  // A stand-in for the badge Netlify injects into every production page: same
  // id, same corner, the size it measured on the live site. Like the real one
  // it arrives after the reader has loaded.
  await page.evaluate(() => {
    const f = document.createElement("iframe");
    f.id = "nl-badge-frame";
    f.style.cssText = "position:fixed;right:0;bottom:0;width:197px;height:64px;border:0;z-index:2147483645";
    document.body.appendChild(f);
  });
  const bar = page.locator(".reader .chrome.bottom");
  await expect(bar).toHaveCSS("padding-right", "213px"); // the usual 16px, plus the badge
  const covered = await page.locator(".reader .chrome.bottom .nav, .reader .chrome.bottom .zoom button")
    .evaluateAll((els) => els
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id === "nl-badge-frame";
      })
      .map((el) => el.getAttribute("aria-label")));
  expect(covered).toEqual([]);
  // Next really takes the click: Playwright refuses one an overlay would intercept
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).not.toHaveURL(/\/read\/b2\/6$/);
  // after Close the badge collapses, and the room shrinks with it
  await page.evaluate(() => { document.getElementById("nl-badge-frame")!.style.width = "60px"; });
  await expect(bar).toHaveCSS("padding-right", "76px");
  // and with no badge the bar is exactly as it was
  await page.evaluate(() => document.getElementById("nl-badge-frame")!.remove());
  await expect(bar).toHaveCSS("padding-right", "16px");
});

test("panel mode frames the panel's balloons, not just the panel", async ({ page }) => {
  // b1 p23 panel 6: four of its balloons cross the panel border
  await open(page, "/read/b1/23#p6");
  const cut = await page.evaluate(async () => {
    const res = await fetch("/data/b1.json");
    const book = await res.json();
    const p = (book.pages ?? book).find((x: { n: number }) => x.n === 23);
    const focus = document.querySelector(".reader .panel-focus")!.getBoundingClientRect();
    const world = document.querySelector(".reader .panel-world")!.getBoundingClientRect();
    // balloons assigned to panel 6, in screen space, that fall outside the framed view
    return (p.text as { panel: number; bbox: number[] }[])
      .filter((u) => u.panel === 5)
      .filter(({ bbox: [a, b, c, d] }) =>
        world.left + a * world.width < focus.left - 1 || world.top + b * world.height < focus.top - 1 ||
        world.left + c * world.width > focus.right + 1 || world.top + d * world.height > focus.bottom + 1)
      .length;
  });
  expect(cut).toBe(0);
});

test("panel deep link opens panel mode", async ({ page }) => {
  await open(page, "/read/b1/4#p3");
  await expect(status(page)).toContainText("panel 3 of");
});

test("reading progress survives a reload", async ({ page }) => {
  await open(page, "/read/b1/9");
  await expect(status(page)).toContainText("9");
  await page.goto("/read/");
  await expect(page.locator('.book-card[data-book="b1"] .actions .btn')).toHaveText("Continue");
  await page.goto("/");
  await expect(page.locator("#start")).toHaveText("Continue reading");
});

test("chapter links land on the chapter's first page", async ({ page }) => {
  await page.goto("/read/b1/ch/1");
  await expect(page).toHaveURL(/\/read\/b1\/4/);
});

test("search finds dialogue", async ({ page }) => {
  await page.goto("/search/");
  await page.locator("#search input").fill("driving too long");
  await expect(page.locator(".pagefind-ui__result-link").first()).toHaveAttribute("href", /\/read\/b1\/2\/?$/);
});

test("end of a book offers the next one", async ({ page }) => {
  await open(page, "/read/b1/42");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("link", { name: /Continue to Book 2/ })).toBeVisible();
});
