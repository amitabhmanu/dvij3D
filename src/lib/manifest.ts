// Typed access to the per-book manifests written by pipeline/build_manifests.py.

export type Box = [number, number, number, number]; // x0, y0, x1, y1 (0-1)
export type TextUnit = { t: string; bbox: Box; kind: "caption" | "balloon" | "sfx"; panel: number | null };
export type Srcset = Record<string, string>; // width -> file name
export type Page = {
  n: number;
  id: string;
  w: number;
  h: number;
  src: { avif: Srcset; webp: Srcset };
  panels: { box: Box; alt: string }[];
  text: TextUnit[];
  reviewed: boolean;
  hotspots?: PageHotspot[]; // added by the /data endpoint and reader pages
};
export type PageHotspot = { id: string; rect: Box; targets: string[]; label?: string; subtle?: boolean };
export type Chapter = { n: number; title: string; startPage: number; confirmed: boolean };
export type Book = {
  book: number;
  slug: string;
  title: string;
  pageCount: number;
  cover: string;
  pdf: { file: string; bytes: number | null };
  parts: { n: number; startPage: number; endPage: number }[];
  chapters: Chapter[];
  pages: Page[];
};

const modules = import.meta.glob<Book>("../content/manifests/*.json", { eager: true, import: "default" });

export const books: Book[] = Object.values(modules).sort((a, b) => a.book - b.book);

export function getBook(slug: string): Book {
  const book = books.find((b) => b.slug === slug);
  if (!book) throw new Error(`unknown book ${slug}`);
  return book;
}

export function nextBook(book: Book): Book | undefined {
  return books.find((b) => b.book === book.book + 1);
}

/** Chapter containing a page (chapters are sorted by startPage). */
export function chapterOf(book: Book, page: number): Chapter | undefined {
  return [...book.chapters].reverse().find((c) => c.startPage <= page);
}

// ---- asset URLs -----------------------------------------------------------

export const ASSET_BASE: string = (import.meta.env.PUBLIC_ASSET_BASE || "/_assets").replace(/\/$/, "");

export const pageFile = (name: string) => `${ASSET_BASE}/pages/${name}`;
export const artFile = (name: string) => `${ASSET_BASE}/art/${name}`;
export const pdfUrl = (book: Book) => `${ASSET_BASE}/${book.pdf.file}`;

export function srcset(set: Srcset): string {
  return Object.entries(set)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([w, file]) => `${pageFile(file)} ${w}w`)
    .join(", ");
}

/** Smallest variant at least `min` px wide (falls back to the largest). */
export function pick(set: Srcset, min: number): string {
  const widths = Object.keys(set).map(Number).sort((a, b) => a - b);
  const w = widths.find((x) => x >= min) ?? widths[widths.length - 1];
  return pageFile(set[String(w)]);
}

export function formatMB(bytes: number | null): string {
  return bytes ? `${(bytes / 1e6).toFixed(0)} MB` : "";
}
