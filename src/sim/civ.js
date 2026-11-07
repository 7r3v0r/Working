// Cities, civilians, jobs, production chains, housing, growth, starvation, construction commands, research.
import { TER, DEP, TER_NAMES, DEP_NAMES } from './map.js';
import * as Zom from './zombies.js';

export const CATS = ['food', 'materials', 'industry', 'military', 'research'];

export function createCity(w, region, cx, cy, capital = false) {
  const stock = {};
  for (const r of w.B.resources) stock[r] = 0;
  const c = {
    id: w.nextId++, name: w.map.def.regions[region].name, region, cx, cy, hall: 0, stock, capital,
    pri: { food: 5, materials: 4, industry: 3, military: 3, research: 2 },
    foodDebt: 0, starveT: 0, trend: 0, prodAcc: 0, consAcc: 0, nCiv: 0, nSol: 0, housing: 0, lastAttack: -1e9,
  };
  w.cities.push(c); w.cityMap.set(c.id, c);
  return c;
}

export function cityOfRegion(w, region) {
  for (const c of w.cities) if (c.region === region) return c;
  return null;
}

// Cached per-city building lists, rebuilt when any structure changes.
export function lists(w, c) {
  if (c._lv === w.structVer && c._l) return c._l;
  const L = { all: [], drops: [], houses: [], work: [], barracks: [], depots: [] };
  for (const b of w.buildings) {
    if (b.dead || b.city !== c.id) continue;
    const d = w.BD[b.type];
    if (d.line) continue;
    L.all.push(b);
    if (!b.done) continue;
    if (d.drop) L.drops.push(b);
    if (d.housing) L.houses.push(b);
    if (d.workers) L.work.push(b);
    if (d.train) L.barracks.push(b);
    if (d.carts) L.depots.push(b);
  }
  c._l = L; c._lv = w.structVer;
  return L;
}

