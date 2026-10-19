/** @jsxImportSource preact */
// Dev-only review tool (plan Phase 0): correct panel boxes and reading order,
// write alt text from the art, and confirm chapter start pages. Saves to
// src/content/corrections/ via the dev server; run build_manifests.py after.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Box, Page } from "../lib/manifest";
import { pick } from "../lib/manifest";
import HotspotEditor from "./HotspotEditor";

type BookInfo = { slug: string; book: number; title: string; pageCount: number;
  chapters: { n: number; title: string; startPage: number; confirmed: boolean }[] };
type PanelFix = { panels: Box[]; alt: string[] };
type Drag = { kind: "move" | "resize" | "draw"; index: number; start: [number, number]; orig: Box };

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10000) / 10000;
const norm = ([a, b, c, d]: Box): Box => [round(Math.min(a, c)), round(Math.min(b, d)), round(Math.max(a, c)), round(Math.max(b, d))];

async function getJSON<T>(url: string, fallback: T): Promise<T> {
  try { const r = await fetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; }
}
async function post(name: string, body: unknown) {
  const r = await fetch(`/_dev/corrections/${name}`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
}

export default function DevReview({ books }: { books: BookInfo[] }) {
  const [slug, setSlug] = useState(books[0].slug);
  const [n, setN] = useState(1);
  const [pages, setPages] = useState<Record<number, Page>>({});
  const [fixes, setFixes] = useState<Record<string, PanelFix>>({});
  const [chapterFixes, setChapterFixes] = useState<Record<string, number>>({});
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [alts, setAlts] = useState<string[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [tool, setTool] = useState<"panels" | "hotspots">("panels");
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const book = books.find((b) => b.slug === slug)!;
  const page = pages[n];
  const pid = `${slug}-p${String(n).padStart(3, "0")}`;

  useEffect(() => {
    getJSON<Record<string, PanelFix>>("/_dev/corrections/panels.json", {}).then(setFixes);
    getJSON<Record<string, number>>("/_dev/corrections/chapters.json", {}).then(setChapterFixes);
  }, []);
  useEffect(() => {
    setPages({});
    getJSON<{ pages: Page[] }>(`/data/${slug}.json`, { pages: [] })
      .then((d) => setPages(Object.fromEntries(d.pages.map((p) => [p.n, p]))));
  }, [slug]);
  useEffect(() => {
    if (!page) return;
    const fix = fixes[pid];
    setBoxes(fix ? fix.panels : page.panels.map((p) => p.box));
    setAlts(fix ? fix.alt : page.panels.map((p) => p.alt));
    setSel(null);
    setDirty(false);
  }, [page, pid, fixes]);

  const go = (to: number) => {
    if (dirty && !confirm("Discard unsaved changes on this page?")) return;
    setN(Math.min(Math.max(1, to), book.pageCount));
  };

  // ---- pointer editing -------------------------------------------------------------
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  const onDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    const p = pos(e);
    const idx = t.dataset.index != null ? Number(t.dataset.index) : null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (idx != null) {
      setSel(idx);
      drag.current = { kind: t.dataset.handle ? "resize" : "move", index: idx, start: p, orig: boxes[idx] };
    } else {
      const next = [...boxes, [p[0], p[1], p[0], p[1]] as Box];
      setBoxes(next);
      setAlts([...alts, ""]);
      setSel(next.length - 1);
      drag.current = { kind: "draw", index: next.length - 1, start: p, orig: [p[0], p[1], p[0], p[1]] };
    }
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = pos(e);
    const [dx, dy] = [x - d.start[0], y - d.start[1]];
    const [a, b, c, dd] = d.orig;
    const nb: Box = d.kind === "move" ? [a + dx, b + dy, c + dx, dd + dy]
      : d.kind === "resize" ? [a, b, clamp(c + dx), clamp(dd + dy)]
      : [d.start[0], d.start[1], x, y];
    setBoxes(boxes.map((bx, i) => (i === d.index ? nb : bx)));
    setDirty(true);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const b = norm(boxes[d.index]);
    if (b[2] - b[0] < 0.02 || b[3] - b[1] < 0.02) { remove(d.index); return; } // stray click
    setBoxes(boxes.map((bx, i) => (i === d.index ? b : bx)));
  };

  const remove = (i: number) => {
    setBoxes(boxes.filter((_, j) => j !== i));
    setAlts(alts.filter((_, j) => j !== i));
    setSel(null);
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= boxes.length) return;
    const sw = <T,>(arr: T[]) => { const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; };
    setBoxes(sw(boxes)); setAlts(sw(alts)); setSel(j); setDirty(true);
  };

  const save = async () => {
    const fix = { panels: boxes.map(norm), alt: alts };
    await post("panels.json", { [pid]: fix });
    setFixes({ ...fixes, [pid]: fix });
    setDirty(false);
    setMsg(`Saved ${pid}`);
  };
  const setChapterStart = async (ch: number) => {
    await post("chapters.json", { [String(ch)]: n });
    setChapterFixes({ ...chapterFixes, [String(ch)]: n });
    setMsg(`Chapter ${ch} starts on page ${n}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["TEXTAREA", "INPUT", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === "]") go(n + 1);
      if (e.key === "[") go(n - 1);
      if (tool === "panels" && (e.key === "Delete" || e.key === "Backspace") && sel != null) remove(sel);
      if (tool === "panels" && e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const chaptersHere = book.chapters.filter((c) => (chapterFixes[String(c.n)] ?? c.startPage) === n);
  const reviewed = useMemo(() => Object.keys(fixes).filter((k) => k.startsWith(`${slug}-`)).length, [fixes, slug]);
  const unitsIn = (i: number) => (page?.text ?? []).filter((u) => {
    const [x0, y0, x1, y1] = boxes[i] ?? [0, 0, 0, 0];
    const cx = (u.bbox[0] + u.bbox[2]) / 2, cy = (u.bbox[1] + u.bbox[3]) / 2;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });

  return (
    <div class="review">
      <header>
        <select value={slug} onChange={(e) => { setSlug((e.target as HTMLSelectElement).value); setN(1); }}>
          {books.map((b) => <option value={b.slug}>Book {b.book}: {b.title}</option>)}
        </select>
        <button onClick={() => go(n - 1)}>‹ [</button>
        <input type="number" value={n} min={1} max={book.pageCount} onChange={(e) => go(Number((e.target as HTMLInputElement).value))} />
        <span>/ {book.pageCount}</span>
        <button onClick={() => go(n + 1)}>] ›</button>
        <span class="count">{reviewed}/{book.pageCount} pages reviewed{fixes[pid] ? " · this page ✓" : ""}</span>
        <span class="tools">
          <button aria-pressed={tool === "panels"} onClick={() => setTool("panels")}>Panels</button>
          <button aria-pressed={tool === "hotspots"} onClick={() => setTool("hotspots")}>Hotspots</button>
        </span>
        <button class="primary" onClick={save} disabled={!page || tool !== "panels"}>{dirty ? "Save page*" : "Save page"} (Ctrl+S)</button>
        <span class="msg">{msg}</span>
      </header>

      {tool === "hotspots" ? <HotspotEditor key={pid} pid={pid} imgSrc={page ? pick(page.src.webp, 1400) : undefined} /> : (
      <div class="body">
        <div class="canvas" ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          {page && <img src={pick(page.src.webp, 1400)} alt="" draggable={false} />}
          {page?.text.map((u) => (
            <div class="unit" style={{ left: `${u.bbox[0] * 100}%`, top: `${u.bbox[1] * 100}%`,
              width: `${(u.bbox[2] - u.bbox[0]) * 100}%`, height: `${(u.bbox[3] - u.bbox[1]) * 100}%` }} />
          ))}
          {boxes.map(([x0, y0, x1, y1], i) => (
            <div data-index={i} class={`box${sel === i ? " sel" : ""}`}
              style={{ left: `${Math.min(x0, x1) * 100}%`, top: `${Math.min(y0, y1) * 100}%`,
                width: `${Math.abs(x1 - x0) * 100}%`, height: `${Math.abs(y1 - y0) * 100}%` }}>
              <span data-index={i} class="num">{i + 1}</span>
              <span data-index={i} data-handle="br" class="handle" />
            </div>
          ))}
        </div>

        <aside>
          <p class="hint">Drag on empty space to draw a panel · drag a box to move · corner to resize · Delete removes · order = reading order.</p>
          <h3>Panels ({boxes.length})</h3>
          <ol class="panels">
            {boxes.map((_, i) => (
              <li class={sel === i ? "sel" : ""} onClick={() => setSel(i)}>
                <div class="row">
                  <strong>{i + 1}</strong>
                  <button onClick={() => move(i, -1)} title="Earlier">↑</button>
                  <button onClick={() => move(i, 1)} title="Later">↓</button>
                  <button onClick={() => remove(i)} title="Delete">✕</button>
                  <span class="lettering">{unitsIn(i).map((u) => u.t).join(" / ").slice(0, 90)}</span>
                </div>
                <textarea rows={2} placeholder="Alt text: describe what is drawn in this panel"
                  value={alts[i] ?? ""} onInput={(e) => { const c = [...alts]; c[i] = (e.target as HTMLTextAreaElement).value; setAlts(c); setDirty(true); }} />
              </li>
            ))}
          </ol>

          <h3>Chapters</h3>
          {chaptersHere.length ? (
            <ul>{chaptersHere.map((c) => <li>{c.title} starts here {c.confirmed || chapterFixes[String(c.n)] ? "✓" : "(unconfirmed)"}</li>)}</ul>
          ) : <p class="muted">No chapter starts on this page.</p>}
          <label>Set as start of:{" "}
            <select onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) setChapterStart(Number(v)); }}>
              <option value="">choose chapter…</option>
              {book.chapters.map((c) => <option value={c.n}>{c.title} (now p{chapterFixes[String(c.n)] ?? c.startPage}{c.confirmed ? "" : "?"})</option>)}
            </select>
          </label>
        </aside>
      </div>
      )}
    </div>
  );
}
