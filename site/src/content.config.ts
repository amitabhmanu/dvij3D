import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Codex entries (design §6.1). firstSeen is normally computed by
// pipeline/link_codex.py from the comic's lettering; set it here only to
// override that.
const codex = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/codex" }),
  schema: z.object({
    title: z.string(),
    aliases: z.array(z.string()).default([]),
    summary: z.string(),
    related: z.array(z.string()).default([]),
    images: z.array(z.string()).default([]), // names from site-assets/art (without .webp)
    // Most codex images are diagrams from the book's own artwork and need no
    // more than a generic alt. A picture of real people or a real place needs
    // its own description and its source recorded (design §11.4).
    imageAlt: z.string().optional(),
    imageCredit: z.string().optional(),
    diagram: z.string().optional(), // key in src/components/diagrams/index.ts
    source: z.string(), // endnote-N | manuscript | author
    firstSeen: z.object({ book: z.number().int(), page: z.number().int() }).optional(),
    manuscriptAnchor: z.string().optional(),
  }),
});

// Bestiary (design §11): the book's mythological creatures. firstSeen, the
// cropped card image and the `beast:` hotspots are computed by
// pipeline/link_bestiary.py. `art`/`alsoOn` boxes are normalised page
// coordinates, the same convention as panel boxes and hotspot rects.
const beastArt = z.object({
  page: z.string(),
  box: z.array(z.number()).length(4).optional(), // omit to crop the whole panel
  panel: z.number().int().optional(),
});
const bestiary = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/bestiary" }),
  schema: z.object({
    title: z.string(),
    class: z.enum(["serpent", "nature-spirit", "demon", "restless-dead", "carving", "wild-folk", "legendary-race"]),
    aliases: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]), // page ids where an alias must not fire
    summary: z.string(),
    appearance: z.string(),
    alsoKnownAs: z.array(z.string()).default([]),
    related: z.array(z.string()).default([]), // codex ids
    kin: z.array(z.string()).default([]), // other bestiary ids
    art: beastArt.optional(),
    alsoOn: z.array(beastArt).default([]), // drawn but unnamed: a hotspot with no lettering
    source: z.enum(["lettering", "art"]),
    firstSeen: z.object({ book: z.number().int(), page: z.number().int() }).optional(),
  }),
});

// Council of Voices (design §9). firstSeen and portraits are computed by
// pipeline/link_companions.py into generated/voices.json.
const voices = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/voices" }),
  schema: z.object({
    order: z.number().int(),
    name: z.string(),
    fullName: z.string().optional(),
    role: z.enum(["teacher", "guide", "antagonist", "survey"]),
    tradition: z.string(),
    setting: z.string(),
    quote: z.string(),
    firstQuote: z.string().optional(),
    firstSeen: z.object({ book: z.number().int(), page: z.number().int() }).optional(),
    portrait: z.object({ page: z.string(), match: z.string().optional(), box: z.array(z.number()).length(4).optional() }),
    excerpt: z.string(),
    codex: z.array(z.string()).default([]),
  }),
});

export const collections = { codex, bestiary, voices };
