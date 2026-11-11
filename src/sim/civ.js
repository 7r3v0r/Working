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
export function takeStock(c, cost, w = null, label = '') {
  for (const k in cost) { c.stock[k] -= cost[k]; if (w) flow(w, c, k, -cost[k], label); }
}

// Flow ledger for the UI (resource tooltips). Not saved and never read by the simulation.
// Amounts accumulate per city in 10 s buckets; the last FLOW_BUCKETS are kept.
export const FLOW_TICKS = 100, FLOW_BUCKETS = 12;
export function flow(w, c, res, amt, label) {
  if (!amt) return;
  let L = w.flows.get(c.id);
  if (!L) w.flows.set(c.id, L = { since: w.tick, cur: {}, hist: [] });
  const k = res + '|' + label;
  L.cur[k] = (L.cur[k] || 0) + amt;
}
export function rotateFlows(w) {
  if (w.tick % FLOW_TICKS !== 0) return;
  for (const L of w.flows.values()) {
    L.hist.push(L.cur); L.cur = {};
    if (L.hist.length > FLOW_BUCKETS) L.hist.shift();
  }
}
// Totals per resource over the tracked window: { res: { net, in: {label: amt}, out: {label: amt} } } and the window length in seconds.
export function flowSummary(w, c) {
  const L = w.flows.get(c.id), out = {};
  if (!L) return { secs: 0, res: out };
  for (const m of [...L.hist, L.cur]) for (const k in m) {
    const i = k.indexOf('|'), r = k.slice(0, i), label = k.slice(i + 1), a = m[k];
    const e = out[r] || (out[r] = { net: 0, in: {}, out: {} });
    e.net += a;
    const side = a >= 0 ? e.in : e.out;
    side[label] = (side[label] || 0) + Math.abs(a);
  }
  const secs = Math.min(w.tick - L.since, FLOW_TICKS * FLOW_BUCKETS + (w.tick % FLOW_TICKS)) * w.DT;
  return { secs, res: out };
}
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
  flow(w, c, 'food', -take, 'Eaten');
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
  // Arrivals scale with how much open housing there is: each check fills a share of the empty
  // homes, capped by how many extra mouths the food surplus can feed.
  const expected = free * B.growth.fillRate;
  let n = Math.floor(expected) + (w.rng.next() < expected % 1 ? 1 : 0);
  n = Math.min(n, free, Math.max(1, Math.floor(c.trend / B.food.perPersonPerDay)));
  if (n <= 0) return;
  const hall = w.bMap.get(c.hall);
  const x = hall ? hall.x + hall.w / 2 : c.cx + 0.5, y = hall ? hall.y + hall.h + 0.5 : c.cy + 0.5;
  for (let i = 0; i < n; i++) w.spawn('civ', x + (i % 3) - 1, y, { city: c.id });
  c.nCiv += n;
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
      if ((w.tick + u.id) % 20 === 0) { w.exit(u); u.task = 'idle'; }
      return;
    case 'waitIn':
      if ((w.tick + u.id) % 50 === 0) {
        const c = w.cityMap.get(u.city);
        if (!job || !jd) { if (u.inside) w.exit(u); u.task = 'idle'; return; }
        if (c && jd.in && hasStock(c, jd.in)) { w.exit(u); u.task = 'idle'; }
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
  if (u.carry) { const dr = nearestDrop(w, c, u.carry.r, u.x, u.y); if (dr) { go(w, u, dr, 'toDrop'); return; } deposit(w, u, c); }
  if (job && job.done && !job.infected) {
    if (jd.in && !u.hasIn && hasStock(c, jd.in)) {
      const dr = nearestDrop(w, c, Object.keys(jd.in)[0], u.x, u.y);
      if (dr) { go(w, u, dr, 'toFetch'); return; }
      takeStock(c, jd.in, w, w.BD[job.type].name); u.hasIn = true;
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
      if (job && jd && jd.in && !u.hasIn && c && hasStock(c, jd.in)) { takeStock(c, jd.in, w, w.BD[job.type].name); u.hasIn = true; go(w, u, job, 'toJob'); return; }
      u.task = 'idle'; return;
    case 'toFetch':
      if (job && jd && jd.in && c && hasStock(c, jd.in)) { takeStock(c, jd.in, w, w.BD[job.type].name); u.hasIn = true; go(w, u, job, 'toJob'); return; }
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
  // Workers no longer go home at night, so cycles are stretched to keep daily output the same.
  let t = jd.cycle * (w.B.production.cycleMult || 1);
  if (b.type === 'smelter' && w.has('smelterEff')) t *= 0.6;
  return t;
}

function deposit(w, u, c) {
  if (!u.carry || !c) { u.carry = null; return; }
  c.stock[u.carry.r] = (c.stock[u.carry.r] || 0) + u.carry.a;
  flow(w, c, u.carry.r, u.carry.a, u.carry.src && w.BD[u.carry.src] ? w.BD[u.carry.src].name : 'Workers');
  if (u.carry.r === 'food') c.prodAcc += u.carry.a;
  u.carry = null;
}

function work(w, u, job, jd) {
  if (!job || job.dead || !jd || u.inside !== job.id) { u.task = 'idle'; return; }
  u.timer -= w.DT;
  if (u.timer > 0) return;
  const boost = (regionFx(w).yield[job.type] || 1) * auraMult(w, job);
  if (jd.rp) {
    w.research.rp += jd.rp * boost;
    u.timer = cycleTime(w, job, jd);
    return;
  }
  const [res, amt0] = Object.entries(jd.out)[0];
  let amt = amt0 * (job.yieldF || 1) * boost;
  if (job.type === 'farm' && w.has('farmYield')) amt *= 1.3;
  u.carry = { r: res, a: amt, src: job.type };
  u.hasIn = false;
  w.exit(u);
  u.task = 'idle';
}

// ---------------- regions ----------------
// A region's bonus applies to every city once one of your cities holds it with a standing town hall.
// Cached per structure version (town halls completing or falling bump it).
export function regionFx(w) {
  if (w._fx && w._fxv === w.structVer) return w._fx;
  const fx = { held: new Set(), yield: {}, cost: {}, train: 1 };
  for (const c of w.cities) {
    const h = w.bMap.get(c.hall);
    if (h && h.done && !h.dead) fx.held.add(c.region);
  }
  for (const r of fx.held) {
    const b = w.map.def.regions[r].bonus;
    if (!b) continue;
    for (const k in b.yield || {}) fx.yield[k] = (fx.yield[k] || 1) * b.yield[k];
    for (const k in b.cost || {}) fx.cost[k] = (fx.cost[k] || 1) * b.cost[k];
    if (b.train) fx.train *= b.train;
  }
  w._fx = fx; w._fxv = w.structVer;
  return fx;
}
// Building price after region discounts.
export function buildCost(w, type) {
  const d = w.BD[type], m = regionFx(w).cost[type];
  if (!m || !d.cost) return d.cost;
  const out = {};
  for (const k in d.cost) out[k] = Math.max(1, Math.round(d.cost[k] * m));
  return out;
}
// Strongest aura from the city's finished buildings (watermill, sawmill, mason's yard) covering b.
export function auraMult(w, b) {
  const c = w.cityMap.get(b.city);
  if (!c) return 1;
  let m = 1;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  for (const a of lists(w, c).all) {
    const A = w.BD[a.type].aura;
    if (!A || !a.done || a.infected || !A.types.includes(b.type)) continue;
    if (Math.hypot(a.x + a.w / 2 - bx, a.y + a.h / 2 - by) <= A.radius) m = Math.max(m, A.mult);
  }
  return m;
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

// Camps of a city (finished, not infected). Each extends its city's build area by B.camp.radius.
export function campsOf(w, c) {
  return lists(w, c).all.filter(b => b.type === 'camp' && b.done && !b.infected);
}
export function nearCamp(w, c, x, y) {
  const r = w.B.camp.radius;
  return campsOf(w, c).some(b => Math.hypot(x - (b.x + b.w / 2), y - (b.y + b.h / 2)) <= r);
}

export function placementCity(w, type, x, y) {
  const d = w.BD[type];
  const cx = x + d.w / 2, cy = y + d.h / 2;
  let city = cityOfRegion(w, w.regionAt(cx, cy));
  const lim = d.placeRadius || (d.defense ? w.B.city.defenseRadius : w.B.city.buildRadius);
  if (city && Math.hypot(cx - city.cx, cy - city.cy) <= lim) return city;
  if (city && nearCamp(w, city, cx, cy)) return city;
  if (d.defense) {
    let best = null, bd = Infinity;
    for (const c of w.cities) { const dd = Math.hypot(cx - c.cx, cy - c.cy); if (dd <= lim && dd < bd) { bd = dd; best = c; } }
    if (best) return best;
  }
  return null;
}

// A visible zombie within B.city.zombieClear tiles of the footprint blocks building there.
// Zombies hidden in the fog don't count, so this never reveals them.
const _near = [];
export function zombiesNear(w, x, y, bw = 1, bh = 1) {
  const r = w.B.city.zombieClear;
  for (const z of w.spatial.within(x + bw / 2, y + bh / 2, r + Math.max(bw, bh), true, _near)) {
    if (!w.visible[w.tileOf(z.x, z.y)]) continue;
    const dx = Math.max(x - z.x, 0, z.x - (x + bw)), dy = Math.max(y - z.y, 0, z.y - (y + bh));
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

export function canPlace(w, type, x, y) {
  const d = w.BD[type];
  const fail = reason => ({ ok: false, reason });
  if (!d) return fail('Unknown building');
  if (d.research && !w.has(d.research)) return fail('Requires research');
  if (x < 1 || y < 1 || x + d.w >= w.W || y + d.h >= w.H) return fail('Out of bounds');
  const W = w.W;
  let replace = null;
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    const t = yy * W + xx, ter = w.map.terrain[t];
    if (!w.explored[t]) return fail('Unexplored');
    if (w.bAt[t]) {
      // Gates can go straight onto a wall; the wall is removed when the gate is placed.
      const o = w.bMap.get(w.bAt[t]);
      if (!(d.replaces && o && o.city && !o.infected && d.replaces.includes(o.type))) return fail('Occupied');
      replace = o;
    }
    if (ter === TER.RIVER || ter === TER.FORD || ter === TER.CLIFF) return fail('Blocked terrain');
  }
  if (d.region !== undefined && w.regionAt(x + d.w / 2, y + d.h / 2) !== d.region) return fail(`Only in ${w.map.def.regions[d.region].name}`);
  if (zombiesNear(w, x, y, d.w, d.h)) return fail(`Zombies within ${w.B.city.zombieClear} tiles`);
  const city = placementCity(w, type, x, y);
  if (!city) {
    const rc = cityOfRegion(w, w.regionAt(x + d.w / 2, y + d.h / 2));
    return fail(rc ? 'Too far from the town centre or a camp' : 'No settlement in this region');
  }
  if (type === 'townhall' && city.hall) return fail('This city already has a town hall');
  let yieldF = 1;
  if (d.req) {
    const n = countAround(w, { x, y }, d, d.req);
    if (n < d.req.count) return fail(`Needs ${d.req.terrain ? d.req.terrain.join('/') : d.req.deposit.join('/') + ' deposit'} (${n}/${d.req.count})`);
    if (d.req.target) yieldF = Math.max(0.5, Math.min(1.5, n / d.req.target));
  }
  const cost = buildCost(w, type);
  if (!hasStock(city, cost)) return fail(`Not enough materials (${costText(cost)})`);
  return { ok: true, city, yieldF, replace };
}

// ---------------- repairs ----------------
// Cost: the building's price × missing HP fraction × costMult. Time: build time × missing fraction × timeMult
// (at least minTime). Paid up front; HP comes back gradually and pauses while the building is under attack.
export function repairCost(w, b) {
  const d = w.BD[b.type], miss = Math.max(0, 1 - b.hp / (b.maxHp || d.hp)), base = buildCost(w, b.type) || {}, cost = {};
  for (const k in base) { const v = Math.ceil(base[k] * miss * w.B.repair.costMult); if (v > 0) cost[k] = v; }
  return cost;
}
export function canRepair(w, b) {
  const fail = reason => ({ ok: false, reason });
  if (!b || b.dead || !b.city) return fail('Nothing to repair');
  if (!b.done) return fail('Still under construction');
  if (b.infected) return fail('Infected — clear it first');
  if (b.repairT > 0) return fail('Already being repaired');
  const d = w.BD[b.type], mhp = b.maxHp || d.hp;
  if (b.hp >= mhp - 0.5) return fail('Not damaged');
  const c = w.cityMap.get(b.city);
  if (!c) return fail('No city');
  const cost = repairCost(w, b);
  if (!hasStock(c, cost)) return fail(`Repair needs ${costText(cost)}`);
  const R = w.B.repair;
  return { ok: true, c, cost, time: Math.max(R.minTime, d.build * (1 - b.hp / mhp) * R.timeMult) };
}
export function cmdRepair(w, c) {
  let n = 0, reason = '';
  for (const id of [].concat(c.b)) {
    const b = w.bMap.get(id), r = canRepair(w, b);
    if (!r.ok) { reason = r.reason; continue; }
    takeStock(r.c, r.cost, w, 'Repairs');
    b.repairT = r.time; b.repairRate = ((b.maxHp || w.BD[b.type].hp) - b.hp) / r.time;
    n++;
  }
  return { ok: n > 0, n, reason };
}
export function updateRepair(w, b) {
  if (!(b.repairT > 0)) return;
  if (w.tick - b.lastHit < w.B.repair.hitPause / w.DT) return;
  const mhp = b.maxHp || w.BD[b.type].hp;
  b.hp = Math.min(mhp, b.hp + b.repairRate * w.DT);
  b.repairT -= w.DT;
  if (b.repairT <= 1e-6 || b.hp >= mhp) { b.repairT = 0; b.hp = Math.max(b.hp, Math.round(b.hp)); }
}

export function cmdBuild(w, c) {
  const r = canPlace(w, c.type, c.x, c.y);
  if (!r.ok) return r;
  takeStock(r.city, buildCost(w, c.type), w, 'Construction');
  if (r.replace) w.destroyBuilding(r.replace, 'replaced');
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
  if (zombiesNear(w, t % w.W, (t / w.W) | 0)) return { ok: false, reason: `Zombies within ${w.B.city.zombieClear} tiles` };
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
      takeStock(r.city, r.cost, w, 'Roads');
      w.setRoad(t, r.val);
      placed++;
    } else {
      const r = canPlace(w, c.type, x, y);
      if (!r.ok) { reason = r.reason; continue; }
      takeStock(r.city, buildCost(w, c.type), w, 'Construction');
      if (r.replace) w.destroyBuilding(r.replace, 'replaced');
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
