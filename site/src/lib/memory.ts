// The Memory Hall (design §12), joined with what pipeline/link_memory.py
// resolved from the comic's lettering.
import data from "../content/generated/memory.json";

export type Word = { deva: string; iast: string; gloss: string };
export type Verse = {
  id: string; title: string; subtitle: string; source: string; note: string;
  words: Word[]; codex?: string; at?: string;
};
export type Anchor = { book: number; page: number; pageId: string; rect: number[]; text: string };

export const memory = data as {
  anchors: { teaches: Anchor; names: Anchor; payoff: Anchor };
  verses: Verse[];
  ring: { items: string[]; distractions: string[] };
};

export const verses = memory.verses;
export const defaultVerse = memory.verses[0];
