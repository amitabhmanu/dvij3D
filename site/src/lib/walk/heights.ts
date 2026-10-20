// The ground you walk on (design §10.2). pipeline/build_walk.py stores the
// valley's heights about 4 m apart as gzip'd int16 residuals in decimetres;
// this reverses that and answers "how high is the ground here?" for the player
// and, through the identical GLSL in ground.ts, for the drawn land, so feet and
// ground always agree.

export type Frame = { worldWidth: number; worldDepth: number; margin: number };
export type Field = {
  w: number; h: number; data: Float32Array;
  cell: number; // metres between samples
  x0: number; z0: number; // world position of sample (0, 0)
};

/** Residuals -> heights: a planar predictor inverts to a 2D running sum. */
export function integrate(res: Int16Array, w: number, h: number, scale: number): Float32Array {
  const out = new Float32Array(w * h);
  const row = new Float64Array(w); // running column sums
  for (let j = 0; j < h; j++) {
    let acc = 0;
    for (let i = 0; i < w; i++) {
      row[i] += res[j * w + i];
      acc += row[i];
      out[j * w + i] = acc * scale;
    }
  }
  return out;
}

export async function decodeHeights(buf: ArrayBuffer, w: number, h: number, scale: number): Promise<Float32Array> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  const raw = await new Response(stream).arrayBuffer();
  if (raw.byteLength !== w * h * 2) throw new Error(`walk heights: expected ${w * h * 2} bytes, got ${raw.byteLength}`);
  return integrate(new Int16Array(raw), w, h, scale);
}

/** Where the samples sit in the world: the map plus its rim, centred on the origin. */
export function fieldFor(data: Float32Array, w: number, h: number, f: Frame): Field {
  const cell = (f.worldWidth * (1 + 2 * f.margin)) / w;
  const gw = f.worldWidth * (1 + 2 * f.margin);
  const gd = f.worldDepth + 2 * f.margin * f.worldWidth;
  return { w, h, data, cell, x0: -gw / 2 + cell / 2, z0: -gd / 2 + cell / 2 };
}

/** Bilinear height from the samples alone. */
export function sampleField(f: Field, x: number, z: number): number {
  const u = Math.min(Math.max((x - f.x0) / f.cell, 0), f.w - 1.0001);
  const v = Math.min(Math.max((z - f.z0) / f.cell, 0), f.h - 1.0001);
  const i = Math.floor(u), j = Math.floor(v);
  const fx = u - i, fz = v - j;
  const d = f.data, w = f.w;
  const a = d[j * w + i], b = d[j * w + i + 1], c = d[(j + 1) * w + i], e = d[(j + 1) * w + i + 1];
  // Past the last sample the land keeps climbing, so the world's edge is a
  // slope fading into haze rather than a ridge with a flat shelf behind it.
  const ou = Math.max(0, f.x0 - x, x - (f.x0 + (f.w - 1) * f.cell));
  const ov = Math.max(0, f.z0 - z, z - (f.z0 + (f.h - 1) * f.cell));
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + e * fx) * fz + RISE * Math.hypot(ou, ov);
}

export const RISE = 0.15;

// Small ripples the 4 m samples can't hold, generated the same way here and in
// the shader: value noise on an integer lattice with an integer hash.
function hash(ix: number, iz: number): number {
  let n = (Math.imul(ix + 1000000, 374761393) + Math.imul(iz + 1000000, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

export const RIPPLE = [
  { wave: 7, amp: 0.35 },
  { wave: 2.3, amp: 0.1 },
] as const;

export function ripple(x: number, z: number): number {
  let r = 0;
  for (const o of RIPPLE) r += (valueNoise(x / o.wave, z / o.wave) - 0.5) * 2 * o.amp;
  return r;
}

export function heightAt(f: Field, x: number, z: number): number {
  return sampleField(f, x, z) + ripple(x, z);
}
