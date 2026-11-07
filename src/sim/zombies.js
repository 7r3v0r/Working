// Zombie AI, infection, nests, regional threat, waves, skirmishes, dormant clusters.
import { BLOCK_Z, B_TRAP } from './world.js';
import { DIRS, CS, MAXC } from './pathing.js';
import { Heap } from './heap.js';
import { lists } from './civ.js';

const SQ2 = Math.SQRT2;

// ---------------- spawning ----------------
function nearestCity(w, x, y, maxD = Infinity) {
  let best = null, bd = maxD * maxD;
  for (const c of w.cities) { const d = (c.cx - x) ** 2 + (c.cy - y) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}
function zPassNear(w, x, y, r = 4) {
  const t = w.passableNear(w.tileOf(x, y), w.tSpeed, r);
  if (t < 0) return null;
  if (t === w.tileOf(x, y)) return [x, y];
  return [t % w.W + 0.5, ((t / w.W) | 0) + 0.5];
}
export function raise(w, x, y, cityId) {
  const p = zPassNear(w, x, y, 5);
  if (!p) return null;
  const c = nearestCity(w, p[0], p[1], 90);
  return w.spawn('zombie', p[0], p[1], { zg: c ? { t: 'city', c: c.id } : { t: 'pt', x: p[0], y: p[1], r: 15 } });
}

// ---------------- infection ----------------
export function infect(w, b) {
  if (b.infected || b.dead) return;
  b.infected = true;
  b.infT = w.B.infection.releaseDelay;
  let n = 0;
  for (const id of b.inside.slice()) {
    const u = w.unitMap.get(id);
    if (!u || u.dead) continue;
    u.inside = 0;
    w.killUnit(u, 'infect');
    n++;
  }
  b.inside.length = 0;
  b.infCount = n;
  b.infHp = w.B.infection.clearHpPerOccupant * Math.max(1, n);
  const c = w.cityMap.get(b.city);
  const name = w.BD[b.type].name;
  w.event('infect', `${name} infected in ${c ? c.name : '?'}! ${n} turned.`, b.x + b.w / 2, b.y + b.h / 2);
  if (b.type === 'townhall' && c && c.hall === b.id && c.id === w.capital) w.lose(`${c.name}'s town hall was infected.`);
}

export function attackAlert(w, cityId, x, y) {
  const c = w.cityMap.get(cityId);
  if (!c || w.tick - c.lastAttack < 300) return;
  c.lastAttack = w.tick;
  w.event('attack', `${c.name} is under attack!`, x, y);
}

// ---------------- zombie update ----------------
function hitStructure(w, z, bid) {
  const b = w.bMap.get(bid);
  if (!b || b.dead || !b.city) return false;
  const d = w.BD[b.type];
  if (d.attackable === false) return false;
  w.damageBuilding(b, w.UD.zombie.dps * w.DT, true);
  return true;
}

function trapHit(w, z, t) {
  const b = w.bMap.get(w.bAt[t]);
  if (!b || !b.done) return;
  const d = w.BD[b.type];
  const dmg = d.dps * w.DT;
  w.damageUnit(z, dmg, null);
  b.hp -= dmg;
  if (b.hp <= 0) w.destroyBuilding(b, 'worn out');
}

export function updateZombie(w, z) {
  if (z.dormant) {
    if ((w.tick + z.id) % 10 === 0 && w.spatial.any(z.x, z.y, w.B.dormant.wakeHuman, false, false)) wakeCluster(w, z.cluster);
    return;
  }
  const t = w.tileOf(z.x, z.y);
  const night = w.isNight();
  const UD = w.UD.zombie, ZB = w.B.zombie;
  const ts = w.zSpeed[t];
  const spd = (night ? UD.nightSpeed : UD.speed) * (ts > 0 ? ts : 1);
  if (w.block[t] & B_TRAP) { trapHit(w, z, t); if (z.dead) return; }
  if ((w.tick + z.id) % 4 === 0) {
    const cur = w.unit(z.tgt);
    if (!(cur && !cur.dead && !cur.inside && Math.hypot(cur.x - z.x, cur.y - z.y) < ZB.leash)) {
      const h = w.spatial.nearest(z.x, z.y, night ? ZB.aggroNight : ZB.aggroDay, false);
      z.tgt = h ? h.id : 0;
    }
  }
  const h = z.tgt ? w.unit(z.tgt) : null;
  if (h && !h.dead && !h.inside) {
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d <= 1.1) { w.damageUnit(h, UD.dps * w.DT, z); return; }
    const r = w.steer(z, h.x, h.y, spd, true);
    if (r > 0) hitStructure(w, z, r);
    else if (r < 0) z.tgt = 0;
    return;
  }
  z.tgt = 0;
  const bid = w.bAt[t];
  if (bid && hitStructure(w, z, bid)) return;
  navigate(w, z, spd);
}

