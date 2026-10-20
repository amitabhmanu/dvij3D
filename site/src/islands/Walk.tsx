/** @jsxImportSource preact */
// Walking the valley (design §10.2): the game page's screens around the game.
// The start screen is all the page loads; three.js, the heights and the world
// arrive only after "Enter the valley" (a dynamic import of lib/walk/game).
//
// start -> loading -> ready ("click to start") -> playing <-> paused
// Esc, or losing the pointer lock, pauses. Without WebGL2 the start screen says
// so and points back to the map.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Game, Quality } from "../lib/walk/game";

type Props = { heightUrl: string; worldUrl: string; groundUrl: string; backUrl: string };
type Screen = "start" | "loading" | "ready" | "playing" | "paused" | "nogl" | "failed";
type Saved = { sensitivity?: number; invertY?: boolean; quality?: Quality };

const KEY = "twice-born:walk:v1";
const load = (): Saved => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

const hasWebGL2 = () => {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
};
const touchFirst = () => matchMedia("(pointer: coarse)").matches;
const defaultQuality = (): Quality => (touchFirst() ? "low" : innerWidth * devicePixelRatio > 2600 ? "high" : "medium");

export default function Walk({ heightUrl, worldUrl, groundUrl, backUrl }: Props) {
  const [screen, setScreen] = useState<Screen>("start");
  const [progress, setProgress] = useState({ f: 0, what: "" });
  const [prefs, setPrefs] = useState<Saved>({});
  const [stats, setStats] = useState({ x: 0, z: 0, heading: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const screenRef = useRef<Screen>("start");
  screenRef.current = screen;

  useEffect(() => {
    setPrefs({ sensitivity: 1, invertY: false, quality: defaultQuality(), ...load() });
    return () => game.current?.dispose();
  }, []);

  const update = (p: Saved) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    save(next);
    const g = game.current;
    if (!g) return;
    g.settings.sensitivity = next.sensitivity ?? 1;
    g.settings.invertY = !!next.invertY;
    if (p.quality) g.setQuality(p.quality);
  };

  const enter = async () => {
    if (!hasWebGL2()) return setScreen("nogl");
    setScreen("loading");
    try {
      const { createGame } = await import("../lib/walk/game");
      game.current = await createGame({
        canvas: canvas.current!,
        heightUrl, worldUrl, groundUrl,
        quality: prefs.quality ?? defaultQuality(),
        onProgress: (f, what) => setProgress({ f, what }),
        onStats: (s) => setStats(s),
      });
      // ?test hands the game to the e2e tests, which can't move a locked mouse
      if (new URLSearchParams(location.search).has("test")) (window as unknown as { walkGame: Game }).walkGame = game.current;
      game.current.settings.sensitivity = prefs.sensitivity ?? 1;
      game.current.settings.invertY = !!prefs.invertY;
      setScreen("ready");
    } catch (err) {
      console.error("The valley could not load:", err);
      setScreen("failed");
    }
  };

  const play = () => {
    const g = game.current;
    if (!g) return;
    if (!touchFirst()) {
      // Ask for the pointer lock; if the browser says no, dragging still looks around.
      Promise.resolve(canvas.current?.requestPointerLock?.()).catch(() => {});
    }
    g.start();
    setScreen("playing");
  };

  const pause = () => {
    game.current?.pause();
    if (document.pointerLockElement) document.exitPointerLock();
    setScreen("paused");
  };

  useEffect(() => {
    const onLock = () => {
      if (!document.pointerLockElement && screenRef.current === "playing") pause();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && screenRef.current === "playing") pause();
    };
    document.addEventListener("pointerlockchange", onLock);
    addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      removeEventListener("keydown", onKey);
    };
  }, []);

  // A thumb joystick for touch screens.
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const stickDown = (e: PointerEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    stick.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    stickMove(e);
  };
  const stickMove = (e: PointerEvent) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = (e.clientX - s.x) / 50, dy = (e.clientY - s.y) / 50;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    setKnob([dx, dy]);
    game.current?.input.setStick(dx, -dy);
  };
  const stickUp = () => {
    stick.current = null;
    setKnob([0, 0]);
    game.current?.input.setStick(0, 0);
  };

  const deg = Math.round((((stats.heading * 180) / Math.PI) % 360 + 360) % 360);

  return (
    <div class="walk" data-screen={screen} data-x={stats.x.toFixed(1)} data-z={stats.z.toFixed(1)} data-heading={deg}>
      <canvas ref={canvas} class="walk-canvas" />

      {screen === "start" && (
        <section class="card start" aria-labelledby="walk-title">
          <p class="eyebrow">The Twice Born</p>
          <h1 id="walk-title">Walk the valley</h1>
          <p>The valley from the book's own map, at full size: ten kilometres of it, from the Access Road to the
            top of Mount Dronagiri.</p>
          <button type="button" class="go" onClick={enter} autofocus>Enter the valley</button>
          <Controls />
          <p class="back"><a href={backUrl}>Back to the map</a></p>
        </section>
      )}

      {screen === "loading" && (
        <section class="card" role="status" aria-live="polite">
          <h2>{progress.what || "Unrolling the map"}…</h2>
          <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.f * 100)}>
            <span style={{ width: `${Math.round(progress.f * 100)}%` }} />
          </div>
        </section>
      )}

      {screen === "ready" && (
        <button type="button" class="card begin" onClick={play} autofocus>
          <strong>You're at the Access Road.</strong>
          <span>{touchFirst() ? "Tap to start walking." : "Click to start walking. Esc pauses."}</span>
        </button>
      )}

      {screen === "paused" && (
        <section class="card pause" aria-labelledby="pause-title">
          <h2 id="pause-title">Paused</h2>
          <button type="button" class="go" onClick={play} autofocus>Keep walking</button>
          <label>Mouse sensitivity
            <input type="range" min="0.3" max="2.5" step="0.1" value={prefs.sensitivity ?? 1}
                   onInput={(e) => update({ sensitivity: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="check">
            <input type="checkbox" checked={!!prefs.invertY} onChange={(e) => update({ invertY: (e.target as HTMLInputElement).checked })} />
            Invert looking up and down
          </label>
          <label>Quality
            <select value={prefs.quality} onChange={(e) => update({ quality: (e.target as HTMLSelectElement).value as Quality })}>
              <option value="low">Low (phones, older laptops)</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <Controls />
          <p class="back"><a href={backUrl}>Leave the valley</a></p>
        </section>
      )}

      {screen === "nogl" && (
        <section class="card" role="alert">
          <h2>This browser can't draw the valley in 3D.</h2>
          <p>Walking needs WebGL 2, which this browser or device doesn't offer. The book's map is still here.</p>
          <p class="back"><a href={backUrl}>Back to the map</a></p>
        </section>
      )}

      {screen === "failed" && (
        <section class="card" role="alert">
          <h2>The valley didn't load.</h2>
          <button type="button" class="go" onClick={enter}>Try again</button>
          <p class="back"><a href={backUrl}>Back to the map</a></p>
        </section>
      )}

      {screen === "playing" && (
        <>
          <button type="button" class="pause-btn" onClick={pause} aria-label="Pause">II</button>
          {touchFirst() && (
            <div class="stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
              <span style={{ transform: `translate(${knob[0] * 50}px, ${knob[1] * 50}px)` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Controls() {
  return (
    <dl class="controls">
      <dt>W A S D or arrows</dt><dd>walk</dd>
      <dt>Shift</dt><dd>run</dd>
      <dt>Mouse</dt><dd>look around</dd>
      <dt>Esc</dt><dd>pause</dd>
      <dt>On a phone</dt><dd>left thumb walks, drag to look</dd>
    </dl>
  );
}
