// The Bestiary (design §11): the book's mythological creatures, joined with
// what pipeline/link_bestiary.py found in the comic — where each one is named,
// where it is drawn, and the card image cropped from the page master.
import { getCollection, type CollectionEntry } from "astro:content";
import beastLinks from "../content/generated/bestiary-links.json";
import { artFile } from "./manifest";
import type { FirstSeen } from "./codex";

type BeastArt = { file: string; w: number; h: number; page: string };
type BeastLink = { firstSeen: FirstSeen | null; firstSeenFrom: string | null; mentions: string[]; art: BeastArt | null };
const LINKS = beastLinks as Record<string, BeastLink>;

export const CLASSES = {
  "nature-spirit": "Nature spirit",
  "wild-folk": "Wild folk",
  demon: "Demon",
  "restless-dead": "The restless dead",
  serpent: "Serpent",
  carving: "Temple carving",
  "legendary-race": "Legendary race",
} as const;
export type BeastClass = keyof typeof CLASSES;

export type BeastSummary = {
  id: string; title: string; summary: string; klass: BeastClass; classLabel: string;
  firstSeen: FirstSeen | null; image?: string; kin: string[];
};

/** Entries in the order the reader meets them, so the veil lifts front to back. */
export async function beastEntries() {
  const entries = await getCollection("bestiary");
  return entries
    .map((e: CollectionEntry<"bestiary">) => ({
      ...e,
      firstSeen: (e.data.firstSeen ?? LINKS[e.id]?.firstSeen ?? null) as FirstSeen | null,
      firstSeenFrom: LINKS[e.id]?.firstSeenFrom ?? null,
      mentions: LINKS[e.id]?.mentions ?? [],
      art: LINKS[e.id]?.art ?? null,
    }))
    .sort((a, b) => (a.firstSeen?.book ?? 9) - (b.firstSeen?.book ?? 9)
      || (a.firstSeen?.page ?? 0) - (b.firstSeen?.page ?? 0));
}

export async function beastSummaries(): Promise<BeastSummary[]> {
  return (await beastEntries()).map((e) => ({
    id: e.id,
    title: e.data.title,
    summary: e.data.summary,
    klass: e.data.class,
    classLabel: CLASSES[e.data.class],
    firstSeen: e.firstSeen,
    image: e.art ? artFile(e.art.file) : undefined,
    kin: e.data.kin,
  }));
}
