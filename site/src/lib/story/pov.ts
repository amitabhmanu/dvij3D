// Story mode's points of view (design §10.4, multi-POV film mode): the same
// scenes watched through someone else's eyes.
//
// There is one script per chapter. A film is those scripts filtered to one
// person: the scenes they are in, in book order, and in each scene the beats
// they are there for. Who is in a beat is worked out from the script itself
// (the cast, Dvij unless the scene leaves him out, `enters` and `exit` on the
// actors); content/story/pov.yaml adds only what a script can't say.
//
// A film's scenes are ordinary scenes, so the director plays them unchanged:
// a beat its person isn't there for is marked `offstage` and played hurried
// (its props and poses happen, its words and waits don't), and each scene's
// end points at the film's next scene.
import type { Action, Beat, Scene } from "./director";

export type When = { day: number; time: string; with?: string };
export type Pov = {
  films: Record<string, { name: string; pilot?: boolean; scenes?: string[] }>;
  times: string[];
  scenes: Record<string, { when: When; absent?: string[]; present?: string[]; meanwhile?: string }>;
  beats?: Record<string, { for?: string[]; "not-for"?: string[]; "captions-for"?: string[] }>;
};
export type FilmBeat = Beat & { offstage?: boolean };
export type FilmScene = Scene & { beats: FilmBeat[] };

/** How one scene of a film leads into the next. */
export type Join =
  | { kind: "walk"; from: string; to: string }             // a short gap, same day: he walks it, sped up
  | { kind: "fade"; from: string; to: string; card: string }   // later, or somewhere not built
  | { kind: "end"; from: string; card: string };            // the film is over (for now)

export type Film = { who: string; scenes: FilmScene[]; joins: Join[]; missed: Record<string, string[]> };

const actions = (b: Beat): Action[] => [...(b.do ?? []), ...(b.then ?? [])];

/** Every actor direction in a beat, its nested `then`s included, each with whom it moves. */
function directions(b: Beat): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const a of actions(b)) {
    if (!a.actor) continue;
    const who = (a.actor as { who: string }).who;
    for (let d: unknown = a.actor; d && typeof d === "object"; d = (d as { then?: unknown }).then) out.push({ ...(d as object), who });
  }
  return out;
}

/** Who is in each beat of a scene, before pov.yaml's per-beat `for` and `not-for`. */
export function presence(sc: Scene, pov: Pov): Map<string, Set<string>> {
  const info = pov.scenes[sc.scene] ?? {};
  const here = new Set<string>();
  const waiting = new Set<string>(); // cast who come in later
  if (sc.start.pose !== "interlude" && !info.absent?.includes("dvij")) here.add("dvij");
  for (const c of sc.cast ?? []) if (!info.absent?.includes(c.who)) (c.enters ? waiting : here).add(c.who);
  for (const who of info.present ?? []) here.add(who);
  const gone = new Set<string>();
  const out = new Map<string, Set<string>>();
  for (const b of sc.beats) {
    for (const d of directions(b)) {
      const who = d.who as string;
      if (waiting.delete(who) || (gone.has(who) && (d.from || d.show))) { gone.delete(who); here.add(who); }
    }
    out.set(b.id, new Set(here)); // someone who leaves in a beat is still in it
    for (const d of directions(b)) if (d.exit) { here.delete(d.who as string); gone.add(d.who as string); }
  }
  return out;
}

/** Does `who`'s film play this beat? */
export function plays(sc: Scene, beat: Beat, who: string, pov: Pov, there = presence(sc, pov)): boolean {
  const tag = pov.beats?.[`${sc.scene}#${beat.id}`];
  if (tag?.for) return tag.for.includes(who);
  if (tag?.["not-for"]?.includes(who)) return false;
  return there.get(beat.id)?.has(who) ?? false;
}

const hour = (w: When, pov: Pov) => w.day * 24 + pov.times.indexOf(w.time) * 3;

/** How a film gets from one of its scenes to the next. */
export function join(a: Scene, b: Scene, pov: Pov): Join {
  const wa = pov.scenes[a.scene]?.when, wb = pov.scenes[b.scene]?.when;
  if (!wa || !wb) return { kind: "fade", from: a.scene, to: b.scene, card: "Later" };
  const days = wb.day - wa.day;
  const sameWorld = (a.start.pose !== "interlude") && (b.start.pose !== "interlude");
  if (days === 0 && hour(wb, pov) - hour(wa, pov) <= 3 && sameWorld) return { kind: "walk", from: a.scene, to: b.scene };
  const card = days === 0 ? "Later that day" : days === 1 ? "The next day" : "Some days later";
  return { kind: "fade", from: a.scene, to: b.scene, card };
}

