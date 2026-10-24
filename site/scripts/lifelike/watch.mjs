// Watch a story chapter play itself and keep frames of it (the lifelike pilot's movement audit).
//   node scripts/lifelike/watch.mjs <scene> <out dir> [--every 0.5] [--for 120] [--rate 1] [--port 4410] [--from beat]
//          [--quality high] [--size 960x540] [--log who,who]
// Writes <out>/NNNN.jpg (what Dvij sees) and <out>/log.jsonl (time, beat, each named actor's place, scale, pose).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [scene, out] = args;
const every = Number(opt("every", 0.5)), total = Number(opt("for", 120)), rate = Number(opt("rate", 1));
const port = opt("port", "4410"), from = opt("from", null), quality = opt("quality", "high");
const [W, H] = opt("size", "960x540").split("x").map(Number);
const logWho = (opt("log", "") || "").split(",").filter(Boolean);
// --observe who:side,up,back : also a shot from outside, beside that person (metres: to their right, up, behind), looking at them
const observe = opt("observe", null);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/log.jsonl`, "");

const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("console", m.text().slice(0, 200)); });
await page.addInitScript((q) => localStorage.setItem("twice-born:walk:v1", JSON.stringify({ quality: q, volume: 0 })), quality);
await page.goto(`http://localhost:${port}/valley/walk/?test&watch`);
await page.getByRole("button", { name: /Watch it play/ }).click();
await page.locator('.walk[data-screen="ready"]').waitFor({ timeout: 180_000 });
await page.locator(".begin").click();
await page.waitForFunction(() => window.walkStory?.director, null, { timeout: 60_000 });
await page.evaluate(async ([scene, from, rate]) => {
  const d = window.walkStory.director;
  d.stop();
  await new Promise((r) => setTimeout(r, 300));
  void d.play(scene, from ?? undefined);
  if (rate !== 1) document.querySelector(`.film button[title]`); // (the rate is set below through the bar's keys if wanted)
}, [scene, from, rate]);
if (rate > 1) for (let i = 0; i < Math.log2(rate); i++) await page.keyboard.press("]").catch(() => {});
const t0 = Date.now();
let n = 0;
while ((Date.now() - t0) / 1000 < total) {
  const at = Date.now();
  const info = await page.evaluate((who) => {
    const st = window.walkStory.stage, d = window.walkStory.director;
    const people = {};
    for (const w of who) {
      const a = st.cast?.get(w);
      if (!a) continue;
      const p = a.obj.getWorldPosition(new a.obj.position.constructor());
      const s = a.obj.getWorldScale(new a.obj.position.constructor());
      const hb = []; a.obj.traverse((o) => { if (o.isBone && /^(head|pelvis|spine_03)$/.test(o.name)) hb.push(+o.getWorldScale(new a.obj.position.constructor()).y.toFixed(4)); });
      let box = null; a.obj.traverse((o) => { if (o.isSkinnedMesh && !box) { o.computeBoundingBox?.(); } });
      // where the head points against where Dvij's eyes are (degrees off), and the left eye's own turn against the head (degrees)
      const V = a.obj.position.constructor, head = a.bones?.head, eyeL = a.bones?.eye_l;
      let off = null, eye = null;
      if (head) {
        const Q = head.getWorldQuaternion(new head.quaternion.constructor());
        const bind = head.userData.lookBindInv;
        const fwd = new V(0, 0, 1).applyQuaternion(bind ? Q.clone().multiply(bind) : Q);
        const me = window.walkGame.player(), to = new V(me.x, me.y, me.z).sub(head.getWorldPosition(new V())).normalize();
        off = +(Math.acos(Math.max(-1, Math.min(1, fwd.dot(to)))) * 57.3).toFixed(2);
        if (eyeL) { const E = eyeL.getWorldQuaternion(new head.quaternion.constructor()); eye = +(E.angleTo(Q) * 57.3).toFixed(2); }
      }
      people[w] = { off, eye, bones: hb, at: [p.x, p.y, p.z].map((v) => +v.toFixed(3)), scale: +s.y.toFixed(4), local: +a.obj.scale.y.toFixed(4), visible: a.visible };
    }
    const me = window.walkGame.player();
    return { me: [me.x, me.y, me.z].map((v) => +v.toFixed(2)), beat: d.current?.beat ?? null, scene: d.current?.scene ?? null, people, sub: document.querySelector(".subtitle, .sub")?.textContent?.slice(0, 80) ?? null };
  }, logWho).catch((e) => ({ error: String(e) }));
  const name = String(n).padStart(4, "0");
  if (observe) {
    const ok = await page.evaluate(async (spec) => {
      const [whoAt, rest] = spec.split(":");
      const who = whoAt.split("@")[0];
      const [side, up, back] = (rest ?? "1.6,0.4,1.2").split(",").map(Number);
      const T = window.__three ??= await import("/node_modules/.vite/deps/three.js");
      const g = window.walkGame, a = window.walkStory.stage.cast?.get(who);
      if (!a) return false;
      const spec_ = spec;
      const { renderer, scene } = g.internals();
      const cam = window.__obsCam ??= new T.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
      const c = a.point(0, 1.0, 0), f = a.facing(), r = new T.Vector3(-f.z, 0, f.x);
      if (/@-?[0-9]/.test(whoAt)) { // a fixed place in the scene's frame
        const w = window.walkStory.stage.world(whoAt.split("@")[1].split(";").map(Number));
        cam.position.set(w[0], w[1], w[2]);
      } else if (who.endsWith("@eyes") || spec.includes("@eyes")) {
        // from behind Dvij's head, off to one side: what he sees, wider, with him out of the way
        const p = g.player(), e = new T.Vector3(p.x, p.y, p.z), away = e.clone().sub(c).setY(0).normalize();
        cam.position.copy(e).addScaledVector(away, back).addScaledVector(new T.Vector3(-away.z, 0, away.x), side).add(new T.Vector3(0, up, 0));
      } else cam.position.copy(c).addScaledVector(r, side).addScaledVector(f, -back).add(new T.Vector3(0, up, 0));
      cam.lookAt(c);
      g.pause();
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      return true;
    }, observe).catch((e) => String(e));
    if (ok !== true) console.log("observe:", ok);
    await page.locator("canvas").first().screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 80 });
    await page.evaluate(() => window.walkGame.start());
  } else await page.screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 80 });
  appendFileSync(`${out}/log.jsonl`, JSON.stringify({ n, t: +((at - t0) / 1000).toFixed(2), ...info }) + "\n");
  if (n % 10 === 0) console.log(name, info.beat, JSON.stringify(info.me), JSON.stringify(info.people));
  if (info.scene && info.scene !== scene) break;
  n++;
  const wait = every * 1000 - (Date.now() - at);
  if (wait > 0) await page.waitForTimeout(wait);
}
await b.close();
