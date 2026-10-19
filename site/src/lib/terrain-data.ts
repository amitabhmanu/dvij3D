// The terrain pipeline/build_terrain.py wrote (design §10.1). Imported only by
// the page at build time and by the lazily loaded 3D scene, never by the
// island's first load.
import data from "../content/generated/terrain.json";
import type { Terrain } from "./terrain";

export const terrain = data as unknown as Terrain;
