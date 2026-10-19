// Codex summaries for the reader's drawer (one small file, fetched on demand).
import type { APIRoute } from "astro";
import { codexSummaries } from "../../lib/codex";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await codexSummaries()), { headers: { "Content-Type": "application/json" } });
