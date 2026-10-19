// The valley in 3D (design §10.1): the shapes of pipeline/build_terrain.py's
// output and the pure arithmetic between its coordinate frames. No data is
// imported here, so the page's island can use these without pulling the
// terrain into its first load; terrain-data.ts holds the data itself.
//
// Frames:
//   map    u, v in 0-1 across images/artifacts/map.jpg (the places.yaml rects)
//   world  x east, z south, in metres, origin at the map's centre; y is height
//   grid   0-1 across the heightmap, which covers the map plus a rim of
//          `margin` map-widths on every side

export type Water = { id: string; level: number; points: [number, number][] };
/** x, y, z in metres, then size across in metres and a rotation in radians. */
export type Boulder = [number, number, number, number, number];

export type Terrain = {
  version: number;
  height: { file: string; w: number; h: number; min: number; max: number };
  drape: string;
  poster: string;
  margin: number;
  worldWidth: number;
  worldDepth: number;
  verticalExaggeration: number;
  levels: Record<string, number[]>;
  summits: Record<string, [number, number, number]>;
  water: Water[];
  boulders: Boulder[];
  anchors: Record<string, [number, number, number]>;
};

type Frame = Pick<Terrain, "worldWidth" | "worldDepth" | "margin">;

export function mapToWorld(t: Frame, u: number, v: number): [number, number] {
  return [(u - 0.5) * t.worldWidth, (v - 0.5) * t.worldDepth];
}

export function worldToMap(t: Frame, x: number, z: number): [number, number] {
  return [x / t.worldWidth + 0.5, z / t.worldDepth + 0.5];
}

/** Map coordinates to the heightmap's own 0-1 frame, rim included. */
export function mapToGrid(t: Frame, u: number, v: number): [number, number] {
  const aspect = t.worldDepth / t.worldWidth;
  return [(u + t.margin) / (1 + 2 * t.margin), (v * aspect + t.margin) / (aspect + 2 * t.margin)];
}

/** The world's full extent, rim included, in metres. */
export function gridSize(t: Frame): [number, number] {
  return [t.worldWidth * (1 + 2 * t.margin), t.worldDepth + 2 * t.margin * t.worldWidth];
}

/** An 8-bit heightmap sample (0-255) back to metres. */
export function decodeHeight(t: Pick<Terrain, "height">, q: number): number {
  return t.height.min + (q / 255) * (t.height.max - t.height.min);
}
