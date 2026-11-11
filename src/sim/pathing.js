// Hierarchical pathfinding.
//  - Graph: the map is cut into 8x8 tile chunks; each chunk is split into connected components
//    (so a river running through a chunk yields two nodes). A* over those nodes gives long routes;
//    Dijkstra from a goal node gives a flow field that thousands of zombies can share.
//  - TilePather: bounded tile A* used to refine the next stretch of a coarse route.
// All results are pure functions of the speed arrays, so caches never affect determinism.
import { Heap } from './heap.js';

export const CS = 8;
export const MAXC = 16;
const FIELD_CACHE = 48;
const SQ2 = Math.SQRT2;

export class Graph {
  constructor(W, H, speed, hMul = 0.5) {
    this.W = W; this.H = H; this.speed = speed; this.hMul = hMul;
    this.CW = Math.ceil(W / CS); this.CH = Math.ceil(H / CS);
    this.NC = this.CW * this.CH;
    const NN = this.NN = this.NC * MAXC;
    this.comp = new Int32Array(W * H).fill(-1);
    this.cnt = new Uint8Array(this.NC);
    this.cen = new Int32Array(NN);
    this.cost = new Float32Array(NN);
    this.ver = 0;
    this.pathCache = new Map(); this.cacheVer = -1;
    this.fields = new Map(); this.fieldVer = -1;
    this.g = new Float32Array(NN); this.par = new Int32Array(NN);
    this.stamp = new Uint32Array(NN); this.closed = new Uint32Array(NN); this.cur = 0;
    this.heap = new Heap(4096);
    this.nb = [];
    this._stack = new Int32Array(CS * CS);
  }
  rebuildAll() { for (let c = 0; c < this.NC; c++) this._chunk(c); this.ver++; }
  rebuildAt(t) {
    const x = t % this.W, y = (t / this.W) | 0;
    this._chunk(((y / CS) | 0) * this.CW + ((x / CS) | 0));
    this.ver++;
  }
  _chunk(c) {
    const W = this.W, cx = c % this.CW, cy = (c / this.CW) | 0;
    const x0 = cx * CS, y0 = cy * CS, x1 = Math.min(x0 + CS, W), y1 = Math.min(y0 + CS, this.H);
    const comp = this.comp, sp = this.speed, st = this._stack;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) comp[y * W + x] = -1;
    const sx = new Float64Array(MAXC), sy = new Float64Array(MAXC), sn = new Int32Array(MAXC), sc = new Float64Array(MAXC);
    let k = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t0 = y * W + x;
      if (sp[t0] <= 0 || comp[t0] >= 0) continue;
      const li = Math.min(k, MAXC - 1);
      if (k < MAXC) k++;
      const id = c * MAXC + li;
      let top = 0; st[top++] = t0; comp[t0] = id;
      while (top > 0) {
        const t = st[--top];
        const tx = t % W, ty = (t / W) | 0;
        sx[li] += tx; sy[li] += ty; sn[li]++; sc[li] += 1 / sp[t];
        if (tx > x0 && sp[t - 1] > 0 && comp[t - 1] < 0) { comp[t - 1] = id; st[top++] = t - 1; }
        if (tx < x1 - 1 && sp[t + 1] > 0 && comp[t + 1] < 0) { comp[t + 1] = id; st[top++] = t + 1; }
        if (ty > y0 && sp[t - W] > 0 && comp[t - W] < 0) { comp[t - W] = id; st[top++] = t - W; }
        if (ty < y1 - 1 && sp[t + W] > 0 && comp[t + W] < 0) { comp[t + W] = id; st[top++] = t + W; }
      }
    }
    this.cnt[c] = k;
    const bd = new Float64Array(MAXC).fill(Infinity);
    for (let li = 0; li < k; li++) { this.cost[c * MAXC + li] = sc[li] / sn[li]; sx[li] /= sn[li]; sy[li] /= sn[li]; }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t = y * W + x, id = comp[t];
      if (id < 0) continue;
      const li = id - c * MAXC;
      const d = (x - sx[li]) ** 2 + (y - sy[li]) ** 2;
      if (d < bd[li]) { bd[li] = d; this.cen[id] = t; }
    }
  }
  neighbors(n) {
    const out = this.nb; out.length = 0;
    const W = this.W, comp = this.comp;
    const c = (n / MAXC) | 0, cx = c % this.CW, cy = (c / this.CW) | 0;
    const x0 = cx * CS, y0 = cy * CS, x1 = Math.min(x0 + CS, W), y1 = Math.min(y0 + CS, this.H);
    const add = m => { if (m >= 0 && out.indexOf(m) < 0) out.push(m); };
    if (x0 > 0) for (let y = y0; y < y1; y++) { const t = y * W + x0; if (comp[t] === n) add(comp[t - 1]); }
    if (x1 < W) for (let y = y0; y < y1; y++) { const t = y * W + x1 - 1; if (comp[t] === n) add(comp[t + 1]); }
    if (y0 > 0) for (let x = x0; x < x1; x++) { const t = y0 * W + x; if (comp[t] === n) add(comp[t - W]); }
    if (y1 < this.H) for (let x = x0; x < x1; x++) { const t = (y1 - 1) * W + x; if (comp[t] === n) add(comp[t + W]); }
    return out;
  }
  edgeCost(n, m) {
    const W = this.W, a = this.cen[n], b = this.cen[m];
    const d = Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0));
    return d * (this.cost[n] + this.cost[m]) * 0.5;
  }
  heur(n, gn) {
    const W = this.W, a = this.cen[n], b = this.cen[gn];
    return Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0)) * this.hMul;
  }
  // Coarse A*; returns array of node ids from sn to gn (inclusive) or null.
  path(sn, gn) {
    if (sn < 0 || gn < 0) return null;
    if (sn === gn) return [sn];
    if (this.cacheVer !== this.ver) { this.pathCache.clear(); this.cacheVer = this.ver; }
    const key = sn * 1048576 + gn;
    const hit = this.pathCache.get(key);
    if (hit !== undefined) return hit;
    const cur = ++this.cur, g = this.g, par = this.par, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();
    g[sn] = 0; stamp[sn] = cur; par[sn] = -1; heap.push(sn, this.heur(sn, gn));
    let found = false;
    while (heap.size > 0) {
      const n = heap.pop();
      if (closed[n] === cur) continue;
      closed[n] = cur;
      if (n === gn) { found = true; break; }
      const nbs = this.neighbors(n);
      for (let i = 0; i < nbs.length; i++) {
        const m = nbs[i];
        if (closed[m] === cur) continue;
        const ng = Math.fround(g[n] + this.edgeCost(n, m));
        if (stamp[m] !== cur || ng < g[m]) {
          stamp[m] = cur; g[m] = ng; par[m] = n;
          heap.push(m, ng + this.heur(m, gn));
        }
      }
    }
    let res = null;
    if (found) {
      res = [];
      for (let n = gn; n !== -1; n = par[n]) res.push(n);
      res.reverse();
    }
    if (this.pathCache.size > 4000) this.pathCache.clear();
    this.pathCache.set(key, res);
    return res;
  }
  pathCost(sn, gn) {
    const p = this.path(sn, gn);
    if (!p) return Infinity;
    let c = 0;
    for (let i = 1; i < p.length; i++) c += this.edgeCost(p[i - 1], p[i]);
    return c;
  }
  // Compact node numbering + adjacency lists (CSR), rebuilt lazily when the graph changes.
  // Flow fields are stored per compact node, which is ~15x smaller than per node slot.
  _adjacency() {
    if (this.adjVer === this.ver) return;
    this.adjVer = this.ver;
    const idx = this.idx || (this.idx = new Int32Array(this.NN));
    idx.fill(-1);
    let M = 0;
    for (let c = 0; c < this.NC; c++) for (let li = 0; li < this.cnt[c]; li++) idx[c * MAXC + li] = M++;
    const node = new Int32Array(M), start = new Int32Array(M + 1), adj = [], cost = [];
    for (let c = 0; c < this.NC; c++) for (let li = 0; li < this.cnt[c]; li++) node[idx[c * MAXC + li]] = c * MAXC + li;
    for (let i = 0; i < M; i++) {
      start[i] = adj.length;
      const n = node[i], nbs = this.neighbors(n);
      for (let k = 0; k < nbs.length; k++) { adj.push(idx[nbs[k]]); cost.push(this.edgeCost(n, nbs[k])); }
    }
    start[M] = adj.length;
    this.M = M; this.node = node; this.adjStart = start; this.adj = Int32Array.from(adj); this.adjCost = Float64Array.from(cost);
  }
  // Dijkstra flow field toward gn over the coarse graph. Kept in an LRU cache: many zombie
  // groups can have different goals at once, and recomputing a field costs a full-map search.
  field(gn) {
    this._adjacency();
    if (this.fieldVer !== this.ver) { this.fields.clear(); this.fieldVer = this.ver; }
    let f = this.fields.get(gn);
    if (f) { this.fields.delete(gn); this.fields.set(gn, f); return f; }
    const M = this.M, start = this.adjStart, adj = this.adj, cost = this.adjCost;
    const dist = new Float32Array(M).fill(Infinity);
    const next = new Int32Array(M).fill(-1);
    const heap = this.fheap || (this.fheap = new Heap(4096));
    heap.clear();
    const g = this.idx[gn];
    dist[g] = 0; heap.push(g, 0);
    while (heap.size > 0) {
      const pr = heap.p[0];
      const i = heap.pop();
      if (pr > dist[i]) continue;
      for (let k = start[i], e = start[i + 1]; k < e; k++) {
        const j = adj[k];
        const nd = Math.fround(dist[i] + cost[k]);
        if (nd < dist[j]) { dist[j] = nd; next[j] = i; heap.push(j, nd); }
      }
    }
    f = { gn, dist, next, dirs: new Map() };
    if (this.fields.size >= FIELD_CACHE) this.fields.delete(this.fields.keys().next().value);
    this.fields.set(gn, f);
    return f;
  }
  // Distance from node n to the field's goal, and the next node on the way (-1 if none).
  fieldDist(f, n) { return f.dist[this.idx[n]]; }
  fieldNext(f, n) { const j = f.next[this.idx[n]]; return j < 0 ? -1 : this.node[j]; }
  // Per-tile direction inside node n toward the field's next node. Codes: 0 E, 1 W, 2 S, 3 N, -1 none.
  fieldDirs(f, n) {
    let d = f.dirs.get(n);
    if (d) return d;
    d = new Int8Array(CS * CS).fill(-1);
    const m = this.fieldNext(f, n);
    f.dirs.set(n, d);
    if (m < 0) return d;
    const W = this.W, comp = this.comp;
    const c = (n / MAXC) | 0, cx = c % this.CW, cy = (c / this.CW) | 0;
    const x0 = cx * CS, y0 = cy * CS, x1 = Math.min(x0 + CS, W), y1 = Math.min(y0 + CS, this.H);
    const q = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t = y * W + x;
      if (comp[t] !== n) continue;
      const li = (y - y0) * CS + (x - x0);
      if (x + 1 < W && comp[t + 1] === m) d[li] = 0;
      else if (x > 0 && comp[t - 1] === m) d[li] = 1;
      else if (y + 1 < this.H && comp[t + W] === m) d[li] = 2;
      else if (y > 0 && comp[t - W] === m) d[li] = 3;
      if (d[li] >= 0) q.push(t);
    }
    for (let qi = 0; qi < q.length; qi++) {
      const t = q[qi], x = t % W, y = (t / W) | 0;
      // neighbor -> t direction
      const tryN = (nx, ny, code) => {
        if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) return;
        const nt = ny * W + nx;
        if (comp[nt] !== n) return;
        const li = (ny - y0) * CS + (nx - x0);
        if (d[li] >= 0) return;
        d[li] = code; q.push(nt);
      };
      tryN(x - 1, y, 0); tryN(x + 1, y, 1); tryN(x, y - 1, 2); tryN(x, y + 1, 3);
    }
    return d;
  }
}

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Bounded tile A* (8-way, no corner cutting).
export class TilePather {
  constructor(W, H, maxB = 220) {
    this.W = W; this.H = H; this.maxB = maxB;
    const M = maxB * maxB;
    this.g = new Float32Array(M); this.par = new Int32Array(M);
    this.stamp = new Uint32Array(M); this.closed = new Uint32Array(M); this.cur = 0;
    this.heap = new Heap(4096);
  }
  // speed: Float32Array; allow: optional {comp, mark, val} restricting tiles to marked coarse nodes.
  find(sx, sy, gx, gy, speed, x0, y0, x1, y1, allow, maxExp = 9000) {
    const W = this.W;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(this.H - 1, y1);
    if (x1 - x0 + 1 > this.maxB) { const c = (sx + gx) >> 1; x0 = Math.max(0, c - (this.maxB >> 1)); x1 = Math.min(W - 1, x0 + this.maxB - 1); }
    if (y1 - y0 + 1 > this.maxB) { const c = (sy + gy) >> 1; y0 = Math.max(0, c - (this.maxB >> 1)); y1 = Math.min(this.H - 1, y0 + this.maxB - 1); }
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || gx < x0 || gx > x1 || gy < y0 || gy > y1) return null;
    const bw = x1 - x0 + 1;
    const cur = ++this.cur, g = this.g, par = this.par, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();
    const L = (x, y) => (y - y0) * bw + (x - x0);
    const s = L(sx, sy), goal = L(gx, gy);
    if (s === goal) return [];
    const ok = (x, y) => {
      const t = y * W + x;
      if (speed[t] <= 0) return false;
      if (allow && allow.mark[allow.comp[t]] !== allow.val) return false;
      return true;
    };
    if (!ok(gx, gy)) return null;
    const hm = 0.5;
    const h = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy)) * hm; };
    g[s] = 0; stamp[s] = cur; par[s] = -1; heap.push(s, h(sx, sy));
    let exp = 0, found = false;
    while (heap.size > 0) {
      const li = heap.pop();
      if (closed[li] === cur) continue;
      closed[li] = cur;
      if (li === goal) { found = true; break; }
      if (++exp > maxExp) break;
      const x = x0 + li % bw, y = y0 + ((li / bw) | 0);
      const t = y * W + x;
      const ca = 1 / speed[t];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        if (!ok(nx, ny)) continue;
        if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
        const nl = L(nx, ny);
        if (closed[nl] === cur) continue;
        const ng = Math.fround(g[li] + (dx && dy ? SQ2 : 1) * 0.5 * (ca + 1 / speed[ny * W + nx]));
        if (stamp[nl] !== cur || ng < g[nl]) {
          stamp[nl] = cur; g[nl] = ng; par[nl] = li;
          heap.push(nl, ng + h(nx, ny));
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let li = goal; li !== s; li = par[li]) out.push((y0 + ((li / bw) | 0)) * W + x0 + li % bw);
    out.reverse();
    return out;
  }
}
