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
  /** The lodge you can walk into (design §10.3): its model, where it stands, its levelled pad. */
  lodge: { file: string; x: number; y: number; z: number; pad: [number, number, number, number]; blend: number };
  /** Other places built as models, each on its own levelled pad: the temple site (Chapter 9). */
  sites: { id: string; file: string; x: number; y: number; z: number; pad: [number, number, number, number]; blend: number }[];
  /** Where walking up to each labelled place offers its card. */
  places: { id: string; x: number; y: number; z: number; r: number }[];
};

export const walk = data as unknown as WalkData;
export const atlas = cut as unknown as Atlas;

/** The walk's files: from PUBLIC_3D_BASE in production, the site itself in dev (see manifest.ts). */
export const walkAsset = (name: string) => `${(import.meta.env.PUBLIC_3D_BASE || "/_assets").replace(/\/$/, "")}/walk/${name}`;

export type Building = {
  id: string; kind: string; sprite: string; x: number; y: number; z: number;
  height: number; width: number; r: number; place: string | null;
  /** A building with a model to walk into stands as that model, not as its cut-out. */
  model?: string;
  door: null; interior: null; // for later: entering buildings
};
