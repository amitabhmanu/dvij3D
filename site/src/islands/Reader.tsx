/** @jsxImportSource preact */
// The comic reader (design §5): spreads on wide screens, single pages on
// phones, and a panel-by-panel mode that zooms to each panel box.
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Box, Chapter, Page, PageHotspot } from "../lib/manifest";
import { pick, srcset } from "../lib/manifest";
import { getProgress, recordPage, setJourney, setMode, setNotes, type ReaderMode } from "../lib/progress";
import CodexDrawer from "./CodexDrawer";
import JourneyRail from "./JourneyRail";
import "./reader.css";

type BookRef = { slug: string; title: string; book: number };
type Props = {
  slug: string;
  bookNo: number;
  title: string;
  pageCount: number;
  startPage: number;
  initial: Page;
  chapters: Chapter[];
  next?: BookRef;
  /** First page of the trek rail (design §8); the rail is offered from there on. */
  journeyFrom?: { book: number; page: number };
};

const WIDE = "(min-width: 1024px) and (min-aspect-ratio: 5/4)";
const KIND_LABEL = { caption: "Caption", balloon: "Speech", sfx: "Sound" } as const;

/** In a spread, page 1 stands alone (the cover side); then 2-3, 4-5, ... */
const spreadStart = (p: number) => (p === 1 ? 1 : p % 2 === 0 ? p : p - 1);

/** What panel mode frames: the panel box grown to take in its lettering.
 * Balloons often spill over the panel border, so a bare panel crop cuts them
 * off. A text unit counts if it was assigned to the panel or overlaps it by
 * 40% of its area (straddling balloons are tagged to only one side; a smaller
 * overlap is usually the next panel's balloon grazing the border). Text
 * bboxes hug the glyphs, so they are padded out to roughly the balloon edge. */
function panelViewBox(page: Page, i: number): Box {
  const box = page.panels[i]?.box ?? [0, 0, 1, 1];
  let [x0, y0, x1, y1] = box;
  const padX = 0.035, padY = 0.035 * (page.w / page.h); // same distance in pixels
  for (const u of page.text ?? []) {
    const [a, b, c, d] = u.bbox;
    const ix = Math.max(0, Math.min(c, box[2]) - Math.max(a, box[0]));
    const iy = Math.max(0, Math.min(d, box[3]) - Math.max(b, box[1]));
    const area = (c - a) * (d - b);
    if (u.panel !== i && !(area > 0 && (ix * iy) / area >= 0.4)) continue;
    x0 = Math.min(x0, a - padX); y0 = Math.min(y0, b - padY);
    x1 = Math.max(x1, c + padX); y1 = Math.max(y1, d + padY);
  }
  return [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)];
}

function PageImage({ page, sizes, eager }: { page: Page; sizes: string; eager?: boolean }) {
  const alt = page.panels.map((p) => p.alt).filter(Boolean).join(" ") || `Page ${page.n}`;
  return (
    <picture>
      <source type="image/avif" srcset={srcset(page.src.avif)} sizes={sizes} />
      <source type="image/webp" srcset={srcset(page.src.webp)} sizes={sizes} />
      <img
        src={pick(page.src.webp, 900)}
        width={page.w}
        height={page.h}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchpriority={eager ? "high" : "auto"}
        draggable={false}
      />
    </picture>
  );
}

/** Clickable annotation marks over a page (design §6.3). Real buttons, so they
 * are reachable by keyboard and announced by screen readers. */
