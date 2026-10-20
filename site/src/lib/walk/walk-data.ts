// What pipeline/build_walk.py wrote (design §10.2), typed.
import data from "../../content/generated/walk.json";

export type Water = { id: string; level: number; points: [number, number][] };
export type WalkData = {
  version: number;
  height: { file: string; w: number; h: number; scale: number };
  world: string;
  margin: number;
  worldWidth: number;
  worldDepth: number;
  spawn: { x: number; z: number; heading: number };
  water: Water[];
  player: { eye: number; walk: number; run: number; maxSlope: number; radius: number };
  check: { i: number; j: number; h: number }[];
};

export const walk = data as unknown as WalkData;
