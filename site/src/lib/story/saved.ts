// Where the story was left (design §10.4): the scene and its last checkpoint.
// Its own small module, so the start screen can offer "Continue" without
// loading the game.
// Each point of view keeps its own place (design §10.4.1): Dvij's where it always was.
const KEY = "twice-born:story:v1";
const keyOf = (who: string) => (who === "dvij" ? KEY : `twice-born:story:${who}:v1`);
export type Saved = { scene: string; beat?: string };

export const loadSaved = (who = "dvij"): Saved | null => {
  try { return JSON.parse(localStorage.getItem(keyOf(who)) || "null"); } catch { return null; }
};
export const writeSaved = (s: Saved, who = "dvij") => {
  try { localStorage.setItem(keyOf(who), JSON.stringify(s)); } catch { /* storage unavailable */ }
};
