// The camera's limits and flights over the valley (design §10.1). Pure maths,
// unit tested; scene.ts applies it to three.js objects.

export type Vec3 = [number, number, number];

export type Bounds = { halfWidth: number; halfDepth: number };

/** Keep the point the camera orbits inside the map, so the valley never drifts off screen. */
export function clampTarget([x, y, z]: Vec3, b: Bounds): Vec3 {
  return [Math.max(-b.halfWidth, Math.min(b.halfWidth, x)), y, Math.max(-b.halfDepth, Math.min(b.halfDepth, z))];
}

/** Smooth start and stop for a flight. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Where to put the camera to look at `target`: `distance` metres away, raised
 * `elevation` radians above the horizon, approaching from the direction the
 * camera is already looking from, so a flight never swings round the mountain.
 */
export function viewFrom(target: Vec3, from: Vec3, distance: number, elevation: number): Vec3 {
  let dx = from[0] - target[0];
  let dz = from[2] - target[2];
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= flat;
    dz /= flat;
  }
  const h = Math.cos(elevation) * distance;
  return [target[0] + dx * h, target[1] + Math.sin(elevation) * distance, target[2] + dz * h];
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
