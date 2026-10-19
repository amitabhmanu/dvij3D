// Where a place's label goes on screen (design §10.1). Pure, so it is unit
// tested; scene.ts feeds it each anchor after projecting it with the camera.

export type Spot = { x: number; y: number; behind: boolean; offscreen: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A projected point (normalised device coordinates, as Vector3.project gives)
 * to pixels in a w x h overlay. A label never leaves the overlay: one that is
 * off screen or behind the camera is pinned to the nearest edge, so it stays
 * visible and focusable and says which way to turn.
 */
export function toScreen(ndc: { x: number; y: number; z: number }, w: number, h: number, pad = 14): Spot {
  const behind = ndc.z > 1;
  let x = (ndc.x * 0.5 + 0.5) * w;
  let y = (-ndc.y * 0.5 + 0.5) * h;
  if (behind) {
    // behind the camera the projection is mirrored; flip it and drop to the bottom edge
    x = w - x;
    y = h;
  }
  const offscreen = behind || x < pad || x > w - pad || y < pad || y > h - pad;
  return { x: clamp(x, pad, w - pad), y: clamp(y, pad, h - pad), behind, offscreen };
}

/** Is the straight line from `from` to `to` above the ground everywhere? */
export function lineOfSight(
  from: [number, number, number],
  to: [number, number, number],
  groundAt: (x: number, z: number) => number,
  steps = 48,
): boolean {
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    const z = from[2] + (to[2] - from[2]) * t;
    if (groundAt(x, z) > y) return false;
  }
  return true;
}
