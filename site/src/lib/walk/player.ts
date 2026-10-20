// Walking (design §10.2): one step of the player, as pure maths so it is unit
// tested. The game calls it at a fixed 60 steps a second.

export type Player = { x: number; z: number; y: number; heading: number; pitch: number };
export type Move = { forward: number; strafe: number; run: boolean; turn: number; look: number };
export type Rules = { eye: number; walk: number; run: number; maxSlope: number; radius: number };
export type World = {
  ground: (x: number, z: number) => number;
  blocked: (x: number, z: number, radius: number) => boolean;
};

const MAX_PITCH = 1.45; // just short of straight up or down

/** Heading is radians clockwise from north (-z); forward walks that way. */
export function direction(heading: number): [number, number] {
  return [Math.sin(heading), -Math.cos(heading)];
}

export function step(p: Player, m: Move, dt: number, rules: Rules, world: World): Player {
  const heading = p.heading + m.turn;
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch + m.look));
  const [fx, fz] = direction(heading);
  let vx = fx * m.forward + -fz * m.strafe;
  let vz = fz * m.forward + fx * m.strafe;
  const len = Math.hypot(vx, vz);
  if (len > 1) { vx /= len; vz /= len; }
  const speed = m.run ? rules.run : rules.walk;
  const dx = vx * speed * dt, dz = vz * speed * dt;
  const here = world.ground(p.x, p.z);
  const tan = Math.tan((rules.maxSlope * Math.PI) / 180);

  const ok = (x: number, z: number) => {
    if (world.blocked(x, z, rules.radius)) return false;
    const dist = Math.hypot(x - p.x, z - p.z);
    const rise = world.ground(x, z) - here;
    return dist === 0 || rise <= tan * dist; // going down is always fine
  };
  let x = p.x, z = p.z;
  if (dx || dz) {
    if (ok(p.x + dx, p.z + dz)) { x += dx; z += dz; }
    else if (ok(p.x + dx, p.z)) x += dx; // slide along whatever stopped you
    else if (ok(p.x, p.z + dz)) z += dz;
  }
  const ground = world.ground(x, z) + rules.eye;
  // ease the eye onto the ground, so ripples and rocks don't jolt the view
  const y = p.y === 0 ? ground : p.y + (ground - p.y) * Math.min(1, dt * 14);
  return { x, z, y, heading, pitch };
}

/** Is (x, z) inside a polygon of [x, z] points? */
export function inside(poly: [number, number][], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** A grid of circles (boulders, trunks, building footprints) for quick "is anything here?" checks. */
export class Blockers {
  private cells = new Map<string, [number, number, number][]>();
  constructor(private size = 16) {}
  add(x: number, z: number, r: number) {
    const s = this.size;
    const reach = r + 2; // a little past the edge, so a walker near a cell border still finds it
    const entry: [number, number, number] = [x, z, r]; // one entry shared by every cell it's in
    for (let i = Math.floor((x - reach) / s); i <= Math.floor((x + reach) / s); i++)
      for (let j = Math.floor((z - reach) / s); j <= Math.floor((z + reach) / s); j++) {
        const k = `${i},${j}`;
        (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(entry);
      }
  }
  /** How many things stand within r of (x, z): for how wooded it is round you. */
  count(x: number, z: number, r: number): number {
    const s = this.size;
    let n = 0;
    const seen = new Set<[number, number, number]>();
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++)
      for (let j = Math.floor((z - r) / s); j <= Math.floor((z + r) / s); j++)
        for (const b of this.cells.get(`${i},${j}`) ?? []) {
          if (!seen.has(b) && Math.hypot(x - b[0], z - b[1]) < r) { seen.add(b); n++; }
        }
    return n;
  }

  hits(x: number, z: number, r: number): boolean {
    const list = this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
    return !!list?.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < r + br);
  }
}
