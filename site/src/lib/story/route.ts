// A way from here to there for Dvij when the story walks him itself (watch
// mode, design §10.4): A* over a fine grid of the ground, round whatever
// `blocked` says is solid (the lodge's walls, furniture, the lake), then
// pulled straight wherever he can see through.
export type Blocked = (x: number, z: number) => boolean;

export function findRoute(from: [number, number], to: [number, number], blocked: Blocked, cell = 0.25, margin = 12): [number, number][] {
  const x0 = Math.min(from[0], to[0]) - margin, z0 = Math.min(from[1], to[1]) - margin;
  const w = Math.ceil((Math.abs(from[0] - to[0]) + 2 * margin) / cell) + 1;
  const h = Math.ceil((Math.abs(from[1] - to[1]) + 2 * margin) / cell) + 1;
  const ix = (x: number) => Math.round((x - x0) / cell), iz = (z: number) => Math.round((z - z0) / cell);
  const at = (i: number): [number, number] => [x0 + (i % w) * cell, z0 + Math.floor(i / w) * cell];
  const start = iz(from[1]) * w + ix(from[0]), goal = iz(to[1]) * w + ix(to[0]);
  const solid = new Map<number, boolean>();
  const isSolid = (i: number) => {
    if (i === start || i === goal) return false; // he is here, and the story says he gets there
    let s = solid.get(i);
    if (s === undefined) solid.set(i, (s = blocked(...at(i))));
    return s;
  };
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const gx = goal % w, gz = Math.floor(goal / w);
  const guess = (i: number) => Math.hypot((i % w) - gx, Math.floor(i / w) - gz);
  // a small binary heap of [f, i]
  const heap: [number, number][] = [[guess(start), start]];
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let k = heap.length - 1; k > 0;) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  for (let n = 0; heap.length && n < 200_000; n++) {
    const [, i] = pop();
    if (i === goal) { found = true; break; }
    const cx = i % w, cz = Math.floor(i / w), gi = g.get(i)!;
    for (const [dx, dz, cost] of STEPS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const j = nz * w + nx;
      if (isSolid(j)) continue;
      if (dx && dz && (isSolid(cz * w + nx) || isSolid(nz * w + cx))) continue; // no cutting corners
      const gj = gi + cost;
      if (gj < (g.get(j) ?? Infinity)) {
        g.set(j, gj);
        came.set(j, i);
        push([gj + guess(j), j]);
      }
    }
  }
  if (!found) return [to]; // nowhere to go round: straight there
  const cells: [number, number][] = [];
  for (let i = goal; i !== start; i = came.get(i)!) cells.push(at(i));
  cells.reverse();
  cells[cells.length - 1] = to;
  // Pull the string: skip every corner he can walk straight past.
  const clear = (a: [number, number], b: [number, number]) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2));
    for (let k = 1; k < n; k++) if (blocked(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)) return false;
    return true;
  };
  const out: [number, number][] = [];
  let from_ = from;
  for (let k = 0; k < cells.length;) {
    let far = k;
    while (far + 1 < cells.length && clear(from_, cells[far + 1])) far++;
    out.push(cells[far]);
    from_ = cells[far];
    k = far + 1;
  }
  return out;
}
