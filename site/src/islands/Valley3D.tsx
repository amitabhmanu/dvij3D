/** @jsxImportSource preact */
// The valley in 3D (design §10.1): a Map / 3D switch above the book's map, and
// the flyover itself. The flat map stays the default and the fallback. three.js
// and the terrain load only when a reader opens the 3D view (a dynamic import
// of lib/valley3d/scene), so the page's first load is the same as before.
//
// - #3d opens the 3D view directly.
// - Without WebGL2 the switch says so and the flat map stays.
// - Labels are real buttons: Tab reaches every place, Enter flies there.
// - Arrow keys orbit, + and - zoom, Home goes back to the start.
// - prefers-reduced-motion turns every flight into a cut.
// - Spoilers follow the flat map exactly: labels name their places, as the
//   drawn map does, and what the reader hasn't reached stays veiled in each
//   place's card. The Real India button renames the labels as it does the pins.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Valley } from "../lib/valley3d/scene";
import type { Vec3 } from "../lib/valley3d/camera";
import { labelText } from "../lib/valley3d/veil";

export type Place3D = { id: string; name: string; pin: string; fiction: string };
type Props = { heightUrl: string; drapeUrl: string; posterUrl: string; places: Place3D[] };
type Status = "idle" | "loading" | "ready" | "nogl" | "lost" | "failed";
type Saved = { camera?: { position: Vec3; target: Vec3 } };

const KEY = "twice-born:valley3d:v1";
const load = (): Saved => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

const flatMap = () => document.querySelector<HTMLElement>(".mapfig");

export default function Valley3D({ heightUrl, drapeUrl, posterUrl, places }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<"map" | "3d">("map");
  const [status, setStatus] = useState<Status>("idle");
  const [picked, setPicked] = useState<string | null>(null);
  const [flying, setFlying] = useState(false);
  const [real, setReal] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const valley = useRef<Valley | null>(null);

  const start = async () => {
    if (!canvas.current) return;
    setStatus("loading");
    try {
      const { createValley } = await import("../lib/valley3d/scene");
      valley.current?.dispose();
      valley.current = await createValley({
        canvas: canvas.current,
        labels: labels.current,
        heightUrl,
        drapeUrl,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        phone: matchMedia("(max-width: 640px), (pointer: coarse)").matches,
        start: load().camera,
        onReady: () => setStatus("ready"),
        onCamera: (camera) => save({ ...load(), camera }),
        onLost: () => setStatus("lost"),
        onFlight: setFlying,
      });
    } catch (err) {
      console.error("The 3D valley could not start:", err);
      setStatus("failed");
    }
  };

  const open = () => {
    if (!hasWebGL2()) {
      setStatus("nogl");
      return;
    }
    flatMap()?.setAttribute("hidden", "");
    setView("3d");
    if (location.hash !== "#3d") history.replaceState(null, "", "#3d");
  };

  const close = () => {
    valley.current?.dispose();
    valley.current = null;
    flatMap()?.removeAttribute("hidden");
    setView("map");
    setStatus("idle");
    setPicked(null);
    if (location.hash === "#3d") history.replaceState(null, "", location.pathname);
  };

  useEffect(() => {
    setHydrated(true);
    if (location.hash === "#3d") open();
    // Follow the page's Real India toggle (a plain script sets #map[data-real]).
    const read = () => setReal(document.getElementById("map")?.getAttribute("data-real") === "on");
    read();
    const watch = new MutationObserver(read);
    const map = document.getElementById("map");
    if (map) watch.observe(map, { attributes: true, attributeFilter: ["data-real"] });
    return () => {
      watch.disconnect();
      valley.current?.dispose();
    };
  }, []);

  // A label's width changes with its text, so place the labels again.
  useEffect(() => valley.current?.refreshLabels(), [real]);

  // The canvas exists once the 3D view renders, so start from here.
  useEffect(() => {
    if (view === "3d" && status === "idle") start();
  }, [view, status]);

  const pick = (id: string) => {
    setPicked(id);
    valley.current?.flyTo(id);
  };

  const onKey = (e: KeyboardEvent) => {
    const v = valley.current;
    if (!v || e.target !== e.currentTarget) return;
    const step = 0.12;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => v.orbit(step, 0),
      ArrowRight: () => v.orbit(-step, 0),
      ArrowUp: () => v.orbit(0, -step / 2),
      ArrowDown: () => v.orbit(0, step / 2),
      "+": () => v.zoom(0.85),
      "=": () => v.zoom(0.85),
      "-": () => v.zoom(1.18),
      Home: () => v.reset(),
    };
    const act = keys[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  };

  const chosen = places.find((p) => p.id === picked);

  return (
    <div class="valley-3d" data-hydrated={hydrated ? "true" : undefined} data-view={view}
         data-ready={status === "ready" ? "true" : undefined} data-flying={flying ? "true" : undefined}>
      <div class="views" role="group" aria-label="How to see the valley">
        <button type="button" class="chip" aria-pressed={view === "map"} onClick={() => view === "3d" && close()}>Map</button>
        <button type="button" class="chip" aria-pressed={view === "3d"} onClick={() => view === "map" && open()}>3D</button>
        {status === "nogl" && (
          <p class="v3d-note" role="status">This browser can't draw the valley in 3D, so here is the book's map.</p>
        )}
      </div>

      {view === "3d" && (
        <div class="stage">
          <img class="poster" src={posterUrl} alt="" width="1200" height="813" />
          <div class="land" tabIndex={0} onKeyDown={onKey}
               aria-label="The valley in 3D. Drag or use the arrow keys to look around, + and - to zoom, Home to start again. The places are the buttons that follow.">
            <canvas ref={canvas} />
          </div>
          <div class="v3d-labels">
            {places.map((p) => {
              const l = labelText(p, real);
              return (
                <button type="button" class="v3d-label" data-place={p.id} key={p.id} aria-label={l.aria}
                        ref={(el) => { if (el) labels.current.set(p.id, el); else labels.current.delete(p.id); }}
                        aria-pressed={picked === p.id} onClick={() => pick(p.id)}>
                  {l.text}
                </button>
              );
            })}
          </div>
          {status === "loading" && <p class="v3d-status" role="status">Raising the valley…</p>}
          {status === "failed" && <p class="v3d-status" role="alert">The 3D valley didn't load. <button type="button" onClick={close}>Back to the map</button></p>}
          {status === "lost" && (
            <p class="v3d-status" role="alert">The 3D view was interrupted.{" "}
              <button type="button" onClick={() => { setStatus("loading"); start(); }}>Draw it again</button>
            </p>
          )}
          {chosen && (
            <div class="v3d-caption" role="status">
              <strong>{chosen.name}</strong>{" "}
              <span>{real ? `is most like ${chosen.pin}` : chosen.fiction}</span>{" "}
              <a href={`#${chosen.id}`}>Read about it</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
