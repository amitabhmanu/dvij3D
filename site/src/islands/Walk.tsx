/** @jsxImportSource preact */
// Walking the valley (design §10.2): the game page's screens and HUD around
// the game. The start screen is all the page loads; three.js, the heights and
// the world arrive only after "Enter the valley" (a dynamic import of
// lib/walk/game).
//
// start -> loading -> ready ("click to start") -> playing
// playing -> paused (Esc, the pause button, or losing the pointer lock)
// playing -> card (E near a place) | map (M) -> playing
//
// Spoilers follow the rest of the site (§5.5): a place's name shows as the
// book's map draws it, and what the book says about it is veiled until the
// reader has read that far. Fast travel goes only to places already reached.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Game, Quality } from "../lib/walk/game";
import { isVeiled, revealAll, type FirstSeen } from "../lib/spoilers";
import { walk } from "../lib/walk/walk-data";

export type WalkPlace = {
  id: string; name: string; fiction: string; book: string; firstSeen: FirstSeen;
  real: { name: string; pin: string; region: string; why: string };
  pages: { book: number; page: number }[];
};
type Props = { heightUrl: string; worldUrl: string; groundUrl: string; mapUrl: string; backUrl: string; places: WalkPlace[] };
type Screen = "start" | "loading" | "ready" | "playing" | "paused" | "card" | "map" | "nogl" | "failed";
type Saved = { sensitivity?: number; invertY?: boolean; quality?: Quality; real?: boolean; volume?: number };

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

/** World x, z to 0-1 across the book's map. */
const onMap = (x: number, z: number): [number, number] => [x / walk.worldWidth + 0.5, z / walk.worldDepth + 0.5];
const spots = new Map(walk.places.map((p) => [p.id, p]));

