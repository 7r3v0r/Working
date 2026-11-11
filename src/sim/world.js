// Core simulation state. Pure JS, no DOM. Fixed timestep (balance.dt), seeded RNG, deterministic.
import { RNG } from './rng.js';
import { buildMap, TER } from './map.js';
import { Graph, TilePather, CS, MAXC } from './pathing.js';
import { Spatial } from './spatial.js';
import * as Civ from './civ.js';
import * as Mil from './military.js';
import * as Zom from './zombies.js';
import * as Log from './logistics.js';
import { updateVision } from './vision.js';

export const BLOCK_H = 1, BLOCK_Z = 2, B_DITCH = 4, B_TRAP = 8;

export const STATE_KEYS = ['tick', 'nextId', 'rngState', 'units', 'buildings', 'cities', 'squads', 'routes', 'parties',
  'corpses', 'waves', 'threat', 'research', 'stats', 'status', 'roadDiff', 'exploredRLE', 'capital', 'effects'];

export class World {
  constructor(defs, map = null) {
    this.defs = defs;
    this.B = defs.balance; this.UD = defs.units; this.BD = defs.buildings.types; this.RD = defs.research;
    this.DT = this.B.dt;
    this.map = map || buildMap(defs.map);
    const W = this.W = this.map.W, H = this.H = this.map.H, N = this.N = W * H;
    this.terSpeed = this.B.terrain.speed;
    this.block = new Uint8Array(N);
    this.bAt = new Int32Array(N);
    this.road = new Uint8Array(N);
    this.tSpeed = new Float32Array(N);   // terrain + road, ignoring structures
    this.hSpeed = new Float32Array(N);   // humans: 0 where walls/towers block
    this.kSpeed = new Float32Array(N);   // humans' known map: hSpeed where explored, open ground elsewhere
    this.kDirty = new Set();             // coarse-graph chunks whose known speed changed
    this.zSpeed = new Float32Array(N);   // zombies: ditches slow; walls handled as attack targets
    this.zgSpeed = new Float32Array(N);  // zombie coarse graph: terrain passability only
    this.explored = new Uint8Array(N);
    this.visible = new Uint8Array(N);
    this.spatial = new Spatial(W, H, 4);
    this.tp = new TilePather(W, H, 220);
    this.events = [];
    this.fx = [];               // transient render effects (not saved)
    this.dirtyTiles = [];       // ground tiles changed since last render (not saved)
    this.visionTick = 0;
    this.structVer = 1;
    this.allowVal = 0;
  }

  // ---------- setup ----------
  newGame(seed = 12345) {
    this.tick = 0; this.nextId = 1; this.rng = new RNG(seed);
    this.units = []; this.buildings = []; this.cities = []; this.squads = []; this.routes = []; this.parties = [];
    this.corpses = []; this.effects = [];
    this.unitMap = new Map(); this.bMap = new Map(); this.cityMap = new Map(); this.squadMap = new Map();
    this.research = { rp: 0, done: [] };
    this.stats = { killed: 0, lost: 0, waves: 0 };
    this.status = { state: 'playing', reason: '' };
    this.waves = { list: [], next: 1, packT: 0 };
    this.threat = [];
    this.road.set(this.map.road);
    this.initDerived();
    const st = this.map.def.start;
    const city = Civ.createCity(this, this.map.region[st[1] * this.W + st[0]], st[0], st[1], true);
    this.capital = city.id;
    const hall = this.addBuilding('townhall', st[0] - 1, st[1] - 1, city.id, true);
    city.hall = hall.id;
    Object.assign(city.stock, this.B.start.stock);
    for (let i = 0; i < this.B.start.civilians; i++) {
      const a = this.rng.next() * Math.PI * 2, r = 3 + this.rng.next() * 4;
      this.spawn('civ', st[0] + 0.5 + Math.cos(a) * r, st[1] + 0.5 + Math.sin(a) * r, { city: city.id });
    }
    const sq = Mil.newSquad(this, city.id, `${city.name} Guard 1`, true);
    for (const [k, n] of Object.entries(this.B.start.soldiers || {})) for (let i = 0; i < n; i++) {
      const x = st[0] + 3.5 + (i % 3) * 1.3, y = st[1] + 3.5 + (k === 'archer' ? 1.3 : 0);
      Mil.addToSquad(this, this.spawn(k, x, y, { city: city.id, dx: x, dy: y }), sq);
    }
    Zom.initThreat(this);
    this.revealAround(st[0], st[1], 40);
    updateVision(this);
    this.event('info', 'Your people settle in Heartland. The dead stir in the east.', st[0], st[1]);
  }

