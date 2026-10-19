// The Vedic recitation patterns (design §12.2), generated from a word list by
// rule so that any verse can be dropped into src/content/memory.yaml as data.
//
// Over words 1 2 3 4 …
//   pada   1 · 2 · 3 · 4
//   krama  1-2, 2-3, 3-4
//   jata   1-2 2-1 1-2, 2-3 3-2 2-3
//   ghana  1-2 2-1 1-2-3 3-2-1 1-2-3, 2-3 3-2 2-3-4 4-3-2 2-3-4
//
// An "utterance" is one group a reciter says in one go, as a list of word
// indices. The last group of krama/jata/ghana is shorter where the verse runs
// out, exactly as it is in practice at the end of a line.

export type Patha = "pada" | "krama" | "jata" | "ghana";
export type Utterance = number[];

export const PATHAS: Patha[] = ["pada", "krama", "jata", "ghana"];

export const PATHA_LABEL: Record<Patha, { name: string; iast: string; rule: string }> = {
  pada: { name: "Word by word", iast: "pada", rule: "Each word alone, in order." },
  krama: { name: "Forward", iast: "krama", rule: "Each word with the one after it: 1-2, 2-3, 3-4…" },
  jata: { name: "Forward and back", iast: "jaṭā", rule: "Each pair woven: 1-2, then 2-1, then 1-2 again." },
  ghana: { name: "Interleaved", iast: "ghana", rule: "Each pair, reversed, then three forward, three back, three forward." },
};

/** The groups of one patha over `n` words, as lists of 0-based word indices. */
export function utterances(patha: Patha, n: number): Utterance[] {
  if (n <= 0) return [];
  switch (patha) {
    case "pada":
      return Array.from({ length: n }, (_, i) => [i]);
    case "krama":
      return n === 1 ? [[0]] : Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);
    case "jata":
      if (n === 1) return [[0]];
      return Array.from({ length: n - 1 }, (_, i) => [i, i + 1, i + 1, i, i, i + 1]);
    case "ghana":
      if (n === 1) return [[0]];
      return Array.from({ length: n - 1 }, (_, i) =>
        i + 2 < n
          ? [i, i + 1, i + 1, i, i, i + 1, i + 2, i + 2, i + 1, i, i, i + 1, i + 2]
          : [i, i + 1, i + 1, i, i, i + 1], // the last pair has nothing to extend into
      );
  }
}

/** Every word index the reciter says, flattened — the order of taps. */
export const sequence = (patha: Patha, n: number): number[] => utterances(patha, n).flat();

/**
 * How many of a patha's utterances a single wrong word would break. This is the
 * whole argument of §12.2: in pada it shows up once and could pass unnoticed;
 * in ghana it contradicts itself in several places at once.
 */
export function utterancesTouching(patha: Patha, n: number, word: number): number[] {
  return utterances(patha, n)
    .map((u, i) => (u.includes(word) ? i : -1))
    .filter((i) => i >= 0);
}

/** How often the word is said in total across the pattern. */
export const timesSpoken = (patha: Patha, n: number, word: number): number =>
  sequence(patha, n).filter((w) => w === word).length;
