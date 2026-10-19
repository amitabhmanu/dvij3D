// Which Charvaka fragments this reader has found (browser-only, like progress).
const KEY = "twice-born:fragments:v1";
export const FRAGMENT_COUNT = 5;

export function foundFragments(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Record a find; returns the updated list. */
export function findFragment(id: string): string[] {
  const found = foundFragments();
  if (!found.includes(id)) found.push(id);
  try { localStorage.setItem(KEY, JSON.stringify(found)); } catch { /* storage unavailable */ }
  return found;
}
