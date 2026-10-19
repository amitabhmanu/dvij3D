// Voices and fragments for the reader's drawer, plus the rail for the
// reader's Journey panel (fetched on demand).
import type { APIRoute } from "astro";
import { fragments, rail, voiceSummaries } from "../../lib/companions";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify({ voices: await voiceSummaries(), fragments, rail }), {
    headers: { "Content-Type": "application/json" },
  });