function steerTo(w, z, x, y, spd) {
  const r = w.steer(z, x, y, spd, true);
  if (r > 0) hitStructure(w, z, r);
  return r;
}

function navigate(w, z, spd) {
  const g = z.zg;
  if (!g) { z.zg = { t: 'pt', x: z.x, y: z.y, r: 15 }; return; }
  if (g.t === 'city') {
    const c = w.cityMap.get(g.c);
    if (!c) { const nc = nearestCity(w, z.x, z.y); z.zg = nc ? { t: 'city', c: nc.id } : { t: 'pt', x: z.x, y: z.y, r: 20 }; return; }
    const f = cityField(w, c);
    if (f) {
      const lx = (z.x | 0) - f.x0, ly = (z.y | 0) - f.y0;
      if (lx >= 0 && ly >= 0 && lx < f.w && ly < f.h && f.dist[ly * f.w + lx] < Infinity) { flowStep(w, z, f, spd); return; }
    } else if (Math.hypot(z.x - c.cx, z.y - c.cy) < 6) { z.zg = { t: 'pt', x: c.cx, y: c.cy, r: 20 }; return; }
    hier(w, z, w.tileOf(c.cx, c.cy), spd);
    return;
  }
  if (g.t === 'tile') {
    const gx = g.tile % w.W + 0.5, gy = ((g.tile / w.W) | 0) + 0.5;
    if (Math.hypot(z.x - gx, z.y - gy) < 8) { z.zg = { t: 'tile', tile: roamTarget(w, g.pack, g.leg + 1), pack: g.pack, leg: g.leg + 1 }; return; }
    hier(w, z, g.tile, spd);
    return;
  }
  // 'pt' wander (also nest defenders)
  let cx = g.x, cy = g.y, r = g.r;
  if (g.t === 'nest') { const b = w.bMap.get(g.b); if (!b) { z.zg = { t: 'pt', x: z.x, y: z.y, r: 15 }; return; } cx = b.x + 2; cy = b.y + 2; r = 7; }
  if (!z.wx || Math.hypot(z.x - z.wx, z.y - z.wy) < 0.8 || (w.tick + z.id) % 300 === 0) {
    const a = w.rng.next() * 6.2832, rr = w.rng.next() * r;
    z.wx = cx + Math.cos(a) * rr; z.wy = cy + Math.sin(a) * rr;
  }
  if (steerTo(w, z, z.wx, z.wy, spd * 0.5) < 0) z.wx = 0;
}

function flowStep(w, z, f, spd) {
  const W = w.W;
  const x = z.x | 0, y = z.y | 0;
  const lx = x - f.x0, ly = y - f.y0;
  let best = -1, bd = f.dist[ly * f.w + lx], bx = 0, by = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = lx + dx, ny = ly + dy;
    if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
    const dv = f.dist[ny * f.w + nx];
    if (dv >= bd) continue;
    if (dx && dy) {
      const a = (y) * W + x + dx, b = (y + dy) * W + x;
      if (w.tSpeed[a] <= 0 || w.tSpeed[b] <= 0 || (w.block[a] & BLOCK_Z) || (w.block[b] & BLOCK_Z)) continue;
    }
    bd = dv; best = 1; bx = x + dx; by = y + dy;
  }
  if (best < 0) return;
  const nt = by * W + bx;
  if (w.block[nt] & BLOCK_Z) { hitStructure(w, z, w.bAt[nt]); return; }
  steerTo(w, z, bx + 0.5, by + 0.5, spd);
}

