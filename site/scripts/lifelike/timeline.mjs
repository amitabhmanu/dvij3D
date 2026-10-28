// The story's timeline (the film bar's slider): play chapters in watch mode at 1x, headless, and note when each beat
// begins and when the chapter ends. Writes src/content/generated/story-timeline.json (merged with what's there).
//   node scripts/lifelike/timeline.mjs [--port 4410] b1-ch01 b1-ch03 ...
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "4410";
const scenes = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
const OUT = new URL("../../src/content/generated/story-timeline.json", import.meta.url);

const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
const found = {};
for (const scene of scenes) {
  const page = await b.newPage({ viewport: { width: 480, height: 270 } });
  page.on("pageerror", (e) => console.log(scene, "pageerror", e.message));
  await page.addInitScript(() => localStorage.setItem("twice-born:walk:v1", JSON.stringify({ quality: "low", volume: 0 })));
  await page.goto(`http://localhost:${port}/valley/walk/?test&watch`, { timeout: 180_000 });
  await page.getByRole("button", { name: /Watch it play/ }).click();
  await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 180_000 });
  await page.locator(".begin").click();
  await page.waitForFunction(() => window.walkStory?.director, null, { timeout: 60_000 });
  const r = await page.evaluate(async (scene) => {
    const d = window.walkStory.director, st = window.walkStory.stage;
    d.stop();
    await new Promise((res) => setTimeout(res, 300));
    let done = false;
    const fin = st.finished.bind(st);
    st.finished = (...a) => { done = true; st.finished = fin; return fin(...a); };
    void d.play(scene);
    const t0 = performance.now(), beats = [];
    while (!done && performance.now() - t0 < 900_000) {
      const c = d.current;
      if (c && c.scene === scene && beats[beats.length - 1]?.id !== c.beat) beats.push({ id: c.beat, at: +((performance.now() - t0) / 1000).toFixed(1) });
      if (c && c.scene !== scene && beats.length) break; // (on to the next chapter: before it began, the old one is still "current")
      await new Promise((res) => setTimeout(res, 100));
    }
    // (from the first beat on: the scene's setting up, its loading, isn't the film's time; the bar's clock starts there too)
    const start = beats[0]?.at ?? 0;
    return { beats: beats.map((x) => ({ id: x.id, at: +(x.at - start).toFixed(1) })), total: +((performance.now() - t0) / 1000 - start).toFixed(1) };
  }, scene);
  found[scene] = r;
  console.log(scene, `${r.total} s`, r.beats.map((x) => `${x.id}@${x.at}`).join(" "));
  await page.close();
}
await b.close();
const all = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
writeFileSync(OUT, JSON.stringify({ ...all, ...found }, null, 1) + "\n");
