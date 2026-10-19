// Codex entries joined with their comic links, plus the hotspot set
// (automatic Codex hotspots from link_codex.py, puzzle hotspots from
// link_parchment.py, creature hotspots from link_bestiary.py, adjusted by the
// dev tool's manual.json).
import { getCollection, type CollectionEntry } from "astro:content";
import links from "../content/generated/codex-links.json";
import autoHotspots from "../content/hotspots/auto.json";
import manualHotspots from "../content/hotspots/manual.json";
import puzzleHotspots from "../content/hotspots/puzzles.json";
import bestiaryHotspots from "../content/hotspots/bestiary.json";
import memoryHotspots from "../content/hotspots/memory.json";
import companionHotspots from "../content/hotspots/companions.json";
import { artFile, type Box } from "./manifest";

export type FirstSeen = { book: number; page: number };
export type Hotspot = { id: string; page: string; rect: Box; targets: string[]; terms?: string[]; label?: string; auto?: boolean; subtle?: boolean };
export type CodexSummary = {
  id: string;
  title: string;
  summary: string;
  firstSeen: FirstSeen | null;
  related: string[];
  image?: string;
};

type Links = Record<string, { firstSeen: FirstSeen | null; mentions: string[] }>;
const LINKS = links as Links;

export async function codexEntries() {
  const entries = await getCollection("codex");
  return entries
    .map((e: CollectionEntry<"codex">) => ({
      ...e,
      firstSeen: (e.data.firstSeen ?? LINKS[e.id]?.firstSeen ?? null) as FirstSeen | null,
      mentions: LINKS[e.id]?.mentions ?? [],
    }))
    .sort((a, b) => a.data.title.localeCompare(b.data.title));
}

export async function codexSummaries(): Promise<CodexSummary[]> {
  return (await codexEntries()).map((e) => ({
    id: e.id,
    title: e.data.title,
    summary: e.data.summary,
    firstSeen: e.firstSeen,
    related: e.data.related,
    image: e.data.images[0] ? artFile(`${e.data.images[0]}.webp`) : undefined,
  }));
}

export function allHotspots(): Hotspot[] {
  const manual = manualHotspots as { add: Hotspot[]; remove: string[] };
  const removed = new Set(manual.remove);
  return [
    ...(autoHotspots as Hotspot[]).filter((h) => !removed.has(h.id)),
    ...(puzzleHotspots as Hotspot[]).filter((h) => !removed.has(h.id)),
    ...(bestiaryHotspots as Hotspot[]).filter((h) => !removed.has(h.id)),
    ...(memoryHotspots as Hotspot[]).filter((h) => !removed.has(h.id)),
    ...(companionHotspots as Hotspot[]).filter((h) => !removed.has(h.id)),
    ...manual.add,
  ];
}

/** Hotspots on a page, with ones sharing the same rect merged into a single
 * mark (e.g. a line that is both a Voice's and a Charvaka fragment). */
export function hotspotsFor(pageId: string): Hotspot[] {
  const merged = new Map<string, Hotspot>();
  for (const h of allHotspots().filter((x) => x.page === pageId)) {
    const key = h.rect.map((n) => n.toFixed(3)).join(",");
    const at = merged.get(key);
    if (!at) {
      merged.set(key, { ...h });
      continue;
    }
    at.targets = [...new Set([...at.targets, ...h.targets])];
    at.label = [at.label, h.label].filter(Boolean).join(" · ");
    at.terms = [...(at.terms ?? []), ...(h.terms ?? [])];
    at.subtle = at.subtle && h.subtle; // a subtle mark plus a normal one shows normally
  }
  return [...merged.values()];
}

/** "B3 p12" style label and link for a page id like "b3-p012". */
export function pageRef(pageId: string) {
  const [b, p] = pageId.slice(1).split("-p").map(Number);
  return { book: b, page: p, href: `/read/b${b}/${p}`, label: `Book ${b}, page ${p}` };
}
