// Uploads the 3D valley's files (site-assets/walk, terrain and story: the lodge, the people, their
// textures, the terrain, the voices) to the Cloudflare R2 bucket the site reads them from in
// production, PUBLIC_3D_BASE (design §14.3). The page images, art and PDFs go to their own bucket
// (upload_assets.mjs).
//
// It uses wrangler and its login (`npx wrangler login` once), so no keys are needed here. Before
// sending a file it asks the bucket's public URL whether it is already there at the same size, so a
// re-run sends only what is new or changed. Every name but the credits notes carries a content hash,
// so they are cached for a year; a rebuilt model gets a new name rather than changing an old one.
//
// The bucket needs public access (its r2.dev URL or a custom domain) and a CORS rule letting the
// site's pages GET from it: WebGL may load a model or texture from another origin only if that origin
// allows it. Set once with `npx wrangler r2 bucket cors set dvij3d-assets --file <rules.json>`.
//
//   node pipeline/upload_3d.mjs [--dry-run] [--force] [--only walk,terrain,story]
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = fileURLToPath(new URL("../../site-assets/", import.meta.url));
const BUCKET = process.env.R2_3D_BUCKET ?? "dvij3d-assets";
const BASE = (process.env.PUBLIC_3D_BASE ?? "https://pub-88564d59e14b4252ba9c491fa8a8558f.r2.dev").replace(/\/$/, "");
const FOLDERS = ["walk", "terrain", "story"];
const FOREVER = "public, max-age=31536000, immutable";
const TYPES = {
  ".glb": "model/gltf-binary", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".bin": "application/octet-stream", ".mp3": "audio/mpeg", ".md": "text/markdown; charset=utf-8",
};

const args = process.argv.slice(2);
const dry = args.includes("--dry-run"), force = args.includes("--force");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : FOLDERS;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : [p];
  });
}

/** Is it in the bucket already, at this size? (asked of the public URL: no keys needed) */
async function there(key, size) {
  try {
    const r = await fetch(`${BASE}/${key}`, { method: "HEAD" });
    return r.ok && Number(r.headers.get("content-length")) === size;
  } catch {
    return false;
  }
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
let sent = 0, skipped = 0, bytes = 0;
for (const folder of only) {
  for (const file of files(path.join(ASSETS, folder))) {
    const key = path.relative(ASSETS, file).split(path.sep).join("/");
    const size = statSync(file).size;
    if (!force && (await there(key, size))) { skipped++; continue; }
    const ext = path.extname(file).toLowerCase();
    const cache = ext === ".md" ? "public, max-age=3600" : FOREVER;
    console.log(`${dry ? "would send" : "sending"} ${key} (${(size / 1024).toFixed(0)} KB)`);
    if (!dry) {
      // (one quoted command line: on Windows npx runs through the shell, which would split "public, max-age=..." and paths)
      const q = (x) => `"${String(x).replace(/"/g, '\\"')}"`;
      const cmd = [npx, "--yes", "wrangler", "r2", "object", "put", q(`${BUCKET}/${key}`), "--file", q(file), "--remote",
        "--content-type", q(TYPES[ext] ?? "application/octet-stream"), "--cache-control", q(cache)].join(" ");
      for (let tries = 1; ; tries++) { // (R2 now and then answers 500 "please try again")
        try { execSync(cmd, { stdio: ["ignore", "ignore", "pipe"] }); break; } catch (e) {
          if (tries === 3) throw e;
          const why = String(e.stderr ?? "").split(String.fromCharCode(10)).find((l) => l.includes("ERROR")) ?? e.message;
          console.log(`  failed (${why}); again`);
          await new Promise((r) => setTimeout(r, 3000 * tries));
        }
      }
    }
    sent++; bytes += size;
  }
}
console.log(`${dry ? "would send" : "sent"} ${sent} files (${(bytes / 1048576).toFixed(1)} MB); ${skipped} already there`);
