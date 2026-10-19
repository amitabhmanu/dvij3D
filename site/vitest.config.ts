/// <reference types="vitest/config" />
// Unit tests for the pure helpers in src/lib (npm run test:unit). Astro's own
// Vite config is reused so imports resolve exactly as they do in the site.
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: { include: ["src/**/*.test.ts"] },
});
