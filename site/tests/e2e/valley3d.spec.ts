import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// The valley in 3D (design §10.1). The flat map stays the default; three.js
// and the terrain load only when a reader opens the 3D view.
const terrain = JSON.parse(readFileSync(new URL("../../src/content/generated/terrain.json", import.meta.url), "utf8"));
const file = (name: string) => `/_assets/terrain/${name}`;

async function open3d(page: Page) {
  await page.goto("/valley/");
  await page.locator('.valley-3d[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.locator('.valley-3d[data-ready="true"]').waitFor({ timeout: 30_000 });
}

test("the heightmap, drape and poster are served within their budgets", async ({ page }) => {
  for (const [name, type, kb] of [
    [terrain.height.file, "image/png", 400],
    [terrain.drape, "image/webp", 500],
    [terrain.poster, "image/webp", 150],
  ] as const) {
    const res = await page.request.get(file(name));
    expect(res.status(), name).toBe(200);
    expect(res.headers()["content-type"]).toContain(type);
    expect((await res.body()).length, name).toBeLessThan(kb * 1024);
  }
});

test("the flat map loads without downloading the 3D code", async ({ page }) => {
  const bodies: string[] = [];
  const urls: string[] = [];
  page.on("response", async (res) => {
    urls.push(res.url());
    if ((res.headers()["content-type"] || "").includes("javascript")) bodies.push(await res.text().catch(() => ""));
  });
  await page.goto("/valley/");
  await page.locator('.valley-3d[data-hydrated="true"]').waitFor();
  await page.waitForLoadState("networkidle");
  expect(bodies.some((b) => b.includes("THREE.WebGLRenderer"))).toBe(false);
  expect(urls.filter((u) => u.includes("/_assets/terrain/"))).toEqual([]);
  await expect(page.locator(".mapfig")).toBeVisible();
});

test("opening the 3D view draws the valley", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await open3d(page);
  await expect(page.locator(".mapfig")).toBeHidden();
  await expect(page).toHaveURL(/#3d$/);
  const shot = await page.locator(".valley-3d canvas").screenshot();
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set<number>();
  for (let i = 0; i < data.length; i += info.channels) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  expect(colours.size).toBeGreaterThan(200); // the painted valley, not a blank canvas
  expect(errors).toEqual([]);
});

test("every labelled place has a label in 3D", async ({ page }) => {
  await open3d(page);
  await expect(page.locator(".v3d-label")).toHaveCount(8);
  await expect(page.locator('.v3d-label[data-place="mount-dronagiri"]')).toHaveText("Mount Dronagiri");
});

test("choosing a place flies there and names it", async ({ page }) => {
  await open3d(page);
  await page.locator('.v3d-label[data-place="sheetal-lake"]').click();
  await expect(page.locator(".valley-3d")).toHaveAttribute("data-flying", "true");
  await expect(page.locator(".valley-3d")).not.toHaveAttribute("data-flying", "true", { timeout: 10_000 });
  await expect(page.locator(".v3d-caption")).toContainText("Sheetal Lake");
  await expect(page.locator(".v3d-caption a")).toHaveAttribute("href", "#sheetal-lake");
});

test("the keyboard alone reaches every place", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard navigation is a desktop feature");
  await open3d(page);
  await page.locator(".valley-3d .land").focus();
  await page.keyboard.press("ArrowLeft"); // orbiting from the keyboard keeps the view drawn
  await expect(page.locator(".valley-3d")).toHaveAttribute("data-ready", "true");
  const reached = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.place);
    if (id) reached.add(id);
  }
  expect(reached.size).toBe(8);
  await page.keyboard.press("Enter");
  await expect(page.locator(".v3d-caption")).toBeVisible();
});

test("a browser without WebGL keeps the flat map", async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === "webgl2" ? null : (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof real;
  });
  await page.goto("/valley/");
  await page.locator('.valley-3d[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".v3d-note")).toContainText("can't draw the valley in 3D");
  await expect(page.locator(".mapfig")).toBeVisible();
  await expect(page.locator(".valley-3d canvas")).toHaveCount(0);
});