function hier(w, z, goalTile, spd) {
  const zg = w.zg, W = w.W;
  const x = z.x | 0, y = z.y | 0, t = y * W + x;
  const n = zg.comp[t];
  let gt = goalTile;
  if (zg.comp[gt] < 0) gt = w.passableNear(gt, w.zgSpeed, 6);
  const gx = gt % W + 0.5, gy = ((gt / W) | 0) + 0.5;
  if (n < 0 || gt < 0) { steerTo(w, z, gx, gy, spd); return; }
  const gn = zg.comp[gt];
  if (n === gn) { steerTo(w, z, gx, gy, spd); return; }
  const f = zg.field(gn);
  if (f.dist[n] === Infinity) { steerTo(w, z, gx, gy, spd); return; }
  const dirs = zg.fieldDirs(f, n);
  const c = (n / MAXC) | 0, cx0 = (c % zg.CW) * CS, cy0 = ((c / zg.CW) | 0) * CS;
  const dc = dirs[(y - cy0) * CS + (x - cx0)];
  if (dc < 0) { const ct = zg.cen[f.next[n]]; steerTo(w, z, ct % W + 0.5, ((ct / W) | 0) + 0.5, spd); return; }
  const [dx, dy] = DIRS[dc];
  // aim at the far edge of the next tile for smoother motion
  const r = steerTo(w, z, x + dx + 0.5, y + dy + 0.5, spd);
  if (r < 0) { z.x = x + 0.5; z.y = y + 0.5; }
}

// Local zombie flow field around a city: walls are passable at a cost (zombies attack them).
export function cityField(w, c) {
  if (c._f !== undefined && c._fv === w.structVer) return c._f;
  c._fv = w.structVer;
  const L = lists(w, c).all;
  if (!L.length) { c._f = null; return null; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of L) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const M = 40, CAP = 240;
  x0 -= M; y0 -= M; x1 += M; y1 += M;
  if (x1 - x0 > CAP) { const m = (x0 + x1) >> 1; x0 = m - CAP / 2; x1 = m + CAP / 2; }
  if (y1 - y0 > CAP) { const m = (y0 + y1) >> 1; y0 = m - CAP / 2; y1 = m + CAP / 2; }
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(w.W - 1, x1 | 0); y1 = Math.min(w.H - 1, y1 | 0);
  const fw = x1 - x0 + 1, fh = y1 - y0 + 1, W = w.W;
  const dist = new Float32Array(fw * fh).fill(Infinity);
  const heap = new Heap(8192);
  for (const b of L) {
    if (w.BD[b.type].attackable === false) continue;
    w.forFoot(b, (t, x, y) => {
      if (x < x0 || y < y0 || x > x1 || y > y1) return;
      const li = (y - y0) * fw + (x - x0);
      dist[li] = 0; heap.push(li, 0);
    });
  }
  const pen = new Map();
  const penalty = t => {
    const id = w.bAt[t];
    let p = pen.get(id);
    if (p === undefined) { const b = w.bMap.get(id); p = b ? (w.BD[b.type].zCost || 15) : 15; pen.set(id, p); }
    return p;
  };
  while (heap.size > 0) {
    const pr = heap.p[0];
    const li = heap.pop();
    if (pr > dist[li]) continue;
    const lx = li % fw, ly = (li / fw) | 0;
    const t = (ly + y0) * W + lx + x0;
    const sp = w.zSpeed[t];
    // cost for a zombie to step INTO t
    const enter = (sp > 0 ? 1 / sp : 1) + ((w.block[t] & BLOCK_Z) ? penalty(t) : 0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = lx + dx, ny = ly + dy;
      if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
      const nt = (ny + y0) * W + nx + x0;
      if (w.tSpeed[nt] <= 0) continue;
      if (dx && dy) {
        const a = (ly + y0) * W + nx + x0, b = (ny + y0) * W + lx + x0;
        if (w.tSpeed[a] <= 0 || w.tSpeed[b] <= 0 || (w.block[a] & BLOCK_Z) || (w.block[b] & BLOCK_Z)) continue;
      }
      const nl = ny * fw + nx;
      const nd = Math.fround(pr + (dx && dy ? SQ2 : 1) * enter);
      if (nd < dist[nl]) { dist[nl] = nd; heap.push(nl, nd); }
    }
  }
  c._f = { x0, y0, w: fw, h: fh, dist };
  return c._f;
}

