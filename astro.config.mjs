import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import localAssets from "./integrations/local-assets.mjs";

// SITE_URL is set in Netlify once the domain is chosen; until then the
// Netlify subdomain works for canonical URLs and share cards.
export default defineConfig({
  site: process.env.SITE_URL || "https://twice-born.netlify.app",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [preact(), localAssets()],
});