/** A beat whose captions are only for some films, without them in the others. */
function captioned(sc: Scene, b: Beat, who: string, pov: Pov): FilmBeat {
  const only = pov.beats?.[`${sc.scene}#${b.id}`]?.["captions-for"];
  if (!only || only.includes(who)) return { ...b };
  const drop = (list?: Action[]) => list?.filter((a) => !("caption" in a));
  return { ...b, do: drop(b.do), then: drop(b.then) };
}

/** Rewrite where a scene's `end` leads. */
function endsAt(beats: FilmBeat[], next: string | null): FilmBeat[] {
  const fix = (list?: Action[]) => list?.map((a) => ("end" in a ? { end: { ...(a.end as object), next } } : a));
  return beats.map((b) => ({ ...b, do: fix(b.do), then: fix(b.then) }));
}

/** `who`'s film: every scene they are in, in book order, cut to their beats. */
export function film(who: string, all: Scene[], pov: Pov): Film {
  const order = [...all].sort((x, y) => x.scene.localeCompare(y.scene, "en", { numeric: true }));
  const only = pov.films[who]?.scenes;
  const picked: { sc: Scene; beats: FilmBeat[] }[] = [];
  const missed: Record<string, string[]> = {};
  let skipped: string[] = [];
  for (const sc of order) {
    const there = presence(sc, pov);
    const beats = sc.beats.map((b) => (plays(sc, b, who, pov, there) ? captioned(sc, b, who, pov) : { ...b, offstage: true }));
    if ((only && !only.includes(sc.scene)) || beats.every((b) => b.offstage)) { skipped.push(sc.scene); continue; }
    if (picked.length) missed[sc.scene] = skipped;
    skipped = [];
    picked.push({ sc, beats });
  }
  const joins: Join[] = [];
  const scenes = picked.map(({ sc, beats }, i) => {
    const next = picked[i + 1]?.sc ?? null;
    joins.push(next ? join(sc, next, pov) : { kind: "end", from: sc.scene, card: endCard(who, sc, order, pov) });
    return { ...sc, beats: endsAt(meanwhile(beats, missed[sc.scene] ?? [], pov), next?.scene ?? null) };
  });
  return { who, scenes, joins, missed };
}

/** A card for what happened while the film was away (pov.yaml's `meanwhile`), before the scene's first words. */
function meanwhile(beats: FilmBeat[], missed: string[], pov: Pov): FilmBeat[] {
  const cards = missed.map((s) => pov.scenes[s]?.meanwhile).filter((c): c is string => !!c);
  const first = beats.findIndex((b) => !b.offstage);
  if (!cards.length || first < 0) return beats;
  return beats.map((b, i) => (i === first ? { ...b, do: [...cards.map((c) => ({ caption: c })), ...(b.do ?? [])] } : b));
}

/** The last card of a film that stops before the story does. */
function endCard(who: string, last: Scene, order: Scene[], pov: Pov): string {
  const name = pov.films[who]?.name ?? who;
  const later = order.slice(order.indexOf(last) + 1).find((sc) => sc.beats.some((b) => plays(sc, b, who, pov)));
  return later ? `${name}'s story continues in ${later.title}.` : "The end.";
}

/** Who is in the beat now playing, for the pause menu's "Whose eyes". */
export function inBeat(sc: Scene, beatId: string, pov: Pov): string[] {
  const beat = sc.beats.find((b) => b.id === beatId);
  return beat ? Object.keys(pov.films).filter((who) => plays(sc, beat, who, pov)) : [];
}

/**
 * Switching to `who`'s film from a scene and beat (design §10.4): the same beat if
 * they are in it, the scene happening alongside if there is one, else their next
 * scene (or, with `back`, their last).
 */
export function switchTo(who: string, at: { scene: string; beat?: string }, all: Scene[], pov: Pov, back = false): { scene: string; beat?: string } | null {
  const f = film(who, all, pov);
  const ids = f.scenes.map((s) => s.scene);
  const sc = all.find((s) => s.scene === at.scene);
  if (sc && ids.includes(sc.scene)) {
    const beat = f.scenes[ids.indexOf(sc.scene)].beats.find((b) => b.id === at.beat);
    if (beat && !beat.offstage) return { scene: sc.scene, beat: beat.id };
  }
  // the scene happening alongside this one (Ch 2 runs while Dvij wanders in Ch 1)
  const partner = pov.scenes[at.scene]?.when.with ?? Object.keys(pov.scenes).find((s) => pov.scenes[s].when.with === at.scene);
  if (partner && ids.includes(partner)) return { scene: partner };
  const order = [...all].map((s) => s.scene).sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  const here = order.indexOf(at.scene);
  const later = ids.filter((s) => order.indexOf(s) > here);
  const earlier = ids.filter((s) => order.indexOf(s) <= here);
  const pick = back ? earlier.at(-1) ?? later[0] : later[0] ?? earlier.at(-1);
  return pick ? { scene: pick } : null;
}
