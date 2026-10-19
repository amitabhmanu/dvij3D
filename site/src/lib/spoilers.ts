// Spoiler policy (design §5.5): companion content whose firstSeen lies beyond
// the reader's furthest page is veiled unless they choose "reveal all".
import { getProgress, hasReached, setRevealAll } from "./progress";

export const BOOK_SLUGS = ["b1", "b2", "b3", "b4", "b5"];

export type FirstSeen = { book: number; page: number } | null | undefined;

export function isVeiled(firstSeen: FirstSeen): boolean {
  if (!firstSeen) return false;
  return !hasReached(getProgress(), firstSeen.book, firstSeen.page, BOOK_SLUGS);
}

export function revealAll(): void {
  setRevealAll(true);
}

export function hideAgain(): void {
  setRevealAll(false);
}

export function revealingAll(): boolean {
  return !!getProgress().revealAll;
}

/**
 * Progressive enhancement for static pages: any element with
 * data-first-book / data-first-page gets `data-veiled` when the reader hasn't
 * reached it. CSS does the hiding; the content stays in the HTML for search
 * engines and for readers without JavaScript.
 */
export function applyVeils(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-first-book]").forEach((el) => {
    const fs = { book: Number(el.dataset.firstBook), page: Number(el.dataset.firstPage) };
    el.toggleAttribute("data-veiled", isVeiled(fs));
  });
  document.documentElement.toggleAttribute("data-reveal-all", revealingAll());
}
