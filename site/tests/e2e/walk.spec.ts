import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

// Walking the valley (design §10.2): /valley/walk/.
const walk = JSON.parse(readFileSync(new URL("../../src/content/generated/walk.json", import.meta.url), "utf8"));
type P = { x: number; z: number; y: number; heading: number };
type W = { walkGame: { teleport: (x: number, z: number, h?: number) => void; player: () => P } };

async function enter(page: Page, query = "?test") {
  await page.goto(`/valley/walk/${query}`);
  await page.getByRole("button", { name: "Enter the valley" }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 60_000 });
  await page.locator(".begin").click();
  await expect(page.locator(".walk")).toHaveAttribute("data-screen", "playing");
}

const at = (page: Page) => page.evaluate(() => (window as unknown as W).walkGame.player());
const teleport = (page: Page, x: number, z: number, h: number) =>
  page.evaluate(([x, z, h]) => (window as unknown as W).walkGame.teleport(x, z, h), [x, z, h]);

async function hold(page: Page, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

function inPolygon(poly: [number, number][], x: number, z: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

test("the walk page loads only its start screen", async ({ page }) => {
  const bodies: string[] = [];
  const urls: string[] = [];
  page.on("response", async (res) => {
    urls.push(res.url());
    if ((res.headers()["content-type"] || "").includes("javascript")) bodies.push(await res.text().catch(() => ""));
  });
  await page.goto("/valley/walk/");
  await expect(page.getByRole("heading", { name: "Walk the valley" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(bodies.some((b) => b.includes("THREE.WebGLRenderer"))).toBe(false);
  expect(urls.filter((u) => u.includes("/_assets/walk/"))).toEqual([]);
  const js = bodies.reduce((n, b) => n + gzipSync(b).length, 0);
  expect(js / 1024).toBeLessThan(60);
  await expect(page.locator(".site-header")).toHaveCount(0); // a game page: no site menu
});

test("entering the valley puts you at the Access Road", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await enter(page);
  const p = await at(page);
  expect(p.x).toBeCloseTo(walk.spawn.x, 0);
  expect(p.z).toBeCloseTo(walk.spawn.z, 0);
  expect(p.y).toBeGreaterThan(0); // standing on the ground, not under it
  expect(errors).toEqual([]);
});

test("W walks at a walking pace and Shift runs", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard play is a desktop feature");
  await enter(page);
  await teleport(page, -1200, 1800, 0); // open ground south of the fort
  const a = await at(page);
  await hold(page, ["KeyW"], 1000);
  const b = await at(page);
  const walked = Math.hypot(b.x - a.x, b.z - a.z);
  expect(walked).toBeGreaterThan(3);
  expect(walked).toBeLessThan(7.5);
  expect(b.z).toBeLessThan(a.z); // heading 0 is north, which is -z
  await hold(page, ["ShiftLeft", "KeyW"], 1000);
  const c = await at(page);
  expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeGreaterThan(walked * 1.8);
});

test("you can't walk into Sheetal Lake", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard play is a desktop feature");
  await enter(page);
  const shore = walk.water[0].points as [number, number][];
  const west = shore.reduce((m, p) => (p[0] < m[0] ? p : m));
  await teleport(page, west[0] - 40, west[1], Math.PI / 2); // 40 m west of the shore, facing east
  await hold(page, ["ShiftLeft", "KeyW"], 6000);
  const p = await at(page);
  expect(inPolygon(shore, p.x, p.z)).toBe(false);
  expect(p.x).toBeGreaterThan(west[0] - 30); // it did walk up toward the shore
});

test("Esc pauses, and Keep walking carries on", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones pause with the button");
  await enter(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".walk")).toHaveAttribute("data-screen", "paused");
  await expect(page.getByRole("link", { name: "Leave the valley" })).toHaveAttribute("href", "/valley/");
  await page.getByRole("button", { name: "Keep walking" }).click();
  await expect(page.locator(".walk")).toHaveAttribute("data-screen", "playing");
});

test("on a phone the joystick walks and the button pauses", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await enter(page);
  await teleport(page, -1200, 1800, 0);
  const a = await at(page);
  const stick = (await page.locator(".stick").boundingBox())!;
  const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
  const ev = { pointerId: 7, isPrimary: true };
  await page.locator(".stick").dispatchEvent("pointerdown", { ...ev, clientX: cx, clientY: cy });
  await page.locator(".stick").dispatchEvent("pointermove", { ...ev, clientX: cx, clientY: cy - 40 });
  await page.waitForTimeout(800);
  await page.locator(".stick").dispatchEvent("pointerup", { ...ev, clientX: cx, clientY: cy - 40 });
  const b = await at(page);
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1.5);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".walk")).toHaveAttribute("data-screen", "paused");
});

test("a browser without WebGL is told so and pointed back to the map", async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === "webgl2" ? null : (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof real;
  });
  await page.goto("/valley/walk/");
  await page.getByRole("button", { name: "Enter the valley" }).click();
  await expect(page.getByRole("alert")).toContainText("can't draw the valley in 3D");
  await expect(page.getByRole("link", { name: "Back to the map" })).toHaveAttribute("href", "/valley/");
});

test("the valley page leads into the walk", async ({ page }) => {
  await page.goto("/valley/");
  await page.locator('.valley-3d[data-hydrated="true"]').waitFor();
  await page.getByRole("link", { name: /Enter the valley/ }).click();
  await expect(page).toHaveURL(/\/valley\/walk\/$/);
});

test("the walk's code and data stay within budget", async ({ page }) => {
  const chunks: Buffer[] = [];
  page.on("response", async (res) => {
    if ((res.headers()["content-type"] || "").includes("javascript")) {
      const body = await res.body().catch(() => Buffer.alloc(0));
      if (body.includes("THREE.WebGLRenderer")) chunks.push(body);
    }
  });
  await enter(page, "");
  expect(chunks).toHaveLength(1);
  expect(gzipSync(chunks[0]).length / 1024).toBeLessThan(450);
  for (const [name, kb] of [[walk.height.file, 1200], [walk.world, 400]] as const) {
    const res = await page.request.get(`/_assets/walk/${name}`);
    expect(res.status()).toBe(200);
    expect((await res.body()).length / 1024, name).toBeLessThan(kb);
  }
});