export default function Walk({ heightUrl, worldUrl, groundUrl, mapUrl, backUrl, places }: Props) {
  const [screen, setScreen] = useState<Screen>("start");
  const [progress, setProgress] = useState({ f: 0, what: "" });
  const [prefs, setPrefs] = useState<Saved>({});
  const [stats, setStats] = useState({ x: 0, z: 0, heading: 0 });
  const [near, setNear] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({}); // spoilers revealed one by one, this visit
  const [veilTick, setVeilTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const compass = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const screenRef = useRef<Screen>("start");
  screenRef.current = screen;
  const nearRef = useRef<string | null>(null);
  nearRef.current = near;

  useEffect(() => {
    setPrefs({ sensitivity: 1, invertY: false, quality: defaultQuality(), real: false, volume: 0.7, ...load() });
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
    if (p.volume !== undefined) g.setVolume(p.volume);
  };

  const veiled = (p: WalkPlace) => !shown[p.id] && isVeiled(p.firstSeen);
  const label = (p: WalkPlace) => (prefs.real ? p.real.pin : p.name);

  const onFrame = (x: number, z: number, heading: number) => {
    // the compass strip slides so the heading sits under its pointer; 4 px a degree
    const deg = ((heading * 180) / Math.PI) % 360;
    if (compass.current) compass.current.style.transform = `translateX(${-deg * 4}px)`;
    if (dot.current) {
      const [u, v] = onMap(x, z);
      dot.current.style.left = `${u * 100}%`;
      dot.current.style.top = `${v * 100}%`;
      dot.current.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    }
  };

  const onStats = (s: { x: number; z: number; heading: number }) => {
    setStats(s);
    let best: string | null = null, bestD = Infinity;
    for (const p of walk.places) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < p.r && d < bestD) { best = p.id; bestD = d; }
    }
    setNear(best);
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
        volume: prefs.volume ?? 0.7,
        onProgress: (f, what) => setProgress({ f, what }),
        onStats, onFrame,
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

  const stop = (next: Screen) => {
    game.current?.pause();
    setScreen(next); // set first, so losing the pointer lock below doesn't read as a pause
    screenRef.current = next;
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const readCard = (id: string) => {
    setOpen(id);
    stop("card");
  };

  const travel = (id: string) => {
    const g = game.current, s = spots.get(id);
    if (!g || !s) return;
    const [x, z] = g.standable(s.x, s.z + Math.min(60, s.r * 0.4)); // a little south of it, looking north at it
    g.teleport(x, z, Math.atan2(s.x - x, -(s.z - z)));
    play();
  };

  useEffect(() => {
    const onLock = () => {
      if (!document.pointerLockElement && screenRef.current === "playing") stop("paused");
    };
    const onKey = (e: KeyboardEvent) => {
      if (screenRef.current === "playing") {
        if (e.code === "Escape") stop("paused");
        else if (e.code === "KeyE" && nearRef.current) readCard(nearRef.current);
        else if (e.code === "KeyM") stop("map");
      } else if ((screenRef.current === "card" || screenRef.current === "map") && (e.code === "Escape" || e.code === "KeyM" || e.code === "KeyE")) {
        e.preventDefault();
        stop("ready"); // back to "click to keep walking", which takes the pointer lock again
      }
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
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
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
  const nearPlace = places.find((p) => p.id === near);
  const card = places.find((p) => p.id === open);
  const hud = screen === "playing";
  void veilTick;

  return (
    <div class="walk" data-screen={screen} data-x={stats.x.toFixed(1)} data-z={stats.z.toFixed(1)} data-heading={deg}
         data-near={near ?? undefined}>
      <canvas ref={canvas} class="walk-canvas" />

      {/* The HUD stays in the page so the frame hook can move it; it shows only while walking. */}
      <div class="hud" hidden={!hud && screen !== "ready"}>
        <div class="compass" aria-hidden="true">
          <div class="strip" ref={compass}>
            {[-1, 0, 1].map((k) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((d, i) => (
              <span key={`${k}${d}`} class={d.length === 1 ? "major" : ""} style={{ left: `${(k * 360 + i * 45) * 4}px` }}>{d}</span>
            )))}
          </div>
          <i class="pointer" />
        </div>
        <div class="minimap" aria-hidden="true">
          <img src={mapUrl} alt="" />
          <span class="me" ref={dot} />
        </div>
        {hud && nearPlace && (
          <button type="button" class="prompt" onClick={() => readCard(nearPlace.id)}>
            <kbd>E</kbd> Read about {label(nearPlace)}
          </button>
        )}
        {hud && (
          <>
            <button type="button" class="map-btn" onClick={() => stop("map")} aria-label="Map">M</button>
            <button type="button" class="pause-btn" onClick={() => stop("paused")} aria-label="Pause">II</button>
          </>
        )}
      </div>

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
          <strong>{stats.x === 0 && stats.z === 0 ? "You're at the Access Road." : "Keep walking"}</strong>
          <span>{touchFirst() ? "Tap to start walking." : "Click to start walking. Esc pauses, M opens the map."}</span>
        </button>
      )}

      {screen === "paused" && (
        <section class="card pause" aria-labelledby="pause-title">
          <h2 id="pause-title">Paused</h2>
          <button type="button" class="go" onClick={play} autofocus>Keep walking</button>
          <label class="check">
            <input type="checkbox" checked={!!prefs.real} onChange={(e) => update({ real: (e.target as HTMLInputElement).checked })} />
            Real India: name places by what they most resemble
          </label>
          <label>Sound
            <input type="range" min="0" max="1" step="0.05" value={prefs.volume ?? 0.7}
                   onInput={(e) => update({ volume: Number((e.target as HTMLInputElement).value) })} />
          </label>
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

      {screen === "card" && card && (
        <section class="card place-card" aria-labelledby="place-title" data-place={card.id} data-veiled={veiled(card) ? "" : undefined}>
          <h2 id="place-title">{label(card)}</h2>
          <p class="fiction">{prefs.real ? `${card.name}: most like ${card.real.name}, ${card.real.region}` : card.fiction}</p>
          {veiled(card) ? (
            <div class="veil-notice" role="note">
              <span>Spoiler: this first comes up in Book {card.firstSeen!.book}, page {card.firstSeen!.page}, further than you've read.</span>
              <span class="acts">
                <button type="button" onClick={() => setShown({ ...shown, [card.id]: true })}>Show it</button>
                <button type="button" onClick={() => { revealAll(); setVeilTick(veilTick + 1); }}>Show all spoilers</button>
              </span>
            </div>
          ) : (
            <>
              <p class="book">{card.book}</p>
              {prefs.real && <p class="why">{card.real.why}</p>}
              {card.pages.length > 0 && (
                <p class="pages">In the comic:{" "}
                  {card.pages.slice(0, 4).map((pg, i) => (
                    <>{i > 0 && " · "}<a href={`/read/b${pg.book}/${pg.page}`} target="_blank" rel="noopener">B{pg.book} p{pg.page}</a></>
                  ))}
                </p>
              )}
            </>
          )}
          <button type="button" class="go" onClick={play} autofocus>Keep walking</button>
        </section>
      )}

      {screen === "map" && (
        <section class="card big-map" aria-labelledby="map-title">
          <h2 id="map-title">The valley</h2>
          <div class="map-frame">
            <img src={mapUrl} alt="The book's map of the valley, with you marked on it." />
            <span class="me" style={{ left: `${onMap(stats.x, stats.z)[0] * 100}%`, top: `${onMap(stats.x, stats.z)[1] * 100}%` }} />
            {places.map((p) => {
              const s = spots.get(p.id);
              if (!s) return null;
              const [u, v] = onMap(s.x, s.z);
              const locked = isVeiled(p.firstSeen) && !shown[p.id];
              return (
                <button type="button" class="spot" key={p.id} style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
                        disabled={locked} data-place={p.id} onClick={() => travel(p.id)}
                        title={locked ? "You haven't reached this in the book yet" : `Go to ${label(p)}`}>
                  {label(p)}
                </button>
              );
            })}
          </div>
          <p class="hint">Pick a place you've reached in the book to go straight there.</p>
          <button type="button" class="go" onClick={play}>Keep walking</button>
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

      {hud && touchFirst() && (
        <div class="stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
          <span style={{ transform: `translate(${knob[0] * 50}px, ${knob[1] * 50}px)` }} />
        </div>
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
      <dt>E</dt><dd>read about the place you're at</dd>
      <dt>M</dt><dd>the map, and travel to places you've read</dd>
      <dt>Esc</dt><dd>pause</dd>
      <dt>On a phone</dt><dd>left thumb walks, drag to look</dd>
    </dl>
  );
}
