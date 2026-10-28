// The story's timeline, for the film bar's slider (the author, 25 Oct): when each beat of a chapter begins and how long
// the chapter runs, as measured by playing it at 1x (scripts/lifelike/timeline.mjs -> story-timeline.json). A chapter
// is not a recording: its beats wait on the words and on his walking, so the slider moves in beats, landing at the
// start of the beat it is let go in, and between beat starts the time runs on from the beat's own start.
export type Timeline = Record<string, { beats: { id: string; at: number }[]; total: number }>;

/** Where the film is (seconds into the chapter) and how long the chapter is, in `beat`, `since` seconds after the beat
 * began; null if the chapter wasn't measured. Held short of the next beat's start if this beat runs long. */
export function positionAt(tl: Timeline, scene: string, beat: string | null, since: number): { at: number; total: number } | null {
  const c = tl[scene];
  if (!c?.beats.length) return null;
  const i = Math.max(0, c.beats.findIndex((b) => b.id === beat));
  const start = c.beats[i].at, next = c.beats[i + 1]?.at ?? c.total;
  return { at: Math.max(start, Math.min(start + Math.max(0, since), next - 0.1)), total: c.total };
}

/** The beat a slider let go at `at` seconds lands in: the last that begins at or before it (the first, before any). */
export function beatAt(tl: Timeline, scene: string, at: number): { id: string; at: number } | null {
  const c = tl[scene];
  if (!c?.beats.length) return null;
  let found = c.beats[0];
  for (const b of c.beats) if (b.at <= at + 1e-6) found = b;
  return found;
}

/** m:ss */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
