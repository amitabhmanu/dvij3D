// Draw the story's people in the people lab (src/lib/story/lab.ts) from a list of views.
//   node pipeline/likeness/render.mjs <shots.json> [--port 4410]
// shots.json: [{ "who": "professor", "out": "C:/.../x.jpg", "yaw": 20, "pitch": 0, "fov": 22, "dist": 1.0, "w": 768, "h": 768, ... }]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "4410";
const shots = JSON.parse(readFileSync(args[0], "utf8"));
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] });
const page = await b.newPage({ viewport: { width: 800, height: 800 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`http://localhost:${port}/dev/lab/people`);
await page.waitForFunction(() => window.lab, null, { timeout: 120_000 });
let loaded = "";
for (const s of shots) {
  if (s.who !== loaded) {
    const ok = await page.evaluate((w) => window.lab.load(w), s.who);
    if (!ok) { console.log("no", s.who); continue; }
    loaded = s.who;
  }
  const url = await page.evaluate((s) => window.lab.shot(s, s.w ?? 768, s.h ?? 768), s);
  writeFileSync(s.out, Buffer.from(url.split(",")[1], "base64"));
}
console.log(shots.length, "shots");
await b.close();
