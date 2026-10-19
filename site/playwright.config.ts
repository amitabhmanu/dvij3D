import { defineConfig, devices } from "@playwright/test";

// Runs against the production build: `npm run build:local` first, which
// bundles page images into dist/_assets and builds the search index.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 2, // browser start-up is slow on this machine; 4 parallel launches time out
  use: { baseURL: "http://localhost:4323" },
  webServer: {
    command: "node scripts/serve-dist.mjs 4323",
    port: 4323,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  // Uses the locally installed Chrome (channel) rather than Playwright's
  // downloaded browser builds.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