function Hotspots({ hotspots, onOpen, scale = 1 }: { hotspots?: PageHotspot[]; onOpen: (h: PageHotspot) => void; scale?: number }) {
  if (!hotspots?.length) return null;
  return (
    <div class="hotspots" style={{ "--inv": 1 / scale } as any}>
      {hotspots.map((h) => (
        <button
          type="button"
          key={h.id}
          class={`hotspot${h.targets.some((t) => t.startsWith("puzzle:")) ? " kind-puzzle" : ""}${h.subtle ? " kind-subtle" : ""}`}
          style={{
            left: `${h.rect[0] * 100}%`, top: `${h.rect[1] * 100}%`,
            width: `${(h.rect[2] - h.rect[0]) * 100}%`, height: `${(h.rect[3] - h.rect[1]) * 100}%`,
          }}
          aria-label={h.subtle ? "A faint mark" : `Note: ${h.label || "more about this"}`}
          onClick={(e) => { e.stopPropagation(); onOpen(h); }}
        >
          {h.targets.some((t) => t.startsWith("puzzle:"))
            ? <span class="badge" aria-hidden="true">Puzzle</span>
            : <span class="dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export default function Reader(props: Props) {
  const { slug, bookNo, title, pageCount, chapters, next, journeyFrom } = props;
  const [pages, setPages] = useState<Record<number, Page>>({ [props.initial.n]: props.initial });
  const [page, setPage] = useState(props.startPage);
  const [panel, setPanel] = useState(0);
  const [mode, setModeState] = useState<ReaderMode>("single");
  const [wide, setWide] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [transcript, setTranscript] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notes, setNotesState] = useState(true);
  const [drawer, setDrawer] = useState<PageHotspot | null>(null);
  const [journey, setJourneyState] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const pointer = useRef<{ x: number; y: number; t: number } | null>(null);

  const effective: ReaderMode = mode === "spread" && !wide ? "single" : mode;
  const visible = useMemo(() => {
    if (effective !== "spread") return [page];
    const s = spreadStart(page);
    return s + 1 <= pageCount && s !== 1 ? [s, s + 1] : [s];
  }, [effective, page, pageCount]);
  const current = pages[page];
  const panelBoxes = current?.panels.length ? current.panels : [{ box: [0, 0, 1, 1] as const, alt: "" }];
  const chapter = [...chapters].reverse().find((c) => c.startPage <= page);

  useEffect(() => setHydrated(true), []); // lets tests wait until controls are live

  // ---- load the book's full page data --------------------------------------
  useEffect(() => {
    fetch(`/data/${slug}.json`)
      .then((r) => r.json())
      .then((book: { pages: Page[] }) => setPages(Object.fromEntries(book.pages.map((p) => [p.n, p]))))
      .catch(() => {/* reader keeps working with the initial page only */});
  }, [slug]);

  // ---- viewport, preferences, deep-linked panel -------------------------------
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    const prefs = getProgress();
    const saved = prefs.mode;
    if (prefs.notes === false) setNotesState(false);
    if (prefs.journey) setJourneyState(true);
    const hash = /^#p(\d+)$/.exec(location.hash);
    if (hash) {
      setModeState("panel");
      setPanel(Math.max(0, Number(hash[1]) - 1));
    } else if (saved) {
      setModeState(saved);
    } else {
      setModeState(mq.matches ? "spread" : "single");
    }
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- the host's badge -----------------------------------------------------------
  // Netlify injects a "Powered by Netlify" badge (#nl-badge-frame) into every
  // production page, fixed to the bottom-right corner - exactly where the bar
  // keeps Next and the zoom controls, which it covered. On the free tier it is
  // part of the plan and cannot be hidden, so the bar makes room for it instead.
  // It arrives after load and resizes itself (full card, collapsed after Close),
  // so it is measured live rather than assumed; with no badge both stay 0.
  const [badge, setBadge] = useState({ w: 0, h: 0 });
  useEffect(() => {
    let frame: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const r = frame?.getBoundingClientRect();
      const inCorner = !!r && r.width > 0 && r.height > 0 &&
        r.right >= window.innerWidth - 2 && r.bottom >= window.innerHeight - 2;
      const next = inCorner ? { w: Math.ceil(r!.width), h: Math.ceil(r!.height) } : { w: 0, h: 0 };
      setBadge((b) => (b.w === next.w && b.h === next.h ? b : next));
    };
    const attach = () => {
      const f = document.getElementById("nl-badge-frame");
      if (f === frame) return;
      ro?.disconnect();
      frame = f;
      ro = f ? new ResizeObserver(measure) : null;
      if (f) ro!.observe(f);
      measure();
    };
    const mo = new MutationObserver(attach); // the frame is appended to, and removed from, <body>
    mo.observe(document.body, { childList: true });
    attach();
    window.addEventListener("resize", measure);
    return () => { mo.disconnect(); ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // ---- URL, title, progress, preloading -----------------------------------------
  useEffect(() => {
    const url = `/read/${slug}/${page}${effective === "panel" ? `#p${panel + 1}` : ""}`;
    history.replaceState(null, "", url);
    document.title = `Page ${page} · Book ${bookNo}: ${title} · The Twice Born`;
    recordPage(slug, Math.max(...visible), effective === "panel" ? panel : undefined);
  }, [slug, page, panel, effective, visible, bookNo, title]);

  useEffect(() => {
    for (let n = Math.max(...visible) + 1; n <= Math.min(pageCount, Math.max(...visible) + 2); n++) {
      const p = pages[n];
      if (!p) continue;
      const img = new Image();
      img.sizes = effective === "spread" ? "min(50vw, 63vh)" : "min(100vw, 63vh)";
      img.srcset = srcset(p.src.avif);
    }
  }, [visible, pages, pageCount, effective]);

  // ---- navigation ---------------------------------------------------------------
  const goTo = useCallback((n: number, p = 0) => {
    setAtEnd(false);
    setDrawer(null);
    setPage(Math.min(Math.max(1, n), pageCount));
    setPanel(p);
  }, [pageCount]);

  const forward = useCallback(() => {
    if (effective === "panel") {
      if (panel < panelBoxes.length - 1) return setPanel(panel + 1);
      if (page < pageCount) return goTo(page + 1, 0);
      return setAtEnd(true);
    }
    const last = Math.max(...visible);
    if (last >= pageCount) return setAtEnd(true);
    goTo(effective === "spread" ? last + 1 : page + 1);
    setChrome(false);
  }, [effective, panel, panelBoxes.length, page, pageCount, visible, goTo]);

  const back = useCallback(() => {
    if (atEnd) return setAtEnd(false);
    if (effective === "panel") {
      if (panel > 0) return setPanel(panel - 1);
      if (page > 1) {
        const prev = pages[page - 1];
        return goTo(page - 1, Math.max(0, (prev?.panels.length || 1) - 1));
      }
      return;
    }
    const first = Math.min(...visible);
    if (first <= 1) return;
    goTo(effective === "spread" ? spreadStart(first - 1) : page - 1);
    setChrome(false);
  }, [atEnd, effective, panel, page, pages, visible, goTo]);

  const toggleNotes = () => { setNotes(!notes); setNotesState(!notes); };
  const journeyHere = !!journeyFrom && (bookNo > journeyFrom.book || (bookNo === journeyFrom.book && page >= journeyFrom.page));
  const toggleJourney = () => { setJourney(!journey); setJourneyState(!journey); };
  const openHotspot = (h: PageHotspot) => { setTranscript(false); setDrawer(h); };

  const changeMode = (m: ReaderMode) => {
    setModeState(m);
    setMode(m);
    setPanel(0);
    setAtEnd(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "ArrowRight": case "PageDown": case " ": e.preventDefault(); forward(); break;
        case "ArrowLeft": case "PageUp": e.preventDefault(); back(); break;
        case "Home": e.preventDefault(); goTo(1); break;
        case "End": e.preventDefault(); goTo(pageCount); break;
        case "p": changeMode(effective === "panel" ? (wide ? "spread" : "single") : "panel"); break;
        case "t": setTranscript((v) => !v); break;
        case "n": toggleNotes(); break;
        case "j": if (journeyHere) toggleJourney(); break;
        case "Escape":
          if (drawer) setDrawer(null);
          else if (effective === "panel") changeMode(wide ? "spread" : "single");
          else setChrome((c) => !c);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, back, goTo, pageCount, effective, wide, drawer, notes, journey, journeyHere]);

  // ---- zoom: wheel / trackpad pinch / buttons / + - 0, drag to pan --------------
  // A user zoom over whatever the stage shows (page, spread or framed panel),
  // anchored where it is aimed. Turning a page or panel goes back to the fit.
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const zoomed = zoom.z !== 1 || zoom.x !== 0 || zoom.y !== 0;
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = stageRef.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
    setZoom(({ z, x, y }) => {
      const nz = Math.min(6, Math.max(0.5, z * factor));
      if (Math.abs(nz - 1) < 0.02) return { z: 1, x: 0, y: 0 }; // snap back to the fit
      const k = nz / z;
      return { z: nz, x: px - (px - x) * k, y: py - (py - y) * k };
    });
  }, []);
  const resetZoom = useCallback(() => setZoom({ z: 1, x: 0, y: 0 }), []);
  useEffect(resetZoom, [page, panel, effective]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".end-card")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "+" || e.key === "=") zoomAt(1.25);
      else if (e.key === "-" || e.key === "_") zoomAt(0.8);
      else if (e.key === "0") resetZoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, resetZoom]);

  // ---- pointer: swipe, or tap zones (left third back, right third forward) --------
  // While zoomed, a drag pans the view and a tap only toggles the bars; neither
  // turns the page.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (zoomed && e.pointerType === "mouse" && !(e.target as HTMLElement).closest("button, a, select")) {
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; setPanning(true); }
    d.x = e.clientX; d.y = e.clientY;
    setZoom((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = pointer.current;
    const panned = drag.current?.moved;
    pointer.current = null;
    drag.current = null;
    setPanning(false);
    if (panned) return;
    if (!start || (e.target as HTMLElement).closest("button, a, select")) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? forward() : back();
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    // Zoomed in, a tap must not turn the page - that throws the zoom away, and a
    // press that starts a pan but never moves 4px would do it by accident. It
    // still toggles the bars, which carry the zoom controls.
    if (zoomed) return setChrome((c) => !c);
    const rect = stageRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 1 / 3) back();
    else if (x > 2 / 3) forward();
    else setChrome((c) => !c);
  };

  // ---- panel mode geometry ----------------------------------------------------------
  const panelView = useMemo(() => {
    if (effective !== "panel" || !current || !stage.w) return null;
    const [x0, y0, x1, y1] = current.panels.length
      ? panelViewBox(current, Math.min(panel, current.panels.length - 1))
      : [0, 0, 1, 1];
    // The bars overlay the stage, so while they show, fit the panel between them.
    const top = chrome ? (headerRef.current?.offsetHeight ?? 0) : 0;
    const bottom = chrome ? (footerRef.current?.offsetHeight ?? 0) : 0;
    const availH = Math.max(1, stage.h - top - bottom);
    const baseW = stage.w;
    const baseH = baseW * (current.h / current.w);
    const bw = (x1 - x0) * baseW, bh = (y1 - y0) * baseH;
    const s = Math.min(stage.w / bw, availH / bh) * 0.96;
    const tx = stage.w / 2 - s * (x0 * baseW + bw / 2);
    const ty = top + availH / 2 - s * (y0 * baseH + bh / 2);
    return { baseW, baseH, s, tx, ty, box: [x0, y0, x1, y1] };
  }, [effective, current, stage, panel, chrome]);

  const pageList = useMemo(() => Object.values(pages).sort((a, b) => a.n - b.n), [pages]);
  const status = effective === "panel"
    ? `Page ${page} of ${pageCount}, panel ${panel + 1} of ${panelBoxes.length}`
    : visible.length === 2 ? `Pages ${visible[0]}–${visible[1]} of ${pageCount}` : `Page ${page} of ${pageCount}`;

  return (
    <div
      class={`reader mode-${effective}${chrome ? " chrome-on" : ""}${transcript ? " with-text" : ""}`}
      style={`--badge-w:${badge.w}px;--badge-h:${badge.h}px`}
      data-hydrated={hydrated ? "true" : undefined}
    >
      <header class="chrome top" ref={headerRef}>
        <a class="back" href={`/read/${slug}/`} aria-label={`Book ${bookNo} contents`}>← Book {bookNo}: {title}</a>
        <label class="chapter-select">
          <span class="visually-hidden">Jump to chapter</span>
          <select value={chapter?.n} onChange={(e) => {
            const c = chapters.find((c) => c.n === Number((e.target as HTMLSelectElement).value));
            if (c) goTo(c.startPage);
          }}>
            {chapters.map((c) => <option value={c.n}>{c.title}</option>)}
          </select>
        </label>
        <div class="modes" role="group" aria-label="Reading mode">
          {wide && <button type="button" aria-pressed={effective === "spread"} onClick={() => changeMode("spread")}>Spread</button>}
          <button type="button" aria-pressed={effective === "single"} onClick={() => changeMode("single")}>Page</button>
          <button type="button" aria-pressed={effective === "panel"} onClick={() => changeMode("panel")}>Panels</button>
          <button type="button" aria-pressed={transcript} onClick={() => { setDrawer(null); setTranscript(!transcript); }}>Text</button>
          <button type="button" aria-pressed={notes} onClick={toggleNotes} title="Show notes on the page (n)">Notes</button>
          {journeyHere && <button type="button" aria-pressed={journey} onClick={toggleJourney} title="The journey up the mountain (j)">Journey</button>}
        </div>
      </header>

      <div
        class="stage"
        ref={stageRef}
        tabIndex={0}
        aria-label="Comic page. Use arrow keys to turn pages."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          class={`zoom-layer${zoomed ? " zoomed" : ""}${panning ? " panning" : ""}`}
          style={{ transform: zoomed ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})` : undefined }}
        >
        {effective === "panel" && current ? (
          panelView && (
            <div
              class="panel-world"
              style={{
                width: `${panelView.baseW}px`,
                height: `${panelView.baseH}px`,
                transform: `translate(${panelView.tx}px, ${panelView.ty}px) scale(${panelView.s})`,
              }}
            >
              <PageImage page={current} sizes={`${Math.round(panelView.baseW * panelView.s)}px`} eager />
              <div
                class="panel-focus"
                style={{
                  left: `${panelView.box[0] * 100}%`,
                  top: `${panelView.box[1] * 100}%`,
                  width: `${(panelView.box[2] - panelView.box[0]) * 100}%`,
                  height: `${(panelView.box[3] - panelView.box[1]) * 100}%`,
                }}
              />
              {notes && <Hotspots hotspots={current.hotspots} onOpen={openHotspot} scale={panelView.s * zoom.z} />}
            </div>
          )
        ) : (
          <div class={`pages count-${visible.length}`}>
            {visible.map((n) =>
              pages[n] ? (
                <div class="page-frame" key={n} style={{ "--r": pages[n].w / pages[n].h } as any}>
                  <PageImage
                    page={pages[n]}
                    sizes={visible.length === 2 ? "min(50vw, 63vh)" : "min(100vw, 63vh)"}
                    eager
                  />
                  {notes && <Hotspots hotspots={pages[n].hotspots} onOpen={openHotspot} scale={zoom.z} />}
                </div>
              ) : (
                <div class="page-placeholder" key={n} aria-hidden="true" />
              )
            )}
          </div>
        )}
        </div>

        {atEnd && (
          <div class="end-card" role="dialog" aria-label="End of book">
            <p class="eyebrow">End of Book {bookNo}</p>
            <h2>{title}</h2>
            {next ? (
              <a class="btn" href={`/read/${next.slug}/1`}>Continue to Book {next.book}: {next.title} →</a>
            ) : (
              <p>The end.</p>
            )}
            <a class="btn secondary" href="/read/">All books</a>
          </div>
        )}
      </div>

      <footer class="chrome bottom" ref={footerRef}>
        <button type="button" class="nav prev" onClick={back} disabled={page <= 1 && panel === 0} aria-label="Previous">‹</button>
        <ol class="thumbs" aria-label="Pages">
          {pageList.map((p) => (
            <li key={p.n}>
              <button
                type="button"
                class={visible.includes(p.n) ? "current" : ""}
                aria-current={visible.includes(p.n) ? "page" : undefined}
                aria-label={`Page ${p.n}`}
                onClick={() => goTo(p.n)}
              >
                <img src={pick(p.src.webp, 240)} alt="" loading="lazy" width={60} height={96} />
              </button>
            </li>
          ))}
        </ol>
        <div class="zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out (-)">−</button>
          <button type="button" class="level" onClick={resetZoom} aria-label="Reset zoom" title="Fit to screen (0)">{Math.round(zoom.z * 100)}%</button>
          <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in (+)">+</button>
        </div>
        <button type="button" class="nav next" onClick={forward} aria-label="Next">›</button>
      </footer>

      {transcript && (
        <aside class="transcript" aria-label="Page text">
          {visible.map((n) => (
            <section key={n}>
              <h3>Page {n}</h3>
              {(pages[n]?.text ?? []).length ? (
                <ul>
                  {pages[n]!.text.map((u) => (
                    <li class={`kind-${u.kind}`}><span class="kind">{KIND_LABEL[u.kind]}</span> {u.t}</li>
                  ))}
                </ul>
              ) : <p class="muted">No lettering on this page.</p>}
            </section>
          ))}
        </aside>
      )}

      {journey && journeyHere && <JourneyRail bookNo={bookNo} page={Math.max(...visible)} onClose={toggleJourney} />}

      {drawer && <CodexDrawer targets={drawer.targets} label={drawer.label} onClose={() => { setDrawer(null); stageRef.current?.focus(); }} />}

      <p class="visually-hidden" aria-live="polite">{status}</p>
    </div>
  );
}
