// Production build with site-assets bundled into dist/_assets (hosting option
// B, and what the end-to-end tests run against). Cross-platform stand-in for
// `BUNDLE_ASSETS=1 npm run build`.
import { spawnSync } from "node:child_process";

const env = { ...process.env, BUNDLE_ASSETS: "1" };
for (const [cmd, args] of [["astro", ["build"]], ["pagefind", ["--site", "dist"]]]) {
  const r = spawnSync("npx", [cmd, ...args], { stdio: "inherit", env, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
