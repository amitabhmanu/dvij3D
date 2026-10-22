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
// Story mode (design §10.4, "Play the story" or ?story): the game plays the
// book's scenes, Dvij is the player, and the screen carries the words: captions,
// subtitles, what to do next, chapter cards and the comic's own pages.
// Watch mode ("Watch it play" or ?watch) is the same story playing itself, like
// a film: pause, slow motion, fast forward, chapter back and forward, restart.
//
// Spoilers follow the rest of the site (§5.5): a place's name shows as the
// book's map draws it, and what the book says about it is veiled until the
// reader has read that far. Fast travel goes only to places already reached.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Game, Quality } from "../lib/walk/game";
import { isVeiled, revealAll, type FirstSeen } from "../lib/spoilers";
import { walk } from "../lib/walk/walk-data";
import type { Look } from "../lib/walk/lodge";
import lodgeInfo from "../content/generated/lodge.json";
import siteInfo from "../content/generated/temple-site.json";
import type { Director, Scene } from "../lib/story/director";
import type { StoryStage } from "../lib/story/stage";
import { loadSaved } from "../lib/story/saved";
// (as storyFile in lib/manifest.ts, which this page can't import: it carries every book's manifest)
const storyFile = (name: string) => `${(import.meta.env.PUBLIC_3D_BASE || "/_assets").replace(/\/$/, "")}/story/${name}`;

/** "b1-p004" -> Book 1, page 4. */
const pageRef = (id: string) => ({ book: Number(id.slice(1, id.indexOf("-"))), page: Number(id.slice(id.indexOf("-p") + 2)) });
const PATCH_PAGE = (lodgeInfo.markers as { kind?: string; page?: string }[]).find((m) => m.kind === "spoiler")?.page ?? "b3-p016";

export type WalkPlace = {
  id: string; name: string; fiction: string; book: string; firstSeen: FirstSeen;
  real: { name: string; pin: string; region: string; why: string };
  pages: { book: number; page: number }[];
};
export type StoryPage = { src: string; w: number; h: number; panels: { box: number[]; alt: string }[] };
type Props = { heightUrl: string; worldUrl: string; groundUrl: string; mapUrl: string; backUrl: string; places: WalkPlace[];
               storyPages?: Record<string, StoryPage> };
type Screen = "start" | "loading" | "ready" | "playing" | "paused" | "card" | "look" | "map" | "nogl" | "failed" | "the-end";
/** Story mode's full-screen moments: a chapter card, a comic page, the reflection. */
type Overlay = { kind: "card"; title: string; subtitle?: string } | { kind: "page"; id: string; n: number; of: number } | { kind: "reflection"; panel: string };
const SPEAKER: Record<string, string> = { dvij: "Dvij", professor: "The Professor", bhavi: "Bhavi", maharaj: "Maharaj", mahant: "Mahant", baldev: "Baldev", vaidji: "Vaidji" };
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

