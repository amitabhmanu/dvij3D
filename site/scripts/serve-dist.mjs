// Minimal static server for dist/ (used by the end-to-end tests). Mirrors how
// Netlify serves the site: directory -> index.html, 404.html for misses.
// Usage: node scripts/serve-dist.mjs [port]
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.argv[2] || 4323);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".webp": "image/webp", ".png": "image/png", ".pdf": "application/pdf", ".wasm": "application/wasm",
  ".pf_meta": "application/octet-stream", ".pf_index": "application/octet-stream", ".pf_fragment": "application/octet-stream",
};

function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^([/\\])+/, "");
  let file = path.join(ROOT, clean);
  if (!file.startsWith(ROOT)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  return existsSync(file) ? file : null;
}

createServer((req, res) => {
  const file = resolve(req.url || "/");
  const target = file ?? path.join(ROOT, "404.html");
  res.writeHead(file ? 200 : 404, { "Content-Type": TYPES[path.extname(target)] || "application/octet-stream" });
  createReadStream(target).pipe(res);
}).listen(PORT, () => console.log(`serving dist on http://localhost:${PORT}`));
