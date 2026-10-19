// Step 0.3: encode each 2x page master into responsive AVIF + WebP variants.
//
// Output: site-assets/pages/<id>-<width>.<hash>.<ext>, plus
// site-assets/pages/variants.json mapping each page id to its files.
// Content-hashed names let the CDN cache them forever. Re-running skips
// masters whose size and mtime are unchanged.
//
// Usage: node pipeline/make_variants.mjs [--force]
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, "../../site-assets");
const MASTER = path.join(ASSETS, "master");
const OUT = path.join(ASSETS, "pages");
const INDEX = path.join(OUT, "variants.json");

const WIDTHS = [null, 1400, 900, 240]; // null = full master width
const FORMATS = {
  avif: (img) => img.avif({ quality: 60, effort: 4 }),
  webp: (img) => img.webp({ quality: 82, effort: 5 }),
};
const CONCURRENCY = 3;
const force = process.argv.includes("--force");

const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

async function loadIndex() {
  try {
    return JSON.parse(await readFile(INDEX, "utf8"));
  } catch {
    return {};
  }
}

async function encodePage(file, index) {
  const id = path.basename(file, ".png");
  const src = path.join(MASTER, file);
  const { size, mtimeMs } = await stat(src);
  const stamp = `${size}:${Math.round(mtimeMs)}`;
  if (!force && index[id]?.stamp === stamp) return false;

  // Remove this page's previous outputs before writing new ones.
  for (const old of Object.values(index[id]?.files ?? {}).flatMap(Object.values)) {
    await rm(path.join(OUT, old), { force: true });
  }

  const { width, height } = await sharp(src).metadata();
  const files = {};
  for (const [ext, encode] of Object.entries(FORMATS)) {
    files[ext] = {};
    for (const w of WIDTHS) {
      const target = w ?? width;
      const buf = await encode(sharp(src).resize({ width: target, withoutEnlargement: true })).toBuffer();
      const name = `${id}-${target}.${hash(buf)}.${ext}`;
      await writeFile(path.join(OUT, name), buf);
      files[ext][target] = name;
    }
  }
  index[id] = { stamp, w: width, h: height, files };
  return true;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const index = await loadIndex();
  const masters = (await readdir(MASTER)).filter((f) => f.endsWith(".png")).sort();
  let next = 0, encoded = 0;
  const started = Date.now();

  async function worker() {
    while (next < masters.length) {
      const file = masters[next++];
      if (await encodePage(file, index)) {
        encoded++;
        if (encoded % 10 === 0) {
          console.log(`${encoded} encoded (${Math.round((Date.now() - started) / 1000)}s)`);
          await writeFile(INDEX, JSON.stringify(index, null, 1)); // checkpoint
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(INDEX, JSON.stringify(index, null, 1));
  console.log(`done: ${masters.length} pages, ${encoded} encoded in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
