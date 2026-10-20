// What pipeline/build_walk.py wrote (design §10.2), typed.
import data from "../../content/generated/walk.json";
import cut from "../../content/generated/cutouts.json";
import type { Atlas } from "./cutouts";

export type Water = { id: string; level: number; points: [number, number][] };
export type WalkData = {
  version: number;
  height: { file: string; w: number; h: number; scale: number };
  world: string;
  ground: string;
  trees: string;
  cutouts: string;
  margin: number;
  worldWidth: number;
  worldDepth: number;
  spawn: { x: number; z: number; heading: number };
  water: Water[];
  player: { eye: number; walk: number; run: number; maxSlope: number; radius: number };
  check: { i: number; j: number; h: number }[];
};

export const walk = data as unknown as WalkData;
export const atlas = cut as unknown as Atlas;

/** The walk's files are served by the site itself, like the terrain's (see manifest.ts). */
export const walkAsset = (name: string) => `/_assets/walk/${name}`;

export type Building = {
  id: string; kind: string; sprite: string; x: number; y: number; z: number;
  height: number; width: number; r: number; place: string | null;
  door: null; interior: null; // for later: entering buildings
};
