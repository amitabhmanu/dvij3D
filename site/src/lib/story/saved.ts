// Where the story was left (design §10.4): the scene and its last checkpoint.
// Its own small module, so the start screen can offer "Continue" without
// loading the game.
const KEY = "twice-born:story:v1";
export type Saved = { scene: string; beat?: string };

export const loadSaved = (): Saved | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
};
export const writeSaved = (s: Saved) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
};