  initDerived() {
    const N = this.N, ter = this.map.terrain;
    for (let t = 0; t < N; t++) this.refreshTile(t);
    for (let t = 0; t < N; t++) this.zgSpeed[t] = this.terSpeed[ter[t]] > 0 ? this.terSpeed[ter[t]] : (this.road[t] ? 0.5 : 0);
    this.hg = new Graph(this.W, this.H, this.kSpeed, 0.5);
    this.kDirty.clear();
    this.zg = new Graph(this.W, this.H, this.zgSpeed, 0.8);
    this.hg.rebuildAll(); this.zg.rebuildAll();
    this.allowMark = new Uint32Array(this.hg.NN);
  }

  // Rebuild every derived structure after loading state.
  rebuildDerived() {
    this.unitMap = new Map(); for (const u of this.units) this.unitMap.set(u.id, u);
    this.bMap = new Map(); for (const b of this.buildings) this.bMap.set(b.id, b);
    this.cityMap = new Map(); for (const c of this.cities) this.cityMap.set(c.id, c);
    this.squadMap = new Map(); for (const s of this.squads) this.squadMap.set(s.id, s);
    this.block.fill(0); this.bAt.fill(0);
    for (const b of this.buildings) {
      this.forFoot(b, t => { this.bAt[t] = b.id; });
      if (b.done) this.applyBlock(b, true);
    }
    this.initDerived();
    this.structVer++;
  }

  // ---------- time ----------
  time() { return this.tick * this.DT; }
  day() { return Math.floor(this.time() / this.B.dayLength) + 1; }
  tod() { return this.time() % this.B.dayLength; }
  isNight() { return this.tod() >= this.B.dayTime; }

  event(kind, msg, x = null, y = null) { this.events.push({ kind, msg, x, y, tick: this.tick }); }