test("reduced motion turns the flight into a cut", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open3d(page);
  let flew = false;
  await page.exposeFunction("sawFlight", () => { flew = true; });
  await page.evaluate(() => new MutationObserver(() => {
    if (document.querySelector(".valley-3d")?.hasAttribute("data-flying")) (window as unknown as { sawFlight: () => void }).sawFlight();
  }).observe(document.querySelector(".valley-3d")!, { attributes: true }));
  await page.locator('.v3d-label[data-place="fort-ruins"]').click();
  await expect(page.locator(".v3d-caption")).toContainText("Fort Ruins");
  await page.waitForTimeout(500);
  expect(flew).toBe(false);
});

test("#3d opens the 3D view directly", async ({ page }) => {
  await page.goto("/valley/#3d");
  await page.locator('.valley-3d[data-ready="true"]').waitFor({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".mapfig")).toBeVisible();
  await expect(page).not.toHaveURL(/#3d$/);
});

test("on a phone the labels stay inside the view and the page doesn't scroll sideways", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await open3d(page);
  const stage = (await page.locator(".valley-3d .stage").boundingBox())!;
  for (const label of await page.locator(".v3d-label").all()) {
    const b = (await label.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(stage.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the 3D view veils exactly what the flat map veils", async ({ page }) => {
  await page.goto("/read/b1/12");
  await page.locator('.reader[data-hydrated="true"]').waitFor();
  await page.waitForFunction(() => !!localStorage.getItem("twice-born:v1"));
  await open3d(page);
  // the map draws the fort's name, so its label names it too...
  const fort = page.locator('.v3d-label[data-place="fort-ruins"]');
  await expect(fort).toHaveText("Fort Ruins");
  await fort.click();
  // ...and what the book says about it stays veiled in its card (searched on b1 p29)
  await page.locator(".v3d-caption").getByRole("link", { name: "Read about it" }).click();
  await expect(page.locator("#fort-ruins")).toHaveAttribute("data-veiled", "");
});

test("the Real India toggle renames the 3D labels", async ({ page }) => {
  await open3d(page);
  const fort = page.locator('.v3d-label[data-place="fort-ruins"]');
  await expect(fort).toHaveText("Fort Ruins");
  await page.getByRole("button", { name: "Real India" }).click();
  await expect(fort).toHaveText("Daulatabad Fort");
  await fort.click();
  await expect(page.locator(".v3d-caption")).toContainText("is most like Daulatabad Fort");
  await page.getByRole("button", { name: "Real India" }).click();
  await expect(fort).toHaveText("Fort Ruins");
});

test("choosing a place in 3D brings its card into view", async ({ page }) => {
  await open3d(page);
  await page.locator('.v3d-label[data-place="mount-dronagiri"]').click();
  await page.locator(".v3d-caption").getByRole("link", { name: "Read about it" }).click();
  await expect(page).toHaveURL(/#mount-dronagiri$/);
  await expect(page.locator("#mount-dronagiri")).toBeInViewport();
});

// Budgets (design §10.1). The flat map's first load was 1,237 KB before the 3D
// view existed (measured on desktop, 19 Oct 2026); it may grow by 5% at most.
const BASELINE_KB = 1237;

test("the flat map's first load stays within 5% of what it was", async ({ page, isMobile }) => {
  test.skip(isMobile, "the baseline was measured on desktop");
  let bytes = 0;
  page.on("response", async (res) => { bytes += (await res.body().catch(() => Buffer.alloc(0))).length; });
  await page.goto("/valley/");
  await page.locator('.valley-3d[data-hydrated="true"]').waitFor();
  await page.waitForLoadState("networkidle");
  expect(bytes / 1024).toBeLessThan(BASELINE_KB * 1.05);
});

test("the 3D code stays within 200 KB gzipped", async ({ page }) => {
  const chunks: Buffer[] = [];
  page.on("response", async (res) => {
    if ((res.headers()["content-type"] || "").includes("javascript")) {
      const body = await res.body().catch(() => Buffer.alloc(0));
      if (body.includes("THREE.WebGLRenderer")) chunks.push(body);
    }
  });
  await open3d(page);
  expect(chunks).toHaveLength(1);
  expect(gzipSync(chunks[0]).length / 1024).toBeLessThan(200);
});
