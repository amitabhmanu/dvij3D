// Regression check for the pick-up (lifelike pilot, step 0): at the moment the Professor takes Varahi and the manuscript,
// his palm must be on them (within 7 cm of their middle: Varahi is 17 cm tall, the leaves 11 cm wide), and he takes each once.
//   node scripts/lifelike/check-grab.mjs [--port 4410]     exits 1 on failure
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const args = process.argv.slice(2);
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "4410";
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu"] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`http://localhost:${port}/valley/walk/?test&watch`);
await page.getByRole("button", { name: /Watch it play/ }).click();
await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 180000 });
await page.locator(".begin").click();
await page.waitForFunction(() => window.walkStory?.director);
const r = await page.evaluate(async () => {
  const st = window.walkStory.stage, d = window.walkStory.director;
  d.stop();
  await st.setUp(d.scene("b1-ch03"));
  await st.castReady;
  const a = st.cast.get("professor");
  const V = a.obj.position.constructor;
  const grabs = [];
  const hold = a.hold.bind(a);
  a.hold = (obj) => {
    if (obj) {
      obj.updateMatrixWorld(true);
      // the middle of what is taken, from its geometry's bounds in the world
      let lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity);
      obj.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const p = new V(x, y, z).applyMatrix4(o.matrixWorld); lo.min(p); hi.max(p); } } });
      const mid = lo.add(hi).multiplyScalar(0.5);
      // (taken in the middle of working out the frame's pose: the palm is measured once the frame's reach is laid on)
      const g = { name: obj.name || obj.type, dist: null };
      grabs.push(g);
      requestAnimationFrame(() => requestAnimationFrame(() => { const palm = a.palm(); g.dist = palm ? +palm.distanceTo(mid).toFixed(3) : null; }));
    }
    return hold(obj);
  };
  await st.cast.beat({ who: "professor", take: "varahi" }, false);
  await st.cast.beat({ who: "professor", take: "manuscript" }, false);
  await new Promise((r) => setTimeout(r, 300));
  return grabs;
});
await b.close();
console.log(JSON.stringify(r));
const bad = r.length !== 2 || r.some((g) => g.dist == null || g.dist > 0.07);
console.log(bad ? "FAIL: the hand is not on what it takes (or took it more than once)" : "ok: one clean grab each, the palm on the thing");
process.exit(bad ? 1 : 0);