  // ---------- tiles ----------
  baseSpeed(t) {
    const r = this.road[t];
    if (r) return r === 2 ? this.B.roads.stone.mult : this.B.roads.dirt.mult;
    return this.terSpeed[this.map.terrain[t]];
  }
  refreshTile(t) {
    const s = this.baseSpeed(t);
    this.tSpeed[t] = s;
    this.hSpeed[t] = (this.block[t] & BLOCK_H) ? 0 : s;
    this.kSpeed[t] = this.explored[t] ? this.hSpeed[t] : 1;
    this.zSpeed[t] = s * ((this.block[t] & B_DITCH) ? 0.5 : 1);
  }
  tileOf(x, y) { return (y | 0) * this.W + (x | 0); }
  inMap(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  regionAt(x, y) { return this.map.region[(y | 0) * this.W + (x | 0)]; }
  canEnter(t, isZ) { return isZ ? (this.tSpeed[t] > 0 && !(this.block[t] & BLOCK_Z)) : this.hSpeed[t] > 0; }
  passableNear(t, sp, r) {
    if (sp[t] > 0) return t;
    const W = this.W, x = t % W, y = (t / W) | 0;
    let best = -1, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
      const nt = ny * W + nx;
      if (sp[nt] <= 0) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = nt; }
    }
    return best;
  }
  revealAround(x, y, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = x + dx, ny = y + dy;
      if (this.inMap(nx, ny)) this.explore(ny * this.W + nx);
    }
    this.flushExplore();
  }
  // Mark a tile explored. Human pathing plans on the known map, so newly seen terrain
  // (a river, a cliff) updates it; call flushExplore() afterwards to rebuild the graph.
  explore(t) {
    if (this.explored[t]) return;
    this.explored[t] = 1;
    const s = this.hSpeed[t];
    if (this.kSpeed[t] === s) return;
    this.kSpeed[t] = s;
    this.kDirty.add(((((t / this.W) | 0) / CS) | 0) * this.hg.CW + (((t % this.W) / CS) | 0));
  }
  flushExplore() {
    if (!this.kDirty.size) return;
    for (const c of this.kDirty) this.hg._chunk(c);
    this.kDirty.clear();
    this.hg.ver++;
  }
  setRoad(t, val) {
    const wasBridge = this.zgSpeed[t] === 0 || this.map.terrain[t] === TER.RIVER;
    this.road[t] = val;
    this.dirtyTiles.push(t);
    this.refreshTile(t);
    this.hg.rebuildAt(t);
    if (wasBridge) {
      const ter = this.map.terrain[t];
      this.zgSpeed[t] = this.terSpeed[ter] > 0 ? this.terSpeed[ter] : (val ? 0.5 : 0);
      this.zg.rebuildAt(t);
    }
    this.structVer++;
  }

  // ---------- units ----------
  spawn(k, x, y, extra = {}) {
    const d = this.UD[k];
    const u = {
      id: this.nextId++, k, isZ: k === 'zombie', x, y, px: x, py: y, hp: d.hp, dead: false, inside: 0,
      city: 0, path: null, pi: 0, coarse: null, ci: 0, goalT: -1, task: 'idle', timer: 0, tgt: 0, fails: 0,
      job: 0, home: 0, carry: null, hasIn: false,
      squad: 0, dx: x, dy: y, needPath: false, chased: false, garrisonB: 0, arrived: true,
      zg: null, dormant: false, cluster: 0, cd: 0,
      route: 0, cargo: null, settler: 0, tb: 0, pathFor: 0, wx: 0, wy: 0, nest: 0, wave: 0, depot: 0,
    };
    Object.assign(u, extra);
    this.units.push(u);
    this.unitMap.set(u.id, u);
    return u;
  }
  unit(id) { return id ? this.unitMap.get(id) : undefined; }

  killUnit(u, cause) {
    if (u.dead) return;
    u.dead = true;
    if (u.inside) {
      const b = this.bMap.get(u.inside);
      if (b) { const i = b.inside.indexOf(u.id); if (i >= 0) b.inside.splice(i, 1); }
    }
    if (u.job) Civ.unassign(this, u, true);
    if (u.home) { const h = this.bMap.get(u.home); if (h) { const i = h.residents.indexOf(u.id); if (i >= 0) h.residents.splice(i, 1); } u.home = 0; }
    if (u.squad) Mil.removeFromSquad(this, u);
    if (u.isZ) { this.stats.killed++; return; }
    this.stats.lost++;
    if (u.k === 'cart') { this.event('cart', 'A cart was destroyed', u.x, u.y); return; }
    if (cause === 'zombie') this.corpses.push({ x: u.x, y: u.y, t: this.B.zombie.riseDelay, city: u.city });
    else if (cause === 'starve') Zom.raise(this, u.x, u.y, u.city);
  }

  // ---------- buildings ----------
  forFoot(b, fn) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) fn(y * this.W + x, x, y);
  }
  addBuilding(type, x, y, city, done = false) {
    const d = this.BD[type];
    const b = {
      id: this.nextId++, type, x, y, w: d.w, h: d.h, city, hp: Math.max(1, Math.round(d.hp * 0.3)), done: false, prog: 0,
      workers: [], residents: [], inside: [], queue: [], trainT: 0, cd: 0,
      infected: false, infT: 0, infHp: 0, infCount: 0, lastHit: -1e9, spawnT: 0, dead: false,
      training: null, stall: '', crewed: false, yieldF: 1, breach: 0,
    };
    this.buildings.push(b);
    this.bMap.set(b.id, b);
    this.forFoot(b, t => { this.bAt[t] = b.id; });
    this.structVer++;
    if (done || d.build <= 0) this.completeBuilding(b);
    return b;
  }
  applyBlock(b, on) {
    const d = this.BD[b.type];
    let bits = 0;
    if (d.blockH) bits |= BLOCK_H;
    if (d.blockZ) bits |= BLOCK_Z;
    if (d.ditch) bits |= B_DITCH;
    if (d.trap) bits |= B_TRAP;
    if (!bits) return false;
    this.forFoot(b, t => { if (on) this.block[t] |= bits; else this.block[t] &= ~bits; });
    return !!(bits & BLOCK_H) || !!(bits & B_DITCH);
  }
  refreshFoot(b, graph) {
    const chunks = new Set();
    this.forFoot(b, (t, x, y) => { this.refreshTile(t); chunks.add(((y / CS) | 0) * this.hg.CW + ((x / CS) | 0)); });
    if (graph) for (const c of chunks) { this.hg._chunk(c); }
    if (graph) this.hg.ver++;
  }
  completeBuilding(b) {
    const d = this.BD[b.type];
    b.done = true; b.prog = 1; b.hp = d.hp;
    if (d.trap) b.hp = d.hp;
    const g = this.applyBlock(b, true);
    this.refreshFoot(b, g || d.blockH);
    this.structVer++;
    if (!d.zombie) Zom.wakeNearBuilding(this, b);
    if (!d.zombie && !d.line && b.city) this.event('built', `${d.name} completed`, b.x + b.w / 2, b.y + b.h / 2);
  }
  destroyBuilding(b, cause = 'destroyed') {
    if (b.dead) return;
    const d = this.BD[b.type];
    b.dead = true;
    if (b.done) { const g = this.applyBlock(b, false); this.forFoot(b, t => { this.bAt[t] = 0; }); this.refreshFoot(b, g || d.blockH); }
    else this.forFoot(b, t => { this.bAt[t] = 0; });
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    // occupants
    const inside = b.inside.slice();
    b.inside.length = 0;
    for (const id of inside) {
      const u = this.unitMap.get(id);
      if (!u || u.dead) continue;
      u.inside = 0;
      if (u.k !== 'civ' || !u.job) { /* soldiers leave tower */ }
      u.x = cx + (this.rng.next() - 0.5) * b.w; u.y = cy + (this.rng.next() - 0.5) * b.h;
      const t = this.tileOf(u.x, u.y);
      if (!this.canEnter(t, false)) { const p = this.passableNear(t, this.hSpeed, 4); if (p >= 0) { u.x = p % this.W + 0.5; u.y = ((p / this.W) | 0) + 0.5; } }
      u.task = 'idle'; u.path = null;
    }
    if (b.infected && b.infCount > 0) {
      for (let i = 0; i < b.infCount; i++) Zom.raise(this, cx + (this.rng.next() - 0.5) * (b.w + 1), cy + (this.rng.next() - 0.5) * (b.h + 1), b.city);
    }
    for (const id of b.workers.slice()) { const u = this.unitMap.get(id); if (u) Civ.unassign(this, u); }
    for (const id of b.residents) { const u = this.unitMap.get(id); if (u) u.home = 0; }
    b.residents.length = 0;
    for (const u of this.units) if (u.garrisonB === b.id) u.garrisonB = 0;
    const city = this.cityMap.get(b.city);
    if (b.type === 'townhall' && city && city.hall === b.id) {
      city.hall = 0;
      if (city.id === this.capital) this.lose(`${city.name}'s town hall was ${cause}.`);
      else this.event('alert', `${city.name}'s town hall was ${cause}!`, cx, cy);
    } else if (!d.line && b.city && !d.zombie) {
      this.event('alert', `${d.name} ${cause} in ${city ? city.name : 'the wilds'}`, cx, cy);
    }
    if (d.zombie) Zom.nestDestroyed(this, b);
    this.structVer++;
  }
  damageBuilding(b, dmg, byZ) {
    if (b.dead) return;
    const d = this.BD[b.type];
    b.hp -= dmg;
    b.lastHit = this.tick;
    if (byZ && !b.infected && !d.defense && b.inside.length > 0 && b.city) {
      b.breach = (b.breach || 0) + dmg;
      if (b.breach >= (d.infectResist || 0)) Zom.infect(this, b);
    }
    if (byZ && b.city) Zom.attackAlert(this, b.city, b.x, b.y);
    if (b.hp <= 0) this.destroyBuilding(b, b.infected ? 'overrun' : 'destroyed');
  }

  enter(u, b) {
    u.inside = b.id; b.inside.push(u.id);
    u.x = b.x + b.w / 2; u.y = b.y + b.h / 2; u.path = null; u.coarse = null;
  }
  exit(u) {
    const b = this.bMap.get(u.inside);
    u.inside = 0;
    if (!b) return;
    const i = b.inside.indexOf(u.id); if (i >= 0) b.inside.splice(i, 1);
    const d = this.BD[b.type];
    if (d.blockH) {
      const t = this.passableNear(this.tileOf(b.x + b.w / 2, b.y + b.h), this.hSpeed, 3);
      if (t >= 0) { u.x = t % this.W + 0.5; u.y = ((t / this.W) | 0) + 0.5; }
    }
  }
  // Tile a unit should walk to in order to reach a building.
  approach(b, fromX, fromY) {
    const d = this.BD[b.type];
    if (!d.blockH) return this.tileOf(b.x + b.w / 2, b.y + b.h / 2);
    let best = -1, bd = Infinity;
    for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
      if (!this.inMap(x, y)) continue;
      const t = y * this.W + x;
      if (this.hSpeed[t] <= 0) continue;
      const dd = (x + 0.5 - fromX) ** 2 + (y + 0.5 - fromY) ** 2;
      if (dd < bd) { bd = dd; best = t; }
    }
    return best;
  }
  distToBuilding(x, y, b) {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    return Math.hypot(dx, dy);
  }

  // ---------- pathing ----------
  planPath(u, gx, gy) {
    const W = this.W, sp = this.kSpeed;
    const sx = Math.max(0, Math.min(W - 1, u.x | 0)), sy = Math.max(0, Math.min(this.H - 1, u.y | 0));
    let gt = this.passableNear(Math.max(0, Math.min(this.H - 1, gy | 0)) * W + Math.max(0, Math.min(W - 1, gx | 0)), sp, 6);
    u.path = null; u.coarse = null; u.pi = 0; u.ci = 0;
    if (gt < 0) return false;
    u.goalT = gt;
    const gtx = gt % W, gty = (gt / W) | 0;
    const cheb = Math.max(Math.abs(gtx - sx), Math.abs(gty - sy));
    if (cheb <= 40) {
      const m = 14;
      const p = this.tp.find(sx, sy, gtx, gty, sp, Math.min(sx, gtx) - m, Math.min(sy, gty) - m, Math.max(sx, gtx) + m, Math.max(sy, gty) + m, null, 5000);
      if (p) { u.path = p; return true; }
    }
    let st = sy * W + sx;
    if (sp[st] <= 0) st = this.passableNear(st, sp, 3);
    if (st < 0) return false;
    const cp = this.hg.path(this.hg.comp[st], this.hg.comp[gt]);
    if (!cp) return false;
    u.coarse = cp; u.ci = 0;
    return this.nextSegment(u);
  }
  nextSegment(u) {
    const hg = this.hg, W = this.W, cp = u.coarse;
    if (!cp) return false;
    const sx = u.x | 0, sy = u.y | 0;
    const curN = hg.comp[sy * W + sx];
    let idx = curN >= 0 ? cp.indexOf(curN, Math.max(0, u.ci - 3)) : -1;
    if (idx < 0) idx = Math.min(u.ci, cp.length - 1);
    const end = Math.min(idx + 5, cp.length - 1);
    const last = end === cp.length - 1;
    const tgt = last ? u.goalT : hg.cen[cp[end]];
    const mark = this.allowMark, val = ++this.allowVal;
    let bx0 = sx, by0 = sy, bx1 = sx, by1 = sy;
    const addN = n => {
      mark[n] = val;
      const c = (n / MAXC) | 0, cx = (c % hg.CW) * CS, cy = ((c / hg.CW) | 0) * CS;
      if (cx < bx0) bx0 = cx; if (cy < by0) by0 = cy;
      if (cx + CS - 1 > bx1) bx1 = cx + CS - 1; if (cy + CS - 1 > by1) by1 = cy + CS - 1;
    };
    for (let i = Math.max(0, idx - 1); i <= end; i++) addN(cp[i]);
    if (curN >= 0) addN(curN);
    const gx = tgt % W, gy = (tgt / W) | 0;
    let p = this.tp.find(sx, sy, gx, gy, this.kSpeed, bx0, by0, bx1, by1, { comp: hg.comp, mark, val }, 6000);
    if (!p) p = this.tp.find(sx, sy, gx, gy, this.kSpeed, Math.min(bx0, gx) - 12, Math.min(by0, gy) - 12, Math.max(bx1, gx) + 12, Math.max(by1, gy) + 12, null, 9000);
    if (!p) { u.path = null; u.coarse = null; return false; }
    u.path = p; u.pi = 0; u.ci = end;
    if (last) u.coarse = null;
    return true;
  }
  // Returns 0 moving, 1 path finished, -1 blocked.
  followPath(u, spd) {
    if (!u.path) return 1;
    let budget = spd * this.DT;
    const W = this.W;
    let guard = 0;
    while (budget > 1e-6) {
      const p = u.path;
      if (!p) return 1;
      if (u.pi >= p.length) {
        if (u.coarse && guard++ < 3) { if (!this.nextSegment(u)) return -1; continue; }
        u.path = null; u.coarse = null; return 1;
      }
      const t = p[u.pi];
      if (this.hSpeed[t] <= 0) {
        // Blocked: an obstacle the unit hadn't seen, or a new wall. Learn it and reroute.
        this.explore(t); this.flushExplore();
        const g = u.goalT;
        if (g !== undefined && guard++ < 3 && this.planPath(u, g % W + 0.5, ((g / W) | 0) + 0.5)) continue;
        u.path = null; u.coarse = null; return -1;
      }
      const tx = t % W + 0.5, ty = ((t / W) | 0) + 0.5;
      const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
      if (d <= budget) { u.x = tx; u.y = ty; budget -= d; u.pi++; }
      else { u.x += dx / d * budget; u.y += dy / d * budget; budget = 0; }
    }
    if (u.path && u.pi >= u.path.length && !u.coarse) { u.path = null; return 1; }
    return 0;
  }
  humanSpeed(u) {
    const s = this.hSpeed[this.tileOf(u.x, u.y)];
    return (s > 0 ? s : 1) * this.UD[u.k].speed;
  }
  // Straight-line step with sliding. Returns 0 moved, building id if a zombie is blocked by a structure, -1 stuck.
  steer(u, tx, ty, spd, isZ) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d < 1e-4) return 0;
    const step = Math.min(d, spd * this.DT);
    const nx = u.x + dx / d * step, ny = u.y + dy / d * step;
    const W = this.W;
    const cx = u.x | 0, cy = u.y | 0, ntx = nx | 0, nty = ny | 0;
    if (ntx === cx && nty === cy) { u.x = nx; u.y = ny; return 0; }
    if (!this.inMap(ntx, nty)) return -1;
    const nt = nty * W + ntx;
    const diag = ntx !== cx && nty !== cy;
    if (this.canEnter(nt, isZ) && (!diag || (this.canEnter(cy * W + ntx, isZ) && this.canEnter(nty * W + cx, isZ)))) { u.x = nx; u.y = ny; return 0; }
    if (isZ) {
      if (this.block[nt] & BLOCK_Z) return this.bAt[nt];
      if (diag) {
        const a = cy * W + ntx, b2 = nty * W + cx;
        if (this.block[a] & BLOCK_Z) return this.bAt[a];
        if (this.block[b2] & BLOCK_Z) return this.bAt[b2];
      }
    }
    if (ntx !== cx && this.canEnter(cy * W + ntx, isZ)) { u.x = nx; return 0; }
    if (nty !== cy && this.canEnter(nty * W + cx, isZ)) { u.y = ny; return 0; }
    return -1;
  }

  damageUnit(t, dmg, attacker) {
    if (t.dead) return;
    t.hp -= dmg;
    if (t.isZ && t.dormant) Zom.wakeCluster(this, t.cluster);
    if (t.hp <= 0) this.killUnit(t, attacker && attacker.isZ ? 'zombie' : 'combat');
    else if (!t.isZ && attacker && attacker.isZ && t.city) Zom.attackAlert(this, t.city, t.x, t.y);
  }

  has(tech) { return this.research.done.includes(tech); }

  lose(reason) {
    if (this.status.state !== 'playing') return;
    this.status = { state: 'lost', reason };
    this.event('lost', `Defeat: ${reason}`);
  }
  win() {
    if (this.status.state !== 'playing') return;
    this.status = { state: 'won', reason: 'Every zombie nest has been destroyed.' };
    this.event('won', 'Victory! Every nest is destroyed.');
  }

  // ---------- main step ----------
  step() {
    if (this.status.state !== 'playing') return;
    this.tick++;
    const units = this.units;
    for (let i = 0; i < units.length; i++) { const u = units[i]; u.px = u.x; u.py = u.y; }
    this.spatial.build(units);
    Civ.updateCities(this);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead) continue;
      if (u.isZ) Zom.updateZombie(this, u);
      else if (u.k === 'civ') Civ.updateCiv(this, u);
      else if (u.k === 'cart') Log.updateCart(this, u);
      else Mil.updateSoldier(this, u);
    }
    if (this.tick % 2 === 0) Zom.separate(this);
    this.updateBuildings();
    Mil.updateSquads(this);
    Log.updateLogistics(this);
    Zom.updateThreat(this);
    if (this.tick % 5 === 0) { updateVision(this); this.visionTick = this.tick; }
    // cleanup
    let j = 0;
    for (let i = 0; i < units.length; i++) { const u = units[i]; if (u.dead) this.unitMap.delete(u.id); else units[j++] = u; }
    units.length = j;
    if (this.buildings.some(b => b.dead)) {
      this.buildings = this.buildings.filter(b => { if (b.dead) this.bMap.delete(b.id); return !b.dead; });
    }
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.tick - this.fx[i].tick > 6) this.fx.splice(i, 1);
  }

  updateBuildings() {
    const DT = this.DT;
    for (const b of this.buildings) {
      if (b.dead) continue;
      const d = this.BD[b.type];
      if (!b.done) {
        b.prog += DT / d.build;
        b.hp = Math.min(d.hp, b.hp + d.hp * 0.7 * DT / d.build);
        if (b.prog >= 1) this.completeBuilding(b);
        continue;
      }
      if (b.infected) {
        b.infT -= DT;
        if (b.infT <= 0) this.destroyBuilding(b, 'overrun');
        continue;
      }
      if (b.breach > 0) b.breach = Math.max(0, b.breach - DT);
      if (d.train) Mil.updateBarracks(this, b);
      else if (d.carts) Log.updateDepot(this, b);
      else if (d.artillery) Mil.updateArtillery(this, b);
      else if (d.zombie) Zom.updateNest(this, b);
    }
  }

  // ---------- commands (from UI) ----------
  cmd(c) {
    switch (c.t) {
      case 'build': return Civ.cmdBuild(this, c);
      case 'line': return Civ.cmdLine(this, c);
      case 'demolish': { const b = this.bMap.get(c.b); if (b && b.city && b.type !== 'nest') { this.destroyBuilding(b, 'demolished'); } return { ok: true }; }
      case 'priority': { const city = this.cityMap.get(c.city); if (city) city.pri[c.cat] = c.val; return { ok: true }; }
      case 'research': return Civ.cmdResearch(this, c);
      case 'order': return Mil.cmdOrder(this, c);
      case 'train': return Mil.cmdTrain(this, c);
      case 'cancelTrain': return Mil.cmdCancelTrain(this, c);
      case 'merge': return Mil.cmdMerge(this, c);
      case 'group': return Mil.cmdGroup(this, c);
      case 'split': return Mil.cmdSplit(this, c);
      case 'buildCart': return Log.cmdBuildCart(this, c);
      case 'route': return Log.cmdRoute(this, c);
      case 'delRoute': return Log.cmdDelRoute(this, c);
      case 'found': return Log.cmdFound(this, c);
    }
    return { ok: false, reason: 'unknown command' };
  }
}
