// Rasterizes the handmade map definition (data/map.json) into tile layers.
// The layout (region seeds, rivers, fords, bridges, cliffs, nests, start) is authored by hand;
// a fixed-seed noise adds terrain texture so the same file always yields the same map.

export const TER = { GRASS: 0, DIRT: 1, FOREST: 2, HILLS: 3, MARSH: 4, RIVER: 5, FORD: 6, CLIFF: 7 };
export const TER_NAMES = ['grass', 'dirt', 'forest', 'hills', 'marsh', 'river', 'ford', 'cliff'];
export const DEP = { NONE: 0, STONE: 1, ORE: 2, COAL: 3 };
export const DEP_NAMES = ['none', 'stone', 'ore', 'coal'];

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct) {
  let s = 0, amp = 1, tot = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, seed + o * 101) * amp;
    tot += amp; amp *= 0.5; f *= 2.03;
  }
  return s / tot;
}
// Empirical quantiles so "coverage" weights in the data file map to real area fractions.
function quantiles(oct, seed) {
  const n = 20000, arr = new Float64Array(n);
  for (let i = 0; i < n; i++) arr[i] = fbm((i % 157) * 3.71, Math.floor(i / 157) * 3.37, seed, oct);
  arr.sort();
  return arr;
}
function thr(q, w) {
  if (w <= 0) return 2;
  if (w >= 1) return -1;
  return q[Math.floor((1 - w) * (q.length - 1))];
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function stampPolyline(W, H, pts, width, seed, fn) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const m = width + 3;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - m)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + m));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - m)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + m));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const wv = width * (0.8 + 0.4 * vnoise(x / 9, y / 9, seed));
      if (distToSeg(x + 0.5, y + 0.5, ax, ay, bx, by) <= wv / 2) fn(y * W + x);
    }
  }
}

function nearestOnPolyline(pts, px, py) {
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < bd) { bd = d; best = [cx, cy]; }
  }
  return best;
}

export function buildMap(def) {
  const W = def.width, H = def.height, N = W * H;
  const region = new Uint8Array(N), terrain = new Uint8Array(N), deposit = new Uint8Array(N), road = new Uint8Array(N);
  const s = def.seed;
  const R = def.regions;
  const q3 = quantiles(3, s + 50), q2 = quantiles(2, s + 51);
  const rt = R.map(r => ({
    forest: thr(q3, r.terrain.forest), hills: thr(q3, r.terrain.hills), marsh: thr(q3, r.terrain.marsh), barren: thr(q2, r.terrain.barren),
    stone: thr(q2, r.deposits.stone * 0.3), ore: thr(q2, r.deposits.ore * 0.3), coal: thr(q2, r.deposits.coal * 0.35),
  }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const wx = x + (fbm(x / 110, y / 110, s + 1, 2) - 0.5) * 140;
      const wy = y + (fbm(x / 110, y / 110, s + 2, 2) - 0.5) * 140;
      let best = 0, bd = Infinity;
      for (let r = 0; r < R.length; r++) {
        const dx = wx - R[r].seed[0], dy = wy - R[r].seed[1];
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = r; }
      }
      region[i] = best;
      const T = rt[best];
      let ter = TER.GRASS;
      if (fbm(x / 26, y / 26, s + 6, 2) > T.barren) ter = TER.DIRT;
      if (fbm(x / 30, y / 30, s + 3, 3) > T.forest) ter = TER.FOREST;
      if (fbm(x / 42, y / 42, s + 4, 3) > T.hills) ter = TER.HILLS;
      if (fbm(x / 36, y / 36, s + 5, 3) > T.marsh) ter = TER.MARSH;
      terrain[i] = ter;
      if (ter === TER.HILLS || ter === TER.DIRT) {
        if (fbm(x / 8, y / 8, s + 7, 2) > T.stone) deposit[i] = DEP.STONE;
        else if (fbm(x / 8, y / 8, s + 8, 2) > T.ore) deposit[i] = DEP.ORE;
      } else if (ter === TER.MARSH) {
        if (fbm(x / 8, y / 8, s + 9, 2) > T.coal) deposit[i] = DEP.COAL;
      }
    }
  }
  // Rivers
  def.rivers.forEach((rv, ri) => stampPolyline(W, H, rv.points, rv.width, s + 20 + ri, i => { terrain[i] = TER.RIVER; deposit[i] = 0; }));
  // Cliffs
  def.cliffs.forEach((cl, ci) => stampPolyline(W, H, cl.points, cl.width, s + 40 + ci, i => { if (terrain[i] !== TER.RIVER) { terrain[i] = TER.CLIFF; deposit[i] = 0; } }));
  // Fords and bridges
  const crossing = (f, isBridge) => {
    const p = nearestOnPolyline(def.rivers[f.river].points, f.near[0], f.near[1]);
    const r = f.r + def.rivers[f.river].width;
    for (let y = Math.floor(p[1] - r); y <= Math.ceil(p[1] + r); y++) for (let x = Math.floor(p[0] - r); x <= Math.ceil(p[0] + r); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (terrain[i] !== TER.RIVER) continue;
      if (Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]) > r) continue;
      if (isBridge) { if (Math.abs(x + 0.5 - p[0]) <= f.r || Math.abs(y + 0.5 - p[1]) <= f.r) { terrain[i] = TER.FORD; road[i] = 2; } }
      else terrain[i] = TER.FORD;
    }
    return p;
  };
  const fords = def.fords.map(f => crossing(f, false));
  const bridges = def.bridges.map(b => crossing(b, true));
  // Clear the start area and nest sites
  const clear = (cx, cy, r, ter) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = y * W + x;
      if (terrain[i] === TER.RIVER || terrain[i] === TER.FORD) continue;
      terrain[i] = ter; deposit[i] = 0;
    }
  };
  clear(def.start[0], def.start[1], 9, TER.GRASS);
  def.nests.forEach(n => clear(n.pos[0], n.pos[1], 7, TER.DIRT));
  // Map edge is impassable
  for (let x = 0; x < W; x++) { terrain[x] = TER.CLIFF; terrain[(H - 1) * W + x] = TER.CLIFF; }
  for (let y = 0; y < H; y++) { terrain[y * W] = TER.CLIFF; terrain[y * W + W - 1] = TER.CLIFF; }
  // Region centroids and areas
  const sum = R.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const r = sum[region[y * W + x]]; r.x += x; r.y += y; r.n++; }
  const centroids = sum.map(r => [r.x / Math.max(1, r.n), r.y / Math.max(1, r.n)]);
  const area = sum.map(r => r.n * 4);
  return { W, H, region, terrain, deposit, road, centroids, area, fords, bridges, def };
}
