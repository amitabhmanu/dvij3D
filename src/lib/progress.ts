// Reading progress and reader preferences, kept per browser in localStorage.
// Every access is wrapped: storage can be missing (private mode, blocked
// cookies), and the site must work without it (design §5.3).

const KEY = "twice-born:v1";

export type ReaderMode = "spread" | "single" | "panel";
export type Progress = {
  lastRead?: { book: string; page: number; panel?: number };
  furthest: Record<string, number>; // book slug -> furthest page reached
  mode?: ReaderMode;
  revealAll?: boolean;
  notes?: boolean; // show hotspot marks in the reader (default on)
  journey?: boolean; // show the journey rail during the trek (default off)
};

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { furthest: {}, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable or corrupt */
  }
  return { furthest: {} };
}

function write(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable or full */
  }
}

export function getProgress(): Progress {
  return read();
}

export function recordPage(book: string, page: number, panel?: number): void {
  const p = read();
  p.lastRead = { book, page, ...(panel != null ? { panel } : {}) };
  p.furthest[book] = Math.max(p.furthest[book] ?? 0, page);
  write(p);
}

export function setMode(mode: ReaderMode): void {
  const p = read();
  p.mode = mode;
  write(p);
}

export function setNotes(on: boolean): void {
  const p = read();
  p.notes = on;
  write(p);
}

export function setJourney(on: boolean): void {
  const p = read();
  p.journey = on;
  write(p);
}

export function setRevealAll(on: boolean): void {
  const p = read();
  p.revealAll = on;
  write(p);
}

/** Has the reader reached `page` of book `bookNo`? Starting any later book
 * counts as having read all earlier ones. `slugs` are the books in order. */
export function hasReached(p: Progress, bookNo: number, page: number, slugs: string[]): boolean {
  if (p.revealAll) return true;
  if (slugs.slice(bookNo).some((s) => (p.furthest[s] ?? 0) > 0)) return true;
  return (p.furthest[slugs[bookNo - 1]] ?? 0) >= page;
}
