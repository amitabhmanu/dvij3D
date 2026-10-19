// Council of Voices, Journey rail and Charvaka fragments (design §8–9),
// joined with what pipeline/link_companions.py computed from the comic.
import { getCollection, type CollectionEntry } from "astro:content";
import voiceLinks from "../content/generated/voices.json";
import railData from "../content/generated/rail.json";
import fragmentData from "../content/generated/fragments.json";
import { artFile } from "./manifest";
import type { FirstSeen } from "./codex";

type VoiceLink = { firstSeen: FirstSeen; portrait: { file: string; w: number; h: number; page: string } };
const LINKS = voiceLinks as Record<string, VoiceLink>;

export type VoiceSummary = {
  id: string; name: string; role: string; tradition: string; excerpt: string;
  firstSeen: FirstSeen | null; portrait: string;
};

export async function voiceEntries() {
  const entries = await getCollection("voices");
  return entries
    .map((e: CollectionEntry<"voices">) => ({
      ...e,
      firstSeen: (e.data.firstSeen ?? LINKS[e.id]?.firstSeen ?? null) as FirstSeen | null,
      portrait: LINKS[e.id]?.portrait,
    }))
    .sort((a, b) => a.data.order - b.data.order);
}

export async function voiceSummaries(): Promise<VoiceSummary[]> {
  return (await voiceEntries()).map((e) => ({
    id: e.id, name: e.data.name, role: e.data.role, tradition: e.data.tradition, excerpt: e.data.excerpt,
    firstSeen: e.firstSeen, portrait: e.portrait ? artFile(e.portrait.file) : "",
  }));
}

// ---- journey rail ----
export type RailNode = {
  id: string; title: string; quote?: string; note?: string; epic?: string; codex?: string;
  chakra?: { name: string; where: string; state: "lit" | "questioned" | "unlit" };
  party?: { change: string; text: string };
  teacher?: { voice: string; text: string };
  at?: { book: number; page: number; pageId: string };
};
export const rail = railData as { nodes: RailNode[]; range: { from: { book: number; page: number }; to: { book: number; page: number } } };

// ---- charvaka fragments ----
export type Fragment = { id: string; page: string; title: string; text: string; source: string };
export const fragments = fragmentData as Fragment[];
