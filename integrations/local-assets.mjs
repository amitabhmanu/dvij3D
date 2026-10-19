// Serves ../site-assets under /_assets during `astro dev`, and optionally copies
// the publishable part of it into the build (hosting option B).
//
// Page images, art and PDFs never live in git. In production the site reads
// them from PUBLIC_ASSET_BASE: either a CDN bucket (option A) or "/_assets"
// with BUNDLE_ASSETS=1 at build time (option B). See design §12.3.
import { createReadStream, existsSync, statSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = fileURLToPath(new URL("../../site-assets/", import.meta.url));
const CONTENT = fileURLToPath(new URL("../src/content/", import.meta.url));
// Dev-editable content files: request name -> path under src/content ("readonly" ones can't be POSTed).
const DEV_FILES = {
  "panels.json": { file: "corrections/panels.json" },
  "chapters.json": { file: "corrections/chapters.json" },
  "hotspots.json": { file: "hotspots/manual.json", replace: true },
  "hotspots-auto.json": { file: "hotspots/auto.json", readonly: true },
};
const PUBLISHED = ["pages", "art", "pdf"]; // never master/ or data/
const TYPES = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".json": "application/json",
};

export default function localAssets() {
  return {
    name: "twice-born-local-assets",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use("/_assets", (req, res, next) => {
          const rel = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\/+/, "");
          const top = rel.split("/")[0];
          const file = path.join(ASSETS, rel);
          if (!PUBLISHED.includes(top) || !file.startsWith(ASSETS) || !existsSync(file) || !statSync(file).isFile()) {
            return next();
          }
          res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
          createReadStream(file).pipe(res);
        });

        // Dev review tool storage: GET/POST /_dev/corrections/<name> (see DEV_FILES).
        // Writes into src/content/ (in git); build_manifests.py / the site read them.
        server.middlewares.use("/_dev/corrections", async (req, res, next) => {
          const name = (req.url || "").replace(/^\/+/, "").split("?")[0];
          const spec = DEV_FILES[name];
          if (!spec) return next();
          const file = path.join(CONTENT, spec.file);
          res.setHeader("Content-Type", "application/json");
          if (req.method === "GET") {
            res.end(existsSync(file) ? await readFile(file, "utf8") : "{}");
            return;
          }
          if (req.method === "POST" && !spec.readonly) {
            let body = "";
            for await (const chunk of req) body += chunk;
            const incoming = JSON.parse(body);
            if (spec.replace) { // whole-document files (hotspots/manual.json)
              await writeFile(file, JSON.stringify(incoming, null, 1) + "\n");
              res.end(JSON.stringify({ ok: true }));
              return;
            }
            const current = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
            const merged = { ...current, ...incoming };
            for (const [k, v] of Object.entries(incoming)) if (v === null) delete merged[k];
            await mkdir(path.dirname(file), { recursive: true });
            const sorted = Object.fromEntries(
              Object.entries(merged).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
            );
            await writeFile(file, JSON.stringify(sorted, null, 1) + "\n");
            res.end(JSON.stringify({ ok: true, count: Object.keys(merged).length }));
            return;
          }
          next();
        });
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (process.env.BUNDLE_ASSETS !== "1") return;
        const out = path.join(fileURLToPath(dir), "_assets");
        await mkdir(out, { recursive: true });
        for (const sub of PUBLISHED) {
          await cp(path.join(ASSETS, sub), path.join(out, sub), {
            recursive: true,
            filter: (src) => !src.endsWith("variants.json") && !src.endsWith("art.json"),
          });
        }
        logger.info(`bundled ${PUBLISHED.join(", ")} from site-assets into dist/_assets`);
      },
    },
  };
}
