// Per-book page data for the reader island: one small JSON file per book,
// fetched once, instead of embedding the whole book in every page's HTML.
import type { APIRoute } from "astro";
import { books, getBook } from "../../lib/manifest";
import { hotspotsFor } from "../../lib/codex";

export function getStaticPaths() {
  return books.map((b) => ({ params: { book: b.slug } }));
}

export const GET: APIRoute = ({ params }) => {
  const book = getBook(params.book!);
  const pages = book.pages.map(({ n, id, w, h, src, panels, text }) => ({
    n, id, w, h, src, panels, text,
    hotspots: hotspotsFor(id).map(({ id, rect, targets, terms, label, subtle }) => ({ id, rect, targets, label: label ?? terms?.join(", "), subtle })),
  }));
  return new Response(JSON.stringify({ slug: book.slug, pages }), {
    headers: { "Content-Type": "application/json" },
  });
};
