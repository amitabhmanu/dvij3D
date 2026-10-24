// Frame time with and without the people, in the lifelike pilot's scenes (as .downloads/graphics-people/fps.txt did it).
//   node scripts/lifelike/fps.mjs [--port 4410] [--quality high] [--plain]
// --plain: the cast without the pilot's layers (CastEnv.lifelike false), to compare.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const port = opt("port", "4410"), quality = opt("quality", "high");
// [name, scene, where Dvij stands (frame), what he looks at (frame), a beat first]
const spots = [
  ["ch3 study (lodge)", "b1-ch03", [-12.8, -11.0], [-14.0, 1.4, -12.4], null],
  ["ch4 well", "b1-ch04", [-18, 34.8], [-18, 1.0, 39], null],
  ["ch7 lawn", "b1-ch07", [10.5, 29.6], [9.5, 1.0, 32.6], null],
  ["ch8 room (lodge)", "b1-ch08", [-14.4, 7.4], [-14.0, 1.2, 3.0], null],
];
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.addInitScript((q) => localStorage.setItem("twice-born:walk:v1", JSON.stringify({ quality: q, volume: 0 })), quality);
await page.goto(`http://localhost:${port}/valley/walk/?test&story${args.includes("--plain") ? "&plain" : ""}`);
await page.getByRole("button", { name: "Play the story" }).click();
await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 180_000 });
await page.locator(".begin").click();
await page.waitForFunction(() => window.walkStory?.director);
await page.evaluate(() => window.walkStory.director.stop());
for (const [name, scene, at, look] of spots) {
  const r = await page.evaluate(async ([scene, at, look]) => {
    const st = window.walkStory.stage, d = window.walkStory.director, g = window.walkGame;
    await st.setUp(d.scene(scene));
    await st.castReady;
    const w = st.world([at[0], 0, at[1]]);
    await g.body.pose({ pose: "stand", at: [w[0], w[2]], look: st.world(look) });
    g.body.hold("none");
    const p = g.player();
    const gl = document.querySelector("canvas").getContext("webgl2"), px = new Uint8Array(4);
    const run = (n) => { for (let i = 0; i < n; i++) { st.cast.update(1 / 60); g.teleport(p.x, p.z, p.heading); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const time = () => { run(20); const best = []; for (let k = 0; k < 3; k++) { const t = performance.now(); run(90); best.push((performance.now() - t) / 90); } return Math.min(...best); };
    const withCast = time();
    st.cast.group.visible = false;
    const without = time();
    st.cast.group.visible = true;
    return [withCast, without];
  }, [scene, at, look]);
  console.log(quality.padEnd(7), name.padEnd(20), `${r[0].toFixed(1)} ms (${(1000 / r[0]).toFixed(0)} fps) with the people, ${r[1].toFixed(1)} ms without, people ${(r[0] - r[1]).toFixed(1)} ms`);
}
await b.close();