const sepBuf = [];
export function separate(w) {
  const S = w.spatial, r = w.B.zombie.separation, r2 = r * r;
  const U = w.units;
  for (let i = 0; i < U.length; i++) {
    const z = U[i];
    if (z.dead || !z.isZ || z.dormant || z.inside) continue;
    const cx = (z.x / S.cs) | 0, cy = (z.y / S.cs) | 0;
    let pushX = 0, pushY = 0, n = 0;
    for (let yy = cy - 1; yy <= cy + 1 && n < 6; yy++) for (let xx = cx - 1; xx <= cx + 1 && n < 6; xx++) {
      if (xx < 0 || yy < 0 || xx >= S.cw || yy >= S.ch) continue;
      for (let j = S.head[yy * S.cw + xx]; j >= 0 && n < 6; j = S.next[j]) {
        const o = U[j];
        if (o === z || o.dead || !o.isZ) continue;
        const dx = z.x - o.x, dy = z.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        n++;
        if (d2 < 1e-6) { pushX += ((z.id % 7) - 3) * 0.02; pushY += ((z.id % 5) - 2) * 0.02; continue; }
        const d = Math.sqrt(d2), k = (r - d) / d * 0.5;
        pushX += dx * k; pushY += dy * k;
      }
    }
    if (!n) continue;
    const nx = z.x + pushX * 0.5, ny = z.y + pushY * 0.5;
    if (!w.inMap(nx, ny)) continue;
    const nt = w.tileOf(nx, ny);
    if (nt === w.tileOf(z.x, z.y) || w.canEnter(nt, true)) { z.x = nx; z.y = ny; }
  }
}

// ---------------- dormant clusters ----------------
export function wakeCluster(w, cid) {
  if (!cid) return;
  let any = false;
  for (const u of w.units) {
    if (u.cluster !== cid || !u.dormant) continue;
    u.dormant = false; any = true;
    const c = nearestCity(w, u.x, u.y, 70);
    if (c) u.zg = { t: 'city', c: c.id };
  }
  if (any) { const z = w.units.find(u => u.cluster === cid); if (z) w.event('alert', 'Dormant zombies have awoken!', z.x, z.y); }
}
export function wakeNearBuilding(w, b) {
  const r = w.B.dormant.wakeBuilding, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const woke = new Set();
  for (const u of w.units) {
    if (!u.dormant || woke.has(u.cluster)) continue;
    if ((u.x - cx) ** 2 + (u.y - cy) ** 2 <= r * r) woke.add(u.cluster);
  }
  for (const c of woke) wakeCluster(w, c);
}

// ---------------- nests & threat ----------------
export function nests(w) { return w.buildings.filter(b => b.type === 'nest' && !b.dead); }

export function regionThreat(w) {
  const N = nests(w), cen = w.map.centroids;
  return cen.map(([x, y]) => {
    let s = 0;
    for (const b of N) s += (b.strength || 1) * 1000 / Math.max(60, Math.hypot(b.x + 2 - x, b.y + 2 - y));
    return Math.round(s);
  });
}