export default function Walk({ heightUrl, worldUrl, groundUrl, mapUrl, backUrl, places, storyPages = {} }: Props) {
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
  const [door, setDoor] = useState<{ name: string; open: boolean } | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const [looking, setLooking] = useState<Look | null>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const [indoors, setIndoors] = useState(false);
  const doorRef = useRef(door);
  doorRef.current = door;

  // Story mode
  const [story, setStory] = useState(false);
  const storyRef = useRef(false);
  storyRef.current = story;
  const [saved, setSaved] = useState<{ scene: string; beat?: string } | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [sub, setSub] = useState<{ who: string; line: string } | null>(null);
  const [objective, setObjective] = useState<{ text: string; ready: boolean } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [panel, setPanel] = useState<string | null>(null); // a comic panel held full screen (Chapter 6)
  const [where, setWhere] = useState<{ scene: string; beat: string } | null>(null);
  const director = useRef<Director | null>(null);
  const stage = useRef<StoryStage | null>(null);
  const begun = useRef(false);
  const fromWhere = useRef<{ scene: string; beat?: string } | null>(null);
  /** What a press finishes first: the words or card on screen, if any. */
  const advance = useRef<(() => void) | null>(null);
  const objectiveRef = useRef(objective);
  objectiveRef.current = objective;
  // Watch mode: the story plays itself
  const [watching, setWatching] = useState(false);
  const watchingRef = useRef(false);
  watchingRef.current = watching;
  const [held, setHeld] = useState(false); // paused, with the film bar still showing
  const heldRef = useRef(false);
  heldRef.current = held;
  const [rate, setRate] = useState(1);
  const rateRef = useRef(1);
  rateRef.current = rate;
  const [chapters, setChapters] = useState<{ id: string; title: string }[]>([]);
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const shownId = useRef(0); // which caption, subtitle or overlay is on screen: a newer one isn't hidden by an older one ending

  useEffect(() => {
    setPrefs({ sensitivity: 1, invertY: false, quality: defaultQuality(), real: false, volume: 0.7, ...load() });
    const q = new URLSearchParams(location.search);
    if (q.has("story") || q.has("watch")) setStory(true);
    if (q.has("watch")) setWatching(true);
    setSaved(loadSaved());
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

  const onStats = (s: { x: number; z: number; heading: number; door?: { name: string; open: boolean } | null; indoors?: boolean; look?: Look | null }) => {
    setDoor(s.door ?? null);
    setLook(s.look ?? null);
    setIndoors(!!s.indoors);
    setStats(s);
    let best: string | null = null, bestD = Infinity;
    for (const p of walk.places) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < p.r && d < bestD) { best = p.id; bestD = d; }
    }
    setNear(best);
  };

  const enter = async (asStory = storyRef.current, from: { scene: string; beat?: string } | null = null, watch = watchingRef.current) => {
    storyRef.current = asStory;
    setStory(asStory);
    watchingRef.current = asStory && watch;
    setWatching(asStory && watch);
    fromWhere.current = from;
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
        story: asStory,
        adaptive: !new URLSearchParams(location.search).has("test") || new URLSearchParams(location.search).has("adaptive"),
      });
      if (asStory) await setUpStory(game.current);
      // ?test hands the game to the e2e tests, which can't move a locked mouse
      if (new URLSearchParams(location.search).has("test")) (window as unknown as { walkGame: Game }).walkGame = game.current;
      game.current.settings.sensitivity = prefs.sensitivity ?? 1;
      game.current.settings.invertY = !!prefs.invertY;
      game.current.showPatch(patchShown());
      setScreen("ready");
    } catch (err) {
      console.error("The valley could not load:", err);
      setScreen("failed");
    }
  };

  // ---- story mode -------------------------------------------------------------
  const paused = () => screenRef.current !== "playing" || heldRef.current;
  /** Show something until a press, or for `seconds` of the story's time if given (always, when watching). */
  const until = async (show: () => void, hide: () => void, seconds?: number, watchSeconds = seconds, clip?: HTMLAudioElement) => {
    const { sleep } = await import("../lib/story/stage"); // already loaded with the game
    let pressed = false;
    const id = ++shownId.current;
    // story time this has been showing, for watch mode's longer reads (a comic page)
    let shownFor = 0, last = performance.now();
    const elapsed = () => {
      const now = performance.now();
      if (!paused()) shownFor += ((now - last) / 1000) * rateRef.current;
      last = now;
      return shownFor;
    };
    show();
    const mine = () => { pressed = true; };
    advance.current = mine;
    // a spoken line plays along: it pauses with the story and keeps to its speed (at the same pitch)
    const keepUp = () => {
      if (!clip) return;
      clip.playbackRate = rateRef.current;
      clip.volume = Math.min(1, (prefsRef.current.volume ?? 0.7) * 1.3);
      if (paused() && !clip.paused) clip.pause();
      else if (!paused() && clip.paused && !clip.ended) clip.play().catch(() => {});
    };
    keepUp();
    await sleep(seconds ?? 1e9, paused, () => {
      keepUp();
      return pressed || shownId.current !== id || (watchingRef.current && watchSeconds !== undefined && elapsed() >= watchSeconds);
    }, () => rateRef.current);
    clip?.pause();
    if (advance.current === mine) advance.current = null;
    if (shownId.current === id) hide();
  };
  const readTime = (text: string) => Math.max(2.5, 1.2 + text.split(/\s+/).length * 0.27);
  /** Each character's voice for a line, if it has been made (pipeline/story_voices.py). */
  const voices = useRef<Record<string, { file: string; seconds: number }>>({});
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const setUpStory = async (g: Game) => {
    const [{ Director }, { StoryStage }, data, spoken] = await Promise.all([
      import("../lib/story/director"), import("../lib/story/stage"), import("../content/generated/story.json"),
      import("../content/generated/story-voices.json"),
    ]);
    voices.current = (spoken.default ?? spoken).lines as Record<string, { file: string; seconds: number }>;
    const st = new StoryStage(g, {
      caption: (text) => until(() => setCaption(text), () => setCaption(null), readTime(text)),
      say: (who, line, voice) => {
        const v = voices.current[`${who}|${line}`];
        if (!v) {
          const from = performance.now();
          voice?.(null, () => (performance.now() - from) / 1000);
          return until(() => setSub({ who, line }), () => setSub(null), readTime(line));
        }
        // the words stay while they're spoken, and a moment after
        const clip = new Audio(storyFile(`voices/${v.file}`));
        clip.preservesPitch = true;
        voice?.(v.file, () => clip.currentTime); // (the speaker's mouth keeps to it)
        return until(() => setSub({ who, line }), () => setSub(null), v.seconds + 0.5, undefined, clip);
      },
      objective: (text, ready = false) => setObjective(text ? { text, ready } : null),
      hint: setHint,
      card: (title, subtitle) => until(() => setOverlay({ kind: "card", title, subtitle }), () => setOverlay(null), 4),
      panels: async (pages) => {
        for (let i = 0; i < pages.length; i++) await until(() => setOverlay({ kind: "page", id: pages[i], n: i + 1, of: pages.length }), () => setOverlay(null), undefined, 9);
      },
      reflection: (panel) => until(() => setOverlay({ kind: "reflection", panel }), () => setOverlay(null), 7),
      panel: setPanel,
      ended: (_sc: Scene, next) => {
        if (next) setTimeout(() => director.current?.play(next), 400);
        else { setSaved(null); stop("the-end"); }
      },
      paused,
      rate: () => rateRef.current,
    });
    stage.current = st;
    st.setAuto(watchingRef.current);
    director.current = new Director(st, (data.default ?? data).scenes as unknown as Scene[]);
    setChapters(director.current.order);
    // the screen shows which scene and beat play, for the tests and for anyone curious
    setInterval(() => {
      const c = director.current?.current;
      setWhere((w) => (c && (w?.scene !== c.scene || w?.beat !== c.beat) ? { ...c } : w));
    }, 200);
    if (new URLSearchParams(location.search).has("test")) (window as unknown as { walkStory: unknown }).walkStory = { director: director.current, stage: st };
  };

  /** E, Space or a click while the story plays. */
  const storyPress = () => {
    if (advance.current) return advance.current();
    if (doorRef.current && !objectiveRef.current?.ready) return game.current?.useDoor();
    stage.current?.press();
  };
  const skipScene = () => {
    director.current?.skip();
    advance.current?.();
  };
  // ---- watch mode's film bar -----------------------------------------------------
  /** Clear the words and pictures on screen: a new scene is starting. */
  const clearScreen = () => {
    shownId.current++;
    advance.current?.();
    setCaption(null); setSub(null); setObjective(null); setHint(null); setOverlay(null); setPanel(null);
  };
  const goTo = (id: string) => {
    clearScreen();
    director.current?.play(id);
  };
  // (these run from the key handler, set up once: they read the chapters through a ref)
  const chapterAt = () => chaptersRef.current.findIndex((c) => c.id === director.current?.current?.scene);
  const nextChapter = () => {
    const all = chaptersRef.current, i = chapterAt();
    if (i >= 0 && i + 1 < all.length) goTo(all[i + 1].id);
  };
  const prevChapter = () => goTo(chaptersRef.current[Math.max(0, chapterAt() - 1)].id);
  const restart = () => {
    if (screenRef.current === "the-end") play();
    goTo(chaptersRef.current[0].id);
  };
  const hold = (on: boolean) => {
    heldRef.current = on;
    setHeld(on);
    if (on) game.current?.pause();
    else game.current?.start();
  };
  const speed = (r: number) => {
    rateRef.current = r;
    setRate(r);
    game.current?.body.rate(r);
  };
  const RATES = [0.5, 1, 2, 4];
  const faster = (by: number) => speed(RATES[Math.min(RATES.length - 1, Math.max(0, RATES.indexOf(rateRef.current) + by))]);
  /** Watch it play, or take over and play it yourself (and back). */
  const watch = (on: boolean) => {
    watchingRef.current = on;
    setWatching(on);
    stage.current?.setAuto(on);
    if (on) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      hold(false);
      speed(1);
      if (!touchFirst()) Promise.resolve(canvas.current?.requestPointerLock?.()).catch(() => {});
    }
  };

  const leaveStory = () => {
    director.current?.stop();
    stage.current?.dispose();
    const g = game.current;
    if (g) { g.body.hold("free"); g.body.injured(false); g.body.sight.set({ blur: 0, double: 0, dark: 0, flash: 0, glare: 0 }); }
    storyRef.current = false;
    setStory(false);
    clearScreen();
    watch(false);
    play();
  };

  const play = () => {
    const g = game.current;
    if (!g) return;
    if (storyRef.current && !begun.current && director.current) {
      begun.current = true;
      const from = fromWhere.current;
      setTimeout(() => director.current?.play(from?.scene ?? "b1-ch01", from?.beat), 0);
    }
    heldRef.current = false;
    setHeld(false);
    if (!touchFirst() && !watchingRef.current) {
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

  const lookAt = (l: Look) => {
    setLooking(l);
    stop("look");
  };

  // The back wall's painted patch is a puzzle: shown once the reader has reached it.
  const patchShown = () => !isVeiled(pageRef(PATCH_PAGE));

  const readCard = (id: string) => {
    setOpen(id);
    stop("card");
  };

  const travel = (id: string) => {
    const g = game.current, s = spots.get(id);
    if (g && id === "lodge") { // the lodge's own arrival point: inside its gate, facing the house
      const at = g.lodgePoint("arrive:gate");
      if (at) g.teleport(at[0], at[2], 0);
      play();
      return;
    }
    const st = walk.sites.find((k) => k.id === id);
    if (g && st) { // a built place's own arrival point (the temple site's: south of the tent, facing it)
      const m = (siteInfo.markers as { name: string; at: number[]; heading?: number }[]).find((k) => k.name === "arrive:site");
      if (m) g.teleport(st.x + m.at[0], st.z + m.at[2], ((m.heading ?? 0) * Math.PI) / 180);
      play();
      return;
    }
    if (!g || !s) return;
    const [x, z] = g.standable(s.x, s.z + Math.min(60, s.r * 0.4)); // a little south of it, looking north at it
    g.teleport(x, z, Math.atan2(s.x - x, -(s.z - z)));
    play();
  };

  useEffect(() => {
    const onLock = () => {
      if (!document.pointerLockElement && screenRef.current === "playing" && !watchingRef.current) stop("paused");
    };
    const onKey = (e: KeyboardEvent) => {
      if (screenRef.current === "playing" && watchingRef.current) {
        if (e.code === "Escape") stop("paused");
        else if (e.code === "Space" || e.code === "KeyP") { e.preventDefault(); hold(!heldRef.current); }
        else if (e.code === "ArrowRight" || e.code === "KeyK") nextChapter();
        else if (e.code === "ArrowLeft") prevChapter();
        else if (e.code === "Period" || e.code === "ArrowUp") faster(1);
        else if (e.code === "Comma" || e.code === "ArrowDown") faster(-1);
        else if (e.code === "Home" || e.code === "KeyR") restart();
        else if (e.code === "KeyE" || e.code === "Enter") advance.current?.();
      } else if (screenRef.current === "playing" && storyRef.current) {
        if (e.code === "Escape") stop("paused");
        else if (e.code === "KeyE" || e.code === "Space") { e.preventDefault(); storyPress(); }
        else if (e.code === "KeyK") skipScene();
        else if (e.code === "KeyL") watch(true);
      } else if (screenRef.current === "playing") {
        if (e.code === "Escape") stop("paused");
        else if (e.code === "KeyE" && doorRef.current) game.current?.useDoor(); // a door at hand comes first
        else if (e.code === "KeyE" && lookRef.current) lookAt(lookRef.current);
        else if (e.code === "KeyE" && nearRef.current) readCard(nearRef.current);
        else if (e.code === "KeyM") stop("map");
      } else if ((screenRef.current === "card" || screenRef.current === "map" || screenRef.current === "look") && (e.code === "Escape" || e.code === "KeyM" || e.code === "KeyE")) {
        e.preventDefault();
        stop("ready"); // back to "click to keep walking", which takes the pointer lock again
      }
    };
    // a click while walking with the pointer locked is a press, in story mode
    const onClick = () => {
      if (storyRef.current && screenRef.current === "playing" && document.pointerLockElement) storyPress();
    };
    document.addEventListener("pointerlockchange", onLock);
    addEventListener("keydown", onKey);
    addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      removeEventListener("keydown", onKey);
      removeEventListener("mousedown", onClick);
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
    <div class="walk" data-screen={screen} data-indoors={indoors ? "true" : undefined} data-x={stats.x.toFixed(1)} data-z={stats.z.toFixed(1)} data-heading={deg}
         data-near={near ?? undefined} data-story={story ? where?.scene ?? "" : undefined} data-beat={story ? where?.beat : undefined}
         data-watching={story && watching ? "" : undefined} data-held={held ? "" : undefined} data-rate={story ? rate : undefined}>
      <canvas ref={canvas} class="walk-canvas" />

      {/* a comic panel held full screen while its lines are spoken: under the words and the bar */}
      {story && panel && screen !== "start" && (() => {
        const id = panel.replace(/-\d+$/, ""), k = Number(panel.slice(id.length + 1)) - 1;
        const pg = storyPages[id], box = pg?.panels[k]?.box;
        if (!pg || !box) return null;
        const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
        return (
          <div class="story-panel" data-panel={panel}>
            <span class="panel-frame" style={{ aspectRatio: `${w * pg.w} / ${h * pg.h}`, "--ar": String((w * pg.w) / (h * pg.h)) }}>
              <img src={pg.src} alt={pg.panels[k].alt}
                   style={{ width: `${100 / w}%`, left: `${(-x0 / w) * 100}%`, top: `${(-y0 / h) * 100}%` }} />
            </span>
          </div>
        );
      })()}

      {/* The HUD stays in the page so the frame hook can move it; it shows only while walking. */}
      <div class="hud" hidden={!hud && screen !== "ready"}>
        <div class="compass" aria-hidden="true" hidden={story}>
          <div class="strip" ref={compass}>
            {[-1, 0, 1].map((k) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((d, i) => (
              <span key={`${k}${d}`} class={d.length === 1 ? "major" : ""} style={{ left: `${(k * 360 + i * 45) * 4}px` }}>{d}</span>
            )))}
          </div>
          <i class="pointer" />
        </div>
        <div class="minimap" aria-hidden="true" hidden={story}>
          <img src={mapUrl} alt="" />
          <span class="me" ref={dot} />
        </div>
        {hud && door && !(story && watching) && !objective?.ready && !overlay && (
          <button type="button" class="prompt" onClick={() => game.current?.useDoor()}>
            <kbd>E</kbd> {door.open ? "Shut the door" : "Open the door"}
          </button>
        )}
        {hud && !story && !door && look && (
          <button type="button" class="prompt" onClick={() => lookAt(look)}>
            <kbd>E</kbd> Look at {look.label.replace(/^The /, "the ")}
          </button>
        )}
        {hud && !story && !door && !look && nearPlace && (
          <button type="button" class="prompt" onClick={() => readCard(nearPlace.id)}>
            <kbd>E</kbd> Read about {label(nearPlace)}
          </button>
        )}
        {hud && story && (
          <div class="story">
            {objective && (
              <button type="button" class="objective" data-ready={objective.ready ? "" : undefined} onClick={storyPress}>
                {objective.ready && <kbd>E</kbd>} <span class="what">{objective.text}</span>
              </button>
            )}
            {hint && <p class="story-hint">{hint}</p>}
            {(caption || sub) && (
              <button type="button" class="words" onClick={storyPress} aria-live="polite">
                {caption && <span class="caption">{caption}</span>}
                {sub && <span class="subtitle"><b>{SPEAKER[sub.who] ?? sub.who}:</b> {sub.line}</span>}
              </button>
            )}
            {!watching && (
              <span class="story-acts">
                <button type="button" class="skip" onClick={() => watch(true)}>Let it play <kbd>L</kbd></button>
                <button type="button" class="skip" onClick={skipScene}>Skip scene <kbd>K</kbd></button>
              </span>
            )}
          </div>
        )}
        {hud && story && watching && (() => {
          const i = chapterAt();
          return (
            <div class="film-bar" role="toolbar" aria-label="The story's controls">
              <button type="button" onClick={restart} aria-label="From the beginning" title="From the beginning (R)">⏮</button>
              <button type="button" onClick={prevChapter} aria-label="Previous chapter" title="Previous chapter (←)">«</button>
              <button type="button" class="big" onClick={() => hold(!held)} aria-label={held ? "Play" : "Pause"} title={`${held ? "Play" : "Pause"} (Space)`}>
                {held ? "▶" : "❚❚"}
              </button>
              <button type="button" onClick={nextChapter} disabled={i + 1 >= chapters.length} aria-label="Next chapter" title="Next chapter (→)">»</button>
              <span class="speeds" role="group" aria-label="Speed">
                {RATES.map((r) => (
                  <button type="button" key={r} aria-pressed={rate === r} onClick={() => speed(r)} title={r < 1 ? "Slow motion" : r > 1 ? "Fast forward" : "Normal speed"}>
                    {r === 0.5 ? "½" : r}×
                  </button>
                ))}
              </span>
              <span class="now">{chapters[i]?.title ?? ""}</span>
              <button type="button" class="take" onClick={() => watch(false)}>Play it yourself</button>
            </div>
          );
        })()}
        {hud && (
          <>
            {!story && <button type="button" class="map-btn" onClick={() => stop("map")} aria-label="Map">M</button>}
            {story && watching
              ? <button type="button" class="pause-btn" onClick={() => stop("paused")} aria-label="Menu" title="Menu: sound, quality, leave the story (Esc)">☰</button>
              : <button type="button" class="pause-btn" onClick={() => stop("paused")} aria-label="Pause">II</button>}
          </>
        )}
      </div>

      {screen === "start" && (
        <section class="card start" aria-labelledby="walk-title">
          <p class="eyebrow">The Twice Born</p>
          <h1 id="walk-title">Walk the valley</h1>
          <p>The valley from the book's own map, at full size: ten kilometres of it, from the Access Road to the
            top of Mount Dronagiri.</p>
          <button type="button" class="go" onClick={() => enter(false)} autofocus={!story}>Enter the valley</button>
          <div class="story-start">
            <p class="eyebrow">Or play the story</p>
            <p>Be Dvij, waking in the Professor's lodge after the accident: the chapters of Book 1 he is in, from 1 to 9.</p>
            {saved ? (
              <>
                <button type="button" class="go" onClick={() => enter(true, saved, false)} autofocus={story && !watching}>Continue the story</button>
                <button type="button" class="go quiet" onClick={() => enter(true, null, false)}>Start from the beginning</button>
              </>
            ) : (
              <button type="button" class="go" onClick={() => enter(true, null, false)} autofocus={story && !watching}>Play the story</button>
            )}
            <button type="button" class="go quiet" onClick={() => enter(true, null, true)} autofocus={watching}>Watch it play, like a film</button>
          </div>
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
          {story ? (
            <>
              <strong>{begun.current ? "Carry on" : watching ? "The story plays by itself." : "You are Dvij."}</strong>
              <span>{watching ? "Click to start. Space pauses, the arrows change chapter, < and > change the speed."
                : touchFirst() ? "Tap to begin. Tap the words to move them on." : "Click to begin. E, Space or a click does what the story asks; Esc pauses."}</span>
            </>
          ) : (
            <>
              <strong>{stats.x === 0 && stats.z === 0 ? "You're at the Access Road." : "Keep walking"}</strong>
              <span>{touchFirst() ? "Tap to start walking." : "Click to start walking. Esc pauses, M opens the map."}</span>
            </>
          )}
        </button>
      )}

      {screen === "paused" && (
        <section class="card pause" aria-labelledby="pause-title">
          <h2 id="pause-title">Paused</h2>
          <button type="button" class="go" onClick={play} autofocus>{story ? "Carry on with the story" : "Keep walking"}</button>
          {story && <button type="button" class="go quiet" onClick={leaveStory}>Leave the story and walk freely</button>}
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

      {screen === "look" && looking && (() => {
        const first = looking.pages[0] ? pageRef(looking.pages[0]) : null;
        const hidden = !!first && !shown[`look:${looking.id}`] && isVeiled(first);
        return (
          <section class="card place-card" aria-labelledby="look-title" data-look={looking.id} data-veiled={hidden ? "" : undefined}>
            <h2 id="look-title">{looking.label}</h2>
            {hidden ? (
              <div class="veil-notice" role="note">
                <span>Spoiler: this first comes up in Book {first!.book}, page {first!.page}, further than you've read.</span>
                <span class="acts">
                  <button type="button" onClick={() => setShown({ ...shown, [`look:${looking.id}`]: true })}>Show it</button>
                  <button type="button" onClick={() => { revealAll(); setVeilTick(veilTick + 1); game.current?.showPatch(patchShown()); }}>Show all spoilers</button>
                </span>
              </div>
            ) : (
              <>
                <p class="book">{looking.text}</p>
                <p class="pages">In the comic:{" "}
                  {looking.pages.map((id, i) => {
                    const r = pageRef(id);
                    return <>{i > 0 && " · "}<a href={`/read/b${r.book}/${r.page}`} target="_blank" rel="noopener">B{r.book} p{r.page}</a></>;
                  })}
                </p>
              </>
            )}
            <button type="button" class="go" onClick={play} autofocus>Keep walking</button>
          </section>
        );
      })()}

      {screen === "card" && card && (
        <section class="card place-card" aria-labelledby="place-title" data-place={card.id} data-veiled={veiled(card) ? "" : undefined}>
          <h2 id="place-title">{label(card)}</h2>
          <p class="fiction">{prefs.real ? `${card.name}: most like ${card.real.name}, ${card.real.region}` : card.fiction}</p>
          {veiled(card) ? (
            <div class="veil-notice" role="note">
              <span>Spoiler: this first comes up in Book {card.firstSeen!.book}, page {card.firstSeen!.page}, further than you've read.</span>
              <span class="acts">
                <button type="button" onClick={() => setShown({ ...shown, [card.id]: true })}>Show it</button>
                <button type="button" onClick={() => { revealAll(); setVeilTick(veilTick + 1); game.current?.showPatch(patchShown()); }}>Show all spoilers</button>
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
            {(() => {
              const [u, v] = onMap(walk.lodge.x, walk.lodge.z);
              return (
                <button type="button" class="spot" style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
                        data-place="lodge" onClick={() => travel("lodge")} title="Go to the Professor's lodge">
                  The Professor's lodge
                </button>
              );
            })()}
            {walk.sites.map((st) => {
              // the temple site: on the map once the reader has reached it in the book (Chapter 9, page 14)
              const [u, v] = onMap(st.x, st.z);
              const locked = isVeiled({ book: 1, page: 14 }) && !shown[st.id];
              return (
                <button type="button" class="spot" key={st.id} style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
                        disabled={locked} data-place={st.id} onClick={() => travel(st.id)}
                        title={locked ? "You haven't reached this in the book yet" : "Go to the temple site"}>
                  The temple site
                </button>
              );
            })}
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

      {hud && story && overlay && (
        <button type="button" class={`story-overlay is-${overlay.kind}`} onClick={storyPress} data-overlay={overlay.kind}>
          {overlay.kind === "card" && (
            <span class="chapter-card"><strong>{overlay.title}</strong>{overlay.subtitle && <em>{overlay.subtitle}</em>}</span>
          )}
          {overlay.kind === "page" && storyPages[overlay.id] && (
            <span class="comic-page">
              <img src={storyPages[overlay.id].src} alt={storyPages[overlay.id].panels.map((p) => p.alt).join(" ")}
                   width={storyPages[overlay.id].w} height={storyPages[overlay.id].h} />
              <span class="turn">Page {overlay.n} of {overlay.of}. {touchFirst() ? "Tap" : "Press E"} to turn.</span>
            </span>
          )}
          {overlay.kind === "reflection" && (() => {
            const id = overlay.panel.replace(/-\d+$/, ""), k = Number(overlay.panel.slice(id.length + 1)) - 1;
            const pg = storyPages[id], box = pg?.panels[k]?.box;
            if (!pg || !box) return null;
            const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
            return (
              <span class="reflection-frame" style={{ aspectRatio: `${w * pg.w} / ${h * pg.h}` }}>
                <img src={pg.src} alt={pg.panels[k].alt}
                     style={{ width: `${100 / w}%`, left: `${(-x0 / w) * 100}%`, top: `${(-y0 / h) * 100}%` }} />
              </span>
            );
          })()}
        </button>
      )}

      {screen === "the-end" && (
        <section class="card" aria-labelledby="end-title">
          <p class="eyebrow">The Twice Born, Book 1</p>
          <h2 id="end-title">To be continued</h2>
          <p>That's as far as the story plays for now: the opening of Book 1, up to Chapter 9. The comic carries on from page 16.</p>
          <a class="go" href="/read/b1/16">Read on in the comic</a>
          {watching && <button type="button" class="go quiet" onClick={restart}>Watch it again</button>}
          <button type="button" class="go quiet" onClick={leaveStory}>Walk the valley freely</button>
          <p class="back"><a href={backUrl}>Back to the map</a></p>
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
          <button type="button" class="go" onClick={() => enter()}>Try again</button>
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
