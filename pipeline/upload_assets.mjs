// Uploads site-assets/{pages,art,pdf} to the Cloudflare R2 bucket the site
// reads from (design §14.3, hosting option A). R2 speaks S3, so this is the
// AWS SDK pointed at an R2 endpoint.
//
// The page images and art carry a content hash in their filenames, so they are
// safe to cache forever; a re-encode produces a new name rather than changing
// an old one. Objects already in the bucket at the same size are skipped, so
// re-running this after a partial upload costs one listing and nothing else.
//
//   node pipeline/upload_assets.mjs [--dry-run] [--force] [--only pages,art,pdf]
//   node pipeline/upload_assets.mjs --verify      (npm run verify-assets)
//
// --verify uploads nothing. It reads the built site in dist/ and checks that
// every asset it links to is already in the bucket. Run it after a build and
// before pushing: the site deploys from main and serves straight from R2, so
// an artifact that was committed but never uploaded ships as a broken image.
// That is how B1 p1 and the 25 Real India photographs reached main without
// ever reaching the bucket.
//
// Credentials come from site/.env (see .env.example) or the environment.
import { HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = fileURLToPath(new URL("../../site-assets/", import.meta.url));
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const NETLIFY_TOML = fileURLToPath(new URL("../netlify.toml", import.meta.url));
const FOREVER = "public, max-age=31536000, immutable";
// pdf/ names are not hashed: a recompressed book keeps its filename, so it gets
// a week rather than a year. The <a download> on the book pages is ignored by
// browsers for cross-origin hrefs, so the header has to do that job instead.
const FOLDERS = {
  pages: { cacheControl: FOREVER },
  art: { cacheControl: FOREVER },
  pdf: { cacheControl: "public, max-age=604800", contentDisposition: "attachment" },
};
const TYPES = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
};
// Pipeline bookkeeping that the site never requests.
const SKIP = new Set(["variants.json", "art.json"]);
const CONCURRENCY = 8;

function loadEnv() {
  const file = fileURLToPath(new URL("../.env", import.meta.url));
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // environment-only is fine
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

async function walk(dir, base = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (!SKIP.has(entry.name)) out.push(rel);
  }
  return out;
}

async function listRemote(s3, bucket, prefix) {
  const sizes = new Map();
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of page.Contents || []) sizes.set(obj.Key, obj.Size);
    token = page.NextContinuationToken;
  } while (token);
  return sizes;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// The public base the build links assets under: the environment (site/.env for
// a local build), else the value Netlify builds with, from netlify.toml.
function assetBase() {
  if (process.env.PUBLIC_ASSET_BASE) return process.env.PUBLIC_ASSET_BASE.replace(/\/$/, "");
  const m = /^\s*PUBLIC_ASSET_BASE\s*=\s*"([^"]+)"/m.exec(readFileSync(NETLIFY_TOML, "utf8"));
  if (!m) throw new Error("PUBLIC_ASSET_BASE is not set and not found in netlify.toml");
  return m[1].replace(/\/$/, "");
}

async function verify(s3, bucket) {
  const base = assetBase();
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Stops at quote, space, comma (srcset) and & (an HTML-escaped attribute), so
  // "art&quot;]}" fragments inside data attributes never pass for a filename.
  const ref = new RegExp(`${escaped}/((?:${Object.keys(FOLDERS).join("|")})/[^"'\\s,)<>&\\\\]+)`, "g");

  let files;
  try {
    files = (await walk(DIST)).filter((f) => /\.(html|json)$/.test(f));
  } catch {
    console.error(`No dist/ to check. Run a build first (npm run build).`);
    process.exit(1);
  }
  const keys = new Set();
  for (const f of files) {
    for (const m of readFileSync(path.join(DIST, f), "utf8").matchAll(ref)) keys.add(m[1]);
  }
  // Zero references is not a pass: it means dist/ was built against another
  // base (a BUNDLE_ASSETS build links /_assets), so nothing here was checked.
  if (!keys.size) {
    console.error(`dist/ links no assets under ${base}. Was it built with a different PUBLIC_ASSET_BASE?`);
    process.exit(1);
  }

  const missing = [];
  const counts = {};
  for (const folder of Object.keys(FOLDERS)) {
    const wanted = [...keys].filter((k) => k.startsWith(`${folder}/`));
    if (!wanted.length) continue;
    counts[folder] = wanted.length;
    const remote = await listRemote(s3, bucket, `${folder}/`);
    missing.push(...wanted.filter((k) => !remote.has(k)));
  }
  const summary = Object.entries(counts).map(([f, n]) => `${f} ${n}`).join(", ");
  if (missing.length) {
    console.error(`${missing.length} of ${keys.size} assets linked by dist/ are not in ${bucket}:`);
    for (const k of missing.sort()) console.error(`  ${k}`);
    console.error(`Upload them (node pipeline/upload_assets.mjs) before pushing.`);
    process.exit(1);
  }
  console.log(`All ${keys.size} assets linked by dist/ are in ${bucket} (${summary}).`);
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const onlyArg = args[args.indexOf("--only") + 1];
  const folders = args.includes("--only") ? onlyArg.split(",") : Object.keys(FOLDERS);
  for (const f of folders) if (!FOLDERS[f]) throw new Error(`unknown folder: ${f}`);

  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  const missing = Object.entries({ R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET })); // fail early on bad keys or bucket name

  if (args.includes("--verify")) return verify(s3, R2_BUCKET);

  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;

  for (const folder of folders) {
    const dir = path.join(ASSETS, folder);
    let names;
    try {
      names = await walk(dir);
    } catch {
      console.log(`${folder}/ is not in site-assets, skipping`);
      continue;
    }
    const remote = force ? new Map() : await listRemote(s3, R2_BUCKET, `${folder}/`);

    const todo = [];
    for (const name of names) {
      const key = `${folder}/${name}`;
      const { size } = await stat(path.join(dir, name));
      if (remote.get(key) === size) {
        skipped++;
        continue;
      }
      todo.push({ key, file: path.join(dir, name), size });
    }
    const total = todo.reduce((n, t) => n + t.size, 0);
    console.log(`${folder}/: ${todo.length} to upload (${mb(total)}), ${names.length - todo.length} already there`);

    let i = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (i < todo.length) {
          const item = todo[i++];
          if (!dryRun) {
            await s3.send(
              new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: item.key,
                Body: createReadStream(item.file),
                ContentLength: item.size,
                ContentType: TYPES[path.extname(item.file)] || "application/octet-stream",
                CacheControl: FOLDERS[folder].cacheControl,
                ContentDisposition: FOLDERS[folder].contentDisposition,
              })
            );
          }
          uploaded++;
          bytes += item.size;
          if (++done % 50 === 0 || done === todo.length) {
            process.stdout.write(`\r  ${done}/${todo.length}`);
          }
        }
      })
    );
    if (todo.length) process.stdout.write("\n");
  }

  console.log(`${dryRun ? "Would upload" : "Uploaded"} ${uploaded} files (${mb(bytes)}); skipped ${skipped} already present.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