function randomTileInRegion(w, region, minDistFromCities, tries = 200) {
  const W = w.W, H = w.H;
  for (let i = 0; i < tries; i++) {
    const x = 2 + Math.floor(w.rng.next() * (W - 4)), y = 2 + Math.floor(w.rng.next() * (H - 4));
    const t = y * W + x;
    if (w.map.region[t] !== region || w.tSpeed[t] <= 0 || w.bAt[t]) continue;
    let ok = true;
    for (const c of w.cities) if (Math.hypot(c.cx - x, c.cy - y) < minDistFromCities) { ok = false; break; }
    if (ok) return [x + 0.5, y + 0.5];
  }
  return null;
}

export function initThreat(w) {
  const def = w.map.def;
  def.nests.forEach((n, i) => {
    const b = w.addBuilding('nest', n.pos[0] - 2, n.pos[1] - 2, 0, true);
    b.strength = n.strength; b.name = n.name; b.hp = w.BD.nest.hp * n.strength;
    b.maxHp = b.hp;
  });
  const D = w.B.dormant;
  const st = def.start;
  def.regions.forEach((r, ri) => {
    for (let k = 0; k < r.dormant; k++) {
      let p = null;
      for (let tries = 0; tries < 30 && !p; tries++) {
        const q = randomTileInRegion(w, ri, 0, 100);
        if (!q) continue;
        if (Math.hypot(q[0] - st[0], q[1] - st[1]) < D.minDistFromStart) continue;
        if (nests(w).some(b => Math.hypot(b.x + 2 - q[0], b.y + 2 - q[1]) < 15)) continue;
        p = q;
      }
      if (!p) continue;
      const cid = w.nextId++;
      const n = w.rng.int(D.minSize, D.maxSize);
      for (let j = 0; j < n; j++) {
        const q = zPassNear(w, p[0] + (w.rng.next() - 0.5) * 6, p[1] + (w.rng.next() - 0.5) * 6, 4);
        if (!q) continue;
        w.spawn('zombie', q[0], q[1], { dormant: true, cluster: cid, zg: { t: 'pt', x: p[0], y: p[1], r: 20 } });
      }
    }
  });
  w.threat = regionThreat(w);
  scheduleWave(w, 1, ((w.B.waves.firstDay - 1) * w.B.dayLength + w.B.dayTime + 30) / w.DT);
}

function scheduleWave(w, n, arrive) {
  const plan = Math.max(w.tick, arrive - w.B.waves.planAhead / w.DT);
  w.waves.list.push({ n, arrive: Math.round(arrive), plan: Math.round(plan), planned: false, announced: false, spawned: false, size: 0, city: 0, region: -1, spawnTick: 0, announceTick: 0, nests: [] });
}

function planWave(w, wave) {
  wave.planned = true;
  const thr = w.threat;
  const cands = w.cities.filter(c => c.hall || lists(w, c).all.length);
  const N = nests(w);
  const WV = w.B.waves;
  const next = () => scheduleWave(w, wave.n + 1, nightStart(w, wave.arrive + WV.interval * w.B.dayLength / w.DT) + w.rng.next() * 60 / w.DT);
  if (!cands.length || !N.length) { wave.spawned = true; wave.announced = true; next(); return; }
  let tot = 0; for (const c of cands) tot += Math.max(1, thr[c.region]);
  let r = w.rng.next() * tot, city = cands[0];
  for (const c of cands) { r -= Math.max(1, thr[c.region]); if (r <= 0) { city = c; break; } }
  wave.city = city.id; wave.region = city.region; wave.cityName = city.name;
  const gt = w.passableNear(w.tileOf(city.cx, city.cy), w.zgSpeed, 6);
  const costs = N.map(b => {
    const st = w.passableNear(w.tileOf(b.x + 2, b.y + 2), w.zgSpeed, 6);
    return { b, c: st >= 0 && gt >= 0 ? w.zg.pathCost(w.zg.comp[st], w.zg.comp[gt]) : Infinity };
  }).filter(o => isFinite(o.c)).sort((a, b) => a.c - b.c);
  if (!costs.length) { wave.spawned = true; next(); return; }
  const chosen = costs.filter(o => o.c <= costs[0].c * 1.35);
  wave.nests = chosen.map(o => o.b.id);
  const living = N.length, all = w.map.def.nests.length;
  wave.size = Math.round(WV.baseSize * Math.pow(WV.growth, wave.n - 1) * (WV.nestFactorMin + (1 - WV.nestFactorMin) * living / all));
  const travel = costs[0].c / 1.0 / w.DT;
  wave.spawnTick = Math.max(w.tick, Math.round(wave.arrive - travel));
  wave.announceTick = Math.max(w.tick, Math.min(wave.spawnTick, wave.arrive - w.B.dayLength / w.DT));
  next();
}

