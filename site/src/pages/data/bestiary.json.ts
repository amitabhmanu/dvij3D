// Creature summaries for the reader's drawer (design §11.3).
import type { APIRoute } from "astro";
import { beastSummaries } from "../../lib/bestiary";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await beastSummaries()), { headers: { "Content-Type": "application/json" } });
