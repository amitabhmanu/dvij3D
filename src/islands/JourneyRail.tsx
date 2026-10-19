/** @jsxImportSource preact */
// The Journey rail (design §8.2): a slim vertical rail beside the reader during
// the trek. Beats light up as the reader passes them; chakra beats use the
// chakra colours; Sahasrara never lights. Tapping a beat shows all three lenses.
import { useEffect, useState } from "preact/hooks";
import type { RailNode } from "../lib/companions";
import { getProgress, hasReached } from "../lib/progress";
import { BOOK_SLUGS } from "../lib/spoilers";

export const CHAKRA_COLOURS: Record<string, string> = {
  Muladhara: "#c62828", Svadhishthana: "#ef6c00", Manipura: "#f9a825", Anahata: "#2e7d32",
  Vishuddha: "#1e88e5", Ajna: "#3949ab", Sahasrara: "#8e24aa",
};

let cache: Promise<RailNode[]> | null = null;
const loadRail = () => (cache ??= fetch("/data/companions.json").then((r) => r.json()).then((d) => d.rail.nodes)
  .catch(() => { cache = null; return []; }));

const before = (a: { book: number; page: number }, b: { book: number; page: number }) =>
  a.book < b.book || (a.book === b.book && a.page <= b.page);

type Props = { bookNo: number; page: number; onClose: () => void };

export default function JourneyRail({ bookNo, page, onClose }: Props) {
  const [nodes, setNodes] = useState<RailNode[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { loadRail().then(setNodes); }, []);
  const progress = getProgress();
  const here = { book: bookNo, page };
  const reached = (n: RailNode) => !!n.at && hasReached(progress, n.at.book, n.at.page, BOOK_SLUGS);
  const selected = nodes.find((n) => n.id === open);
  const currentId = nodes.filter((n) => n.at && before(n.at, here)).at(-1)?.id;

  return (
    <aside class="journey-rail" aria-label="The journey up Dronagiri" onPointerUp={(e) => e.stopPropagation()}>
      <button type="button" class="rail-close" onClick={onClose} aria-label="Hide the journey rail">×</button>
      <ol>
        {nodes.map((n) => {
          const lit = n.chakra?.state !== "unlit" && reached(n);
          const current = n.id === currentId;
          const colour = n.chakra ? CHAKRA_COLOURS[n.chakra.name] : "var(--reader-text)";
          return (
            <li key={n.id} class={`${n.chakra ? "chakra" : "beat"} ${lit ? "lit" : "dark"}${n.chakra?.state === "questioned" ? " questioned" : ""}${current ? " current" : ""}`}
              style={{ "--c": colour } as any}>
              <button type="button" aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)}
                aria-label={`${n.chakra?.name ?? n.party?.change ?? n.title}${
                  n.chakra?.state === "unlit" ? " (never reached)" : lit ? "" : " (not reached yet)"}`}>
                <span class="mark" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      {selected && (
        <div class="rail-card" role="dialog" aria-label={selected.title}>
          {!reached(selected) && selected.at ? (
            <p>Ahead in the story: <strong>Book {selected.at.book}, page {selected.at.page}</strong>.</p>
          ) : selected.chakra?.state === "unlit" ? (
            <><h3>{selected.chakra.name}</h3><p>{selected.note}</p></>
          ) : (
            <>
              <h3>{selected.title}</h3>
              {selected.chakra && <p><span class="lens">Kundalini</span> {selected.chakra.name}, {selected.chakra.where}{selected.chakra.state === "questioned" ? " (only asked, never confirmed)" : ""}</p>}
              {selected.party && <p><span class="lens">The party</span> {selected.party.text}</p>}
              {selected.teacher && <p><span class="lens">Teacher</span> {selected.teacher.text}</p>}
              {selected.at && <p><a href={`/read/b${selected.at.book}/${selected.at.page}`}>Go to the page →</a></p>}
            </>
          )}
          <p><a href="/journey/">The whole journey →</a></p>
        </div>
      )}
    </aside>
  );
}