function nightStart(w, tick) {
  const dl = w.B.dayLength / w.DT, dt = w.B.dayTime / w.DT;
  const dayIdx = Math.floor(tick / dl);
  return dayIdx * dl + dt;
}

function spawnWave(w, wave) {
  wave.spawned = true;
  w.stats.waves++;
  const ns = wave.nests.map(id => w.bMap.get(id)).filter(Boolean);
  if (!ns.length || !w.cityMap.get(wave.city)) return;
  for (let i = 0; i < wave.size; i++) {
    const b = ns[i % ns.length];
    const a = w.rng.next() * 6.2832, r = 3.5 + w.rng.next() * 5;
    const q = zPassNear(w, b.x + 2 + Math.cos(a) * r, b.y + 2 + Math.sin(a) * r, 4);
    if (!q) continue;
    w.spawn('zombie', q[0], q[1], { zg: { t: 'city', c: wave.city }, wave: wave.n });
  }
  w.event('wave', `Wave ${wave.n} (${wave.size}) has left the nests for ${wave.cityName}!`, ns[0].x + 2, ns[0].y + 2);
}

export function roamTarget(w, pack, leg) {
  let h = Math.imul(pack ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(leg + 7, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 13;
  const cen = w.map.centroids;
  const i = (h >>> 0) % cen.length;
  const [x, y] = cen[i];
  const ox = (((h >>> 8) & 63) - 32), oy = (((h >>> 16) & 63) - 32);
  const t = w.passableNear(w.tileOf(Math.max(2, Math.min(w.W - 3, x + ox)), Math.max(2, Math.min(w.H - 3, y + oy))), w.zgSpeed, 8);
  return t >= 0 ? t : w.tileOf(x, y);
}

function spawnPack(w) {
  const S = w.B.skirmish;
  let roaming = 0;
  for (const u of w.units) if (u.isZ && !u.dormant && u.zg && (u.zg.t === 'tile' || u.zg.t === 'pt')) roaming++;
  if (roaming > 600) return;
  const thr = w.threat;
  let tot = 0; thr.forEach(v => tot += v + 5);
  let r = w.rng.next() * tot, region = 0;
  for (let i = 0; i < thr.length; i++) { r -= thr[i] + 5; if (r <= 0) { region = i; break; } }
  const p = randomTileInRegion(w, region, 70, 150);
  if (!p) return;
  const n = w.rng.int(S.packMin, S.packMax);
  const pack = w.nextId++;
  const tile = roamTarget(w, pack, 0);
  for (let i = 0; i < n; i++) {
    const q = zPassNear(w, p[0] + (w.rng.next() - 0.5) * 5, p[1] + (w.rng.next() - 0.5) * 5, 4);
    if (q) w.spawn('zombie', q[0], q[1], { zg: { t: 'tile', tile, pack, leg: 0 } });
  }
}

function spillover(w, b) {
  const S = w.B.skirmish;
  const cx = b.x + 2, cy = b.y + 2;
  // nearest human activity: closest human unit, else closest city
  let target = null, bd = S.spillRange;
  for (const c of w.cities) { const d = Math.hypot(c.cx - cx, c.cy - cy); if (d < bd) { bd = d; target = c; } }
  const n = w.rng.int(S.spillMin, S.spillMax);
  const pack = w.nextId++;
  for (let i = 0; i < n; i++) {
    const a = w.rng.next() * 6.2832;
    const q = zPassNear(w, cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, 4);
    if (!q) continue;
    w.spawn('zombie', q[0], q[1], { zg: target ? { t: 'city', c: target.id } : { t: 'tile', tile: roamTarget(w, pack, 0), pack, leg: 0 } });
  }
  if (target) w.event('raid', `A raid of ${n} leaves ${b.name || 'a nest'} toward ${target.name}`, cx, cy);
}

export function updateNest(w, b) {
  const NB = w.B.nest;
  if (w.tick - b.lastHit < 30) {
    b.spawnT -= w.DT;
    if (b.spawnT <= 0) {
      b.spawnT = NB.defenderInterval;
      let n = 0; for (const u of w.units) if (u.isZ && u.nest === b.id && !u.dead) n++;
      if (n < NB.defenderCap) {
        const a = w.rng.next() * 6.2832;
        const q = zPassNear(w, b.x + 2 + Math.cos(a) * 3, b.y + 2 + Math.sin(a) * 3, 3);
        if (q) {
          const z = w.spawn('zombie', q[0], q[1], { zg: { t: 'nest', b: b.id }, nest: b.id });
          const h = w.spatial.nearest(q[0], q[1], NB.defendRadius, false);
          if (h) z.tgt = h.id;
        }
      }
    }
  }
  // Daily spillover raid at a per-nest time of day
  const dayTicks = w.B.dayLength / w.DT;
  if (w.day() >= w.B.skirmish.spillStartDay && (w.tick + b.id * 977) % dayTicks === 0) spillover(w, b);
}

export function nestDestroyed(w, b) {
  w.stats.nestsDestroyed = (w.stats.nestsDestroyed || 0) + 1;
  w.event('nest', `${b.name || 'A nest'} has been destroyed!`, b.x + 2, b.y + 2);
  for (const u of w.units) if (u.isZ && u.nest === b.id) { u.nest = 0; const c = nearestCity(w, u.x, u.y); u.zg = c ? { t: 'city', c: c.id } : { t: 'pt', x: u.x, y: u.y, r: 20 }; }
  const left = w.buildings.filter(o => o.type === 'nest' && !o.dead && o !== b);
  if (!left.length) w.win();
}

export function updateThreat(w) {
  if (w.tick % 100 === 0) w.threat = regionThreat(w);
  // corpses rise
  for (let i = w.corpses.length - 1; i >= 0; i--) {
    const c = w.corpses[i];
    c.t -= w.DT;
    if (c.t <= 0) { w.corpses.splice(i, 1); raise(w, c.x, c.y, c.city); }
  }
  // waves
  for (const wave of w.waves.list) {
    if (!wave.planned && w.tick >= wave.plan) planWave(w, wave);
    if (wave.planned && !wave.announced && w.tick >= wave.announceTick) {
      wave.announced = true;
      w.event('wave', `Wave ${wave.n} (${wave.size} zombies) is coming for ${wave.cityName}!`, null, null);
    }
    if (wave.planned && !wave.spawned && w.tick >= wave.spawnTick) spawnWave(w, wave);
  }
  w.waves.list = w.waves.list.filter(v => !(v.spawned && w.tick > v.arrive + 3000));
  // roaming packs
  const S = w.B.skirmish;
  w.waves.packT -= w.DT * (w.isNight() ? S.nightMult : 1);
  if (w.waves.packT <= 0) {
    w.waves.packT = S.packInterval;
    if (w.day() >= S.packStartDay) spawnPack(w);
  }
}