export function nearestDrop(w, c, res, x, y) {
  const L = lists(w, c);
  let best = null, bd = Infinity;
  for (const b of L.drops) {
    if (b.infected) continue;
    const d = w.BD[b.type];
    if (d.drop[0] !== '*' && !d.drop.includes(res)) continue;
    const dd = (b.x + b.w / 2 - x) ** 2 + (b.y + b.h / 2 - y) ** 2;
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}

export function hasStock(c, cost) {
  for (const k in cost) if ((c.stock[k] || 0) < cost[k] - 1e-9) return false;
  return true;
}
export function takeStock(c, cost) { for (const k in cost) c.stock[k] -= cost[k]; }
export function costText(cost) { return Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(', ') || 'free'; }

// ---------------- city-level update ----------------
export function updateCities(w) {
  const B = w.B, tick = w.tick;
  if (tick % 10 === 0) {
    for (const c of w.cities) { c.nCiv = 0; c.nSol = 0; }
    for (const u of w.units) {
      if (u.dead || u.isZ || u.k === 'cart' || u.settler) continue;
      const c = w.cityMap.get(u.city);
      if (!c) continue;
      if (u.k === 'civ') c.nCiv++; else c.nSol++;
    }
    for (const c of w.cities) {
      let h = 0;
      for (const b of lists(w, c).houses) if (!b.infected) h += w.BD[b.type].housing;
      c.housing = h;
    }
  }
  const eatTicks = Math.round(B.food.eatInterval / w.DT);
  const growTicks = Math.round(B.growth.interval / w.DT);
  for (const c of w.cities) {
    const off = (c.id * 7) % 20;
    if ((tick + off) % 20 === 0) { assignHomes(w, c); assignJobs(w, c); }
    if ((tick + off) % eatTicks === 0) eat(w, c);
    if ((tick + off) % growTicks === 0) grow(w, c);
    if ((tick + off) % 600 === 0) {
      const rate = (c.prodAcc - c.consAcc) * (B.dayLength / 60);
      c.trend = c.trend * 0.6 + rate * 0.4;
      c.prodAcc = 0; c.consAcc = 0;
    }
  }
  // Remove empty cities (no buildings, no people) so the region can be settled again.
  if (tick % 100 === 0) {
    for (const c of w.cities.slice()) {
      if (c.id === w.capital) continue;
      if (c.nCiv + c.nSol > 0) continue;
      if (lists(w, c).all.length > 0) continue;
      if (w.units.some(u => !u.dead && u.city === c.id)) continue;
      w.cities.splice(w.cities.indexOf(c), 1); w.cityMap.delete(c.id);
      w.routes = w.routes.filter(r => r.from !== c.id && r.to !== c.id);
      w.event('alert', `${c.name} has fallen and is abandoned.`, c.cx, c.cy);
    }
  }
}

function eat(w, c) {
  const B = w.B;
  const pop = c.nCiv + c.nSol;
  if (pop === 0) return;
  c.foodDebt += pop * B.food.perPersonPerDay * B.food.eatInterval / B.dayLength;
  const take = Math.min(c.stock.food, c.foodDebt);
  c.stock.food -= take; c.foodDebt -= take; c.consAcc += take;
  if (c.foodDebt > 0.5 && c.stock.food <= 0.001) {
    c.starveT += B.food.eatInterval;
    if (!c.starving) { c.starving = true; w.event('alert', `${c.name} is out of food — people are starving!`, c.cx, c.cy); }
    while (c.starveT >= B.food.starveInterval) {
      c.starveT -= B.food.starveInterval;
      c.foodDebt = 0;
      starveOne(w, c);
    }
  } else { c.starving = false; c.starveT = 0; if (c.foodDebt > pop) c.foodDebt = pop; }
}

function starveOne(w, c) {
  const hall = w.bMap.get(c.hall);
  const cands = [];
  for (const u of w.units) {
    if (u.dead || u.isZ || u.k === 'cart' || u.settler || u.city !== c.id) continue;
    if (hall && u.inside === hall.id) continue;
    cands.push(u);
  }
  if (!cands.length) for (const u of w.units) if (!u.dead && !u.isZ && u.k !== 'cart' && !u.settler && u.city === c.id) cands.push(u);
  if (!cands.length) return;
  const u = cands[Math.floor(w.rng.next() * cands.length)];
  w.event('alert', `Someone starved in ${c.name} and rose again`, u.x, u.y);
  if (u.inside) {
    const b = w.bMap.get(u.inside);
    if (b && !w.BD[b.type].defense) { Zom.infect(w, b); return; }
  }
  w.killUnit(u, 'starve');
}

function grow(w, c) {
  const B = w.B;
  const free = c.housing - c.nCiv;
  if (free <= 0 || c.stock.food < B.growth.minFood || c.trend <= 0) return;
  const pop = Math.max(1, c.nCiv + c.nSol);
  const chance = Math.max(0.1, Math.min(B.growth.maxChance, c.trend / (pop * B.food.perPersonPerDay * 0.5)));
  if (w.rng.next() >= chance) return;
  const hall = w.bMap.get(c.hall);
  const x = hall ? hall.x + hall.w / 2 : c.cx + 0.5, y = hall ? hall.y + hall.h + 0.5 : c.cy + 0.5;
  w.spawn('civ', x, y, { city: c.id });
  c.nCiv++;
}

function assignHomes(w, c) {
  const L = lists(w, c);
  const open = [];
  for (const h of L.houses) {
    if (h.infected) continue;
    const cap = w.BD[h.type].housing;
    if (h.residents.length < cap) open.push(h);
  }
  if (!open.length) return;
  for (const u of w.units) {
    if (u.dead || u.k !== 'civ' || u.city !== c.id || u.home || u.settler) continue;
    let h = null;
    while (open.length) {
      h = open[0];
      if (h.residents.length < w.BD[h.type].housing) break;
      open.shift(); h = null;
    }
    if (!h) break;
    h.residents.push(u.id); u.home = h.id;
  }
}

function assignJobs(w, c) {
  const L = lists(w, c);
  const slots = [];
  for (const b of L.work) {
    if (b.infected) continue;
    const d = w.BD[b.type];
    const p = c.pri[d.job] || 0;
    if (p <= 0) { for (const id of b.workers.slice()) { const u = w.unitMap.get(id); if (u) unassign(w, u); } continue; }
    slots.push({ b, p, open: d.workers - b.workers.length });
  }
  slots.sort((a, b) => b.p - a.p || a.b.id - b.b.id);
  const idle = [];
  for (const u of w.units) if (!u.dead && u.k === 'civ' && u.city === c.id && !u.job && !u.settler) idle.push(u);
  for (const s of slots) {
    while (s.open > 0 && idle.length) {
      let bi = 0, bd = Infinity;
      const bx = s.b.x + s.b.w / 2, by = s.b.y + s.b.h / 2;
      for (let i = 0; i < idle.length; i++) {
        const d = (idle[i].x - bx) ** 2 + (idle[i].y - by) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      assign(w, idle[bi], s.b);
      idle.splice(bi, 1);
      s.open--;
    }
  }
  // Rebalance: move one worker per pass from a lower-priority building to an open higher-priority slot.
  let moves = 2;
  for (const s of slots) {
    if (moves <= 0) break;
    if (s.open <= 0) continue;
    for (let i = slots.length - 1; i >= 0 && s.open > 0 && moves > 0; i--) {
      const lo = slots[i];
      if (lo.p >= s.p || lo.b.workers.length === 0) continue;
      const u = w.unitMap.get(lo.b.workers[lo.b.workers.length - 1]);
      if (!u) continue;
      unassign(w, u);
      assign(w, u, s.b);
      lo.open++; s.open--; moves--;
    }
  }
}

export function assign(w, u, b) {
  u.job = b.id; b.workers.push(u.id);
  if (u.task !== 'flee' && u.task !== 'shelter' && u.task !== 'home' && !u.carry) { if (u.inside) w.exit(u); u.task = 'idle'; u.path = null; }
}
export function unassign(w, u, dying = false) {
  const b = w.bMap.get(u.job);
  u.job = 0; u.hasIn = false;
  if (b) { const i = b.workers.indexOf(u.id); if (i >= 0) b.workers.splice(i, 1); }
  if (dying) return;
  if (b && u.inside === b.id) w.exit(u);
  if (u.task !== 'flee' && u.task !== 'shelter' && u.task !== 'home' && u.task !== 'toDrop') { u.task = 'idle'; u.path = null; }
}

// ---------------- civilian AI ----------------
function go(w, u, b, task) {
  u.tb = b.id;
  if (w.distToBuilding(u.x, u.y, b) <= 1.0) { u.task = task; u.path = null; return true; }
  const t = w.approach(b, u.x, u.y);
  if (t < 0 || !w.planPath(u, t % w.W + 0.5, ((t / w.W) | 0) + 0.5)) {
    u.task = 'wait'; u.timer = 4; u.fails++;
    return false;
  }
  u.task = task;
  return true;
}

function startFlee(w, u) {
  const c = w.cityMap.get(u.city);
  let hall = c ? w.bMap.get(c.hall) : null;
  if (!hall || hall.infected) {
    let bd = Infinity; hall = null;
    for (const cc of w.cities) { const h = w.bMap.get(cc.hall); if (!h || h.infected || !h.done) continue; const d = (h.x - u.x) ** 2 + (h.y - u.y) ** 2; if (d < bd) { bd = d; hall = h; } }
  }
  if (!hall) return;
  if (u.inside === hall.id) { u.task = 'shelter'; u.timer = 0; return; }
  if (u.inside) w.exit(u);
  go(w, u, hall, 'flee');
}

export function updateCiv(w, u) {
  if (u.settler) return;
  const B = w.B;
  const job = u.job ? w.bMap.get(u.job) : null;
  const jd = job ? w.BD[job.type] : null;
  // Flee check (crews hold their posts)
  if ((w.tick + u.id) % 10 === 0 && u.task !== 'flee' && u.task !== 'shelter' && !(jd && jd.crew && u.inside === u.job)) {
    if (w.spatial.any(u.x, u.y, B.civ.fleeRadius, true, true)) { startFlee(w, u); }
  }
  switch (u.task) {
    case 'idle': decide(w, u, job, jd); return;
    case 'wait':
      u.timer -= w.DT;
      if (u.timer <= 0) u.task = 'idle';
      return;
    case 'flee': case 'toJob': case 'toDrop': case 'toFetch': case 'toHome': case 'toLoiter':
      walk(w, u, job, jd); return;
    case 'shelter':
      if ((w.tick + u.id) % 50 === 0) {
        const h = w.bMap.get(u.inside);
        if (!h || !w.spatial.any(h.x + 1.5, h.y + 1.5, B.civ.safeRadius, true, true)) { if (u.inside) w.exit(u); u.task = 'idle'; }
      }
      return;
    case 'home':
      if ((w.tick + u.id) % 20 === 0 && !w.isNight()) { w.exit(u); u.task = 'idle'; }
      return;
    case 'waitIn':
      if ((w.tick + u.id) % 50 === 0) {
        const c = w.cityMap.get(u.city);
        if (!job || !jd) { if (u.inside) w.exit(u); u.task = 'idle'; return; }
        if (c && jd.in && hasStock(c, jd.in)) { w.exit(u); u.task = 'idle'; }
        else if (w.isNight() && u.home) { w.exit(u); u.task = 'idle'; }
      }
      return;
    case 'crew':
      if (!job || u.inside !== job.id) u.task = 'idle';
      return;
    case 'work': work(w, u, job, jd); return;
  }
}

function decide(w, u, job, jd) {
  const c = w.cityMap.get(u.city);
  if (!c) return;
  if (u.inside) w.exit(u);
  const night = w.isNight();
  if (u.carry) { const dr = nearestDrop(w, c, u.carry.r, u.x, u.y); if (dr) { go(w, u, dr, 'toDrop'); return; } deposit(w, u, c); }
  if (night && u.home && !(jd && jd.crew)) {
    const h = w.bMap.get(u.home);
    if (h && h.done && !h.infected) { go(w, u, h, 'toHome'); return; }
  }
  if (job && job.done && !job.infected) {
    if (jd.in && !u.hasIn && hasStock(c, jd.in)) {
      const dr = nearestDrop(w, c, Object.keys(jd.in)[0], u.x, u.y);
      if (dr) { go(w, u, dr, 'toFetch'); return; }
      takeStock(c, jd.in); u.hasIn = true;
    }
    go(w, u, job, 'toJob');
    return;
  }
  // Jobless: drift back toward the town centre.
  const hall = w.bMap.get(c.hall);
  const hx = hall ? hall.x + 1.5 : c.cx, hy = hall ? hall.y + 1.5 : c.cy;
  if ((u.x - hx) ** 2 + (u.y - hy) ** 2 > 100) {
    const a = w.rng.next() * 6.283, r = 3 + w.rng.next() * 5;
    if (w.planPath(u, hx + Math.cos(a) * r, hy + Math.sin(a) * r)) { u.task = 'toLoiter'; return; }
  }
  u.task = 'wait'; u.timer = 4 + w.rng.next() * 4;
}

function walk(w, u, job, jd) {
  const r = w.followPath(u, w.humanSpeed(u));
  if (r === 0) return;
  if (u.task === 'toLoiter') { u.task = 'wait'; u.timer = 5; return; }
  const b = w.bMap.get(u.tb);
  if (!b || b.dead || (b.infected && u.task !== 'flee')) { u.task = 'idle'; return; }
  if (w.distToBuilding(u.x, u.y, b) > 1.3) {
    if (++u.fails > 4) { u.fails = 0; u.task = 'wait'; u.timer = 5; return; }
    go(w, u, b, u.task);
    return;
  }
  u.fails = 0;
  arrive(w, u, b, job, jd);
}

function arrive(w, u, b, job, jd) {
  const c = w.cityMap.get(u.city);
  switch (u.task) {
    case 'flee':
      if (b.infected) { u.task = 'idle'; return; }
      w.enter(u, b); u.task = 'shelter'; return;
    case 'toHome':
      w.enter(u, b); u.task = 'home'; return;
    case 'toDrop':
      deposit(w, u, c);
      if (job && jd && jd.in && !u.hasIn && c && hasStock(c, jd.in) && !(w.isNight() && u.home)) { takeStock(c, jd.in); u.hasIn = true; go(w, u, job, 'toJob'); return; }
      u.task = 'idle'; return;
    case 'toFetch':
      if (job && jd && jd.in && c && hasStock(c, jd.in)) { takeStock(c, jd.in); u.hasIn = true; go(w, u, job, 'toJob'); return; }
      u.task = 'idle'; return;
    case 'toJob':
      if (!job || job.id !== b.id) { u.task = 'idle'; return; }
      w.enter(u, b);
      if (jd.crew) { u.task = 'crew'; return; }
      if (jd.in && !u.hasIn) { u.task = 'waitIn'; return; }
      u.task = 'work';
      u.timer = cycleTime(w, b, jd);
      return;
  }
  u.task = 'idle';
}

function cycleTime(w, b, jd) {
  let t = jd.cycle;
  if (b.type === 'smelter' && w.has('smelterEff')) t *= 0.6;
  return t;
}

function deposit(w, u, c) {
  if (!u.carry || !c) { u.carry = null; return; }
  c.stock[u.carry.r] = (c.stock[u.carry.r] || 0) + u.carry.a;
  if (u.carry.r === 'food') c.prodAcc += u.carry.a;
  u.carry = null;
}

function work(w, u, job, jd) {
  if (!job || job.dead || !jd || u.inside !== job.id) { u.task = 'idle'; return; }
  u.timer -= w.DT;
  if (u.timer > 0) return;
  if (jd.rp) {
    w.research.rp += jd.rp;
    u.timer = cycleTime(w, job, jd);
    if (w.isNight() && u.home) { w.exit(u); u.task = 'idle'; }
    return;
  }
  const [res, amt0] = Object.entries(jd.out)[0];
  let amt = amt0 * (job.yieldF || 1);
  if (job.type === 'farm' && w.has('farmYield')) amt *= 1.3;
  u.carry = { r: res, a: amt };
  u.hasIn = false;
  w.exit(u);
  u.task = 'idle';
}

// ---------------- placement ----------------
function countAround(w, b, d, req) {
  const W = w.W, m = w.map;
  let n = 0;
  const terIds = (req.terrain || []).map(s => TER_NAMES.indexOf(s));
  const depIds = (req.deposit || []).map(s => DEP_NAMES.indexOf(s));
  const r = req.kind === 'footprint' ? 0 : req.radius;
  for (let y = b.y - r; y < b.y + d.h + r; y++) for (let x = b.x - r; x < b.x + d.w + r; x++) {
    if (!w.inMap(x, y)) continue;
    const t = y * W + x;
    if (terIds.length && terIds.includes(m.terrain[t])) n++;
    else if (depIds.length && depIds.includes(m.deposit[t])) n++;
  }
  return n;
}

export function placementCity(w, type, x, y) {
  const d = w.BD[type];
  const cx = x + d.w / 2, cy = y + d.h / 2;
  let city = cityOfRegion(w, w.regionAt(cx, cy));
  const lim = d.defense ? w.B.city.defenseRadius : w.B.city.buildRadius;
  if (city && Math.hypot(cx - city.cx, cy - city.cy) <= lim) return city;
  if (d.defense) {
    let best = null, bd = Infinity;
    for (const c of w.cities) { const dd = Math.hypot(cx - c.cx, cy - c.cy); if (dd <= lim && dd < bd) { bd = dd; best = c; } }
    if (best) return best;
  }
  return null;
}

export function canPlace(w, type, x, y) {
  const d = w.BD[type];
  const fail = reason => ({ ok: false, reason });
  if (!d) return fail('Unknown building');
  if (d.research && !w.has(d.research)) return fail('Requires research');
  if (x < 1 || y < 1 || x + d.w >= w.W || y + d.h >= w.H) return fail('Out of bounds');
  const W = w.W;
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    const t = yy * W + xx, ter = w.map.terrain[t];
    if (!w.explored[t]) return fail('Unexplored');
    if (w.bAt[t]) return fail('Occupied');
    if (ter === TER.RIVER || ter === TER.FORD || ter === TER.CLIFF) return fail('Blocked terrain');
  }
  const city = placementCity(w, type, x, y);
  if (!city) {
    const rc = cityOfRegion(w, w.regionAt(x + d.w / 2, y + d.h / 2));
    return fail(rc ? 'Too far from the town centre' : 'No settlement in this region');
  }
  if (type === 'townhall' && city.hall) return fail('This city already has a town hall');
  let yieldF = 1;
  if (d.req) {
    const n = countAround(w, { x, y }, d, d.req);
    if (n < d.req.count) return fail(`Needs ${d.req.terrain ? d.req.terrain.join('/') : d.req.deposit.join('/') + ' deposit'} (${n}/${d.req.count})`);
    if (d.req.target) yieldF = Math.max(0.5, Math.min(1.5, n / d.req.target));
  }
  if (!hasStock(city, d.cost)) return fail(`Not enough materials (${costText(d.cost)})`);
  return { ok: true, city, yieldF };
}

export function cmdBuild(w, c) {
  const r = canPlace(w, c.type, c.x, c.y);
  if (!r.ok) return r;
  takeStock(r.city, w.BD[c.type].cost);
  const b = w.addBuilding(c.type, c.x, c.y, r.city.id, false);
  b.yieldF = r.yieldF;
  if (c.type === 'townhall') r.city.hall = b.id;
  return { ok: true, b: b.id };
}

export function canRoad(w, t, kind, payer) {
  const ter = w.map.terrain[t];
  if (!w.explored[t]) return { ok: false, reason: 'Unexplored' };
  if (ter === TER.CLIFF) return { ok: false, reason: 'Cliff' };
  const val = kind === 'sroad' ? 2 : 1;
  if (w.road[t] >= val) return { ok: false, reason: 'Already a road' };
  if (w.bAt[t]) { const b = w.bMap.get(w.bAt[t]); if (b && w.BD[b.type].blockH) return { ok: false, reason: 'Occupied' }; }
  if (kind === 'sroad' && !w.has('stoneRoads')) return { ok: false, reason: 'Requires research' };
  const x = t % w.W, y = (t / w.W) | 0;
  const city = cityOfRegion(w, w.regionAt(x, y)) || payer;
  if (!city) return { ok: false, reason: 'No city to pay' };
  let cost = val === 2 ? w.B.roads.stone.cost : w.B.roads.dirt.cost;
  if (ter === TER.RIVER) cost = w.B.roads.bridgeCost;
  if (!hasStock(city, cost)) return { ok: false, reason: 'Not enough materials' };
  return { ok: true, city, cost, val };
}

// Place a line of 1x1 structures (walls, gates, traps, ditches) or roads along given tiles.
export function cmdLine(w, c) {
  let placed = 0, reason = '';
  const payer = w.cityMap.get(c.city) || null;
  for (const [x, y] of c.pts) {
    if (!w.inMap(x, y)) continue;
    const t = y * w.W + x;
    if (c.type === 'road' || c.type === 'sroad') {
      const r = canRoad(w, t, c.type, payer);
      if (!r.ok) { reason = r.reason; continue; }
      takeStock(r.city, r.cost);
      w.setRoad(t, r.val);
      placed++;
    } else {
      const r = canPlace(w, c.type, x, y);
      if (!r.ok) { reason = r.reason; continue; }
      takeStock(r.city, w.BD[c.type].cost);
      w.addBuilding(c.type, x, y, r.city.id, false);
      placed++;
    }
  }
  return { ok: placed > 0, placed, reason };
}

export function cmdResearch(w, c) {
  for (const br of w.RD.branches) {
    const i = br.techs.findIndex(t => t.id === c.id);
    if (i < 0) continue;
    const tech = br.techs[i];
    if (w.has(tech.id)) return { ok: false, reason: 'Already researched' };
    if (i > 0 && !w.has(br.techs[i - 1].id)) return { ok: false, reason: 'Research the previous tech first' };
    if (w.research.rp < tech.cost) return { ok: false, reason: 'Not enough research points' };
    w.research.rp -= tech.cost;
    w.research.done.push(tech.id);
    w.event('research', `Research complete: ${tech.name}`);
    return { ok: true };
  }
  return { ok: false, reason: 'Unknown tech' };
}
