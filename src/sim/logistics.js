// Carts, cart routes, settler parties.
import { lists, hasStock, takeStock, costText, cityOfRegion, nearestDrop, createCity, unassign, placementCity, flow } from './civ.js';
import { formation } from './military.js';

// ---------------- carts ----------------
export function cmdBuildCart(w, c) {
  const b = w.bMap.get(c.b);
  if (!b || !w.BD[b.type].carts || !b.done) return { ok: false, reason: 'Not a cart depot' };
  for (let i = 0; i < (c.n || 1) && b.queue.length < 20; i++) b.queue.push('cart');
  return { ok: true };
}

export function updateDepot(w, b) {
  if (!b.queue.length) { b.stall = ''; return; }
  const city = w.cityMap.get(b.city);
  if (!city) return;
  const C = w.B.carts;
  if (!b.training) {
    if (!hasStock(city, C.cost)) { b.stall = `Needs ${costText(C.cost)}`; return; }
    takeStock(city, C.cost, w, 'Carts');
    b.training = 'cart'; b.trainT = C.buildTime; b.stall = '';
  }
  b.trainT -= w.DT;
  if (b.trainT > 0) return;
  b.training = null; b.queue.shift();
  const t = w.passableNear(w.tileOf(b.x + b.w / 2, b.y + b.h), w.hSpeed, 4);
  const x = t >= 0 ? t % w.W + 0.5 : b.x + 1, y = t >= 0 ? ((t / w.W) | 0) + 0.5 : b.y + b.h + 0.5;
  w.spawn('cart', x, y, { city: city.id, depot: b.id });
  w.event('built', `A cart is ready in ${city.name}`, x, y);
}

export function cmdRoute(w, c) {
  const A = w.cityMap.get(c.from), B = w.cityMap.get(c.to);
  if (!A || !B || A === B) return { ok: false, reason: 'Pick two different cities' };
  if (!w.B.resources.includes(c.res)) return { ok: false, reason: 'Unknown resource' };
  if (c.id) {
    const r = w.routes.find(r => r.id === c.id);
    if (r) Object.assign(r, { res: c.res, from: c.from, to: c.to, min: c.min, max: c.max, carts: c.carts });
    return { ok: true };
  }
  const r = { id: w.nextId++, res: c.res, from: c.from, to: c.to, min: c.min | 0, max: c.max | 0, carts: Math.max(0, c.carts | 0) };
  w.routes.push(r);
  return { ok: true, id: r.id };
}
export function cmdDelRoute(w, c) {
  w.routes = w.routes.filter(r => r.id !== c.id);
  for (const u of w.units) if (u.k === 'cart' && u.route === c.id) u.route = 0;
  return { ok: true };
}

function cartCap(w) { return w.has('largeCarts') ? w.B.carts.largeCapacity : w.B.carts.capacity; }

function goB(w, u, b, task) {
  u.tb = b.id;
  const t = w.approach(b, u.x, u.y);
  if (t < 0 || !w.planPath(u, t % w.W + 0.5, ((t / w.W) | 0) + 0.5)) { u.task = 'wait'; u.timer = 5; return false; }
  u.task = task;
  return true;
}
function homeOf(w, u) {
  let d = w.bMap.get(u.depot);
  if (!d || d.dead) {
    const c = w.cityMap.get(u.city);
    if (c) { const L = lists(w, c); d = L.depots[0] || w.bMap.get(c.hall); u.depot = d ? d.id : 0; }
  }
  return d;
}

export function updateCart(w, u) {
  const spd = w.humanSpeed(u) * (w.has('fastCarts') ? w.B.carts.fastMult : 1);
  switch (u.task) {
    case 'wait':
      u.timer -= w.DT;
      if (u.timer <= 0) u.task = 'idle';
      return;
    case 'idle': {
      const home = homeOf(w, u);
      if (u.cargo) {
        const r = w.routes.find(r => r.id === u.route);
        const B = r ? w.cityMap.get(r.to) : null;
        const drop = B ? (nearestDrop(w, B, u.cargo.r, u.x, u.y) || w.bMap.get(B.hall)) : null;
        if (drop) { goB(w, u, drop, 'deliver'); return; }
        const c = w.cityMap.get(u.city); if (c) { c.stock[u.cargo.r] += u.cargo.a; flow(w, c, u.cargo.r, u.cargo.a, 'Carts (returned)'); } u.cargo = null;
      }
      if (home && w.distToBuilding(u.x, u.y, home) > 2) { goB(w, u, home, 'return'); return; }
      const r = w.routes.find(r => r.id === u.route);
      if (!r) { u.task = 'wait'; u.timer = 3; return; }
      const A = w.cityMap.get(r.from), B = w.cityMap.get(r.to);
      if (!A || !B) { u.route = 0; return; }
      const amt = Math.floor(Math.min(cartCap(w), A.stock[r.res] - r.min, r.max - B.stock[r.res]));
      if (amt < 1) { u.task = 'wait'; u.timer = 3; return; }
      const drop = nearestDrop(w, B, r.res, u.x, u.y) || w.bMap.get(B.hall);
      if (!drop) { u.task = 'wait'; u.timer = 5; return; }
      A.stock[r.res] -= amt;
      flow(w, A, r.res, -amt, `Carts to ${B.name}`);
      u.cargo = { r: r.res, a: amt };
      goB(w, u, drop, 'deliver');
      return;
    }
    case 'deliver': case 'return': {
      const res = w.followPath(u, spd);
      if (res === 0) return;
      const b = w.bMap.get(u.tb);
      if (!b || b.dead) { u.task = 'idle'; return; }
      if (w.distToBuilding(u.x, u.y, b) > 2) {
        if (++u.fails > 4) { u.fails = 0; u.task = 'wait'; u.timer = 5; return; }
        goB(w, u, b, u.task); return;
      }
      u.fails = 0;
      if (u.task === 'deliver' && u.cargo) {
        const c = w.cityMap.get(b.city);
        if (c) {
          c.stock[u.cargo.r] += u.cargo.a;
          const rt = w.routes.find(r => r.id === u.route), A = rt ? w.cityMap.get(rt.from) : null;
          flow(w, c, u.cargo.r, u.cargo.a, A ? `Carts from ${A.name}` : 'Carts');
        }
        u.cargo = null;
        const home = homeOf(w, u);
        if (home) { goB(w, u, home, 'return'); return; }
      }
      u.task = 'idle';
      return;
    }
  }
}

// ---------------- trade network ----------------
// Cities whose town halls are joined by an unbroken road (bridges count, walls on the road break it)
// form a trade group. Every few seconds each outpost sends a share of its surplus above a working
// reserve to the group's hub (the capital, else the oldest city), and the hub tops up outposts
// that fall below their reserve. Trade pauses while either city is under attack.
export function tradeGroups(w) {
  if (w._tg && w._tgv === w.structVer) return w._tg;
  const W = w.W, N = w.N, comp = w._roadComp || (w._roadComp = new Int32Array(N));
  comp.fill(-1);
  const isRoad = t => w.road[t] > 0 && w.hSpeed[t] > 0;
  const stack = [];
  let nc = 0;
  for (let t0 = 0; t0 < N; t0++) {
    if (comp[t0] >= 0 || !w.road[t0] || !isRoad(t0)) continue;
    comp[t0] = nc; stack.push(t0);
    while (stack.length) {
      const t = stack.pop(), x = t % W;
      for (const nt of [x > 0 ? t - 1 : -1, x < W - 1 ? t + 1 : -1, t - W, t + W]) {
        if (nt < 0 || nt >= N || comp[nt] >= 0 || !isRoad(nt)) continue;
        comp[nt] = nc; stack.push(nt);
      }
    }
    nc++;
  }
  // Road components touching each town hall.
  const R = w.B.trade.hallReach, touch = new Map();
  for (const c of w.cities) {
    const h = w.bMap.get(c.hall);
    if (!h || h.dead || !h.done) continue;
    const set = new Set();
    for (let y = h.y - R; y < h.y + h.h + R; y++) for (let x = h.x - R; x < h.x + h.w + R; x++) {
      if (!w.inMap(x, y)) continue;
      const k = comp[y * W + x];
      if (k >= 0) set.add(k);
    }
    if (set.size) touch.set(c.id, set);
  }
  // Union cities sharing a component.
  const groups = [];
  const left = [...touch.keys()];
  while (left.length) {
    const g = [left.shift()], comps = new Set(touch.get(g[0]));
    for (let changed = true; changed;) {
      changed = false;
      for (let i = left.length - 1; i >= 0; i--) {
        if ([...touch.get(left[i])].some(k => comps.has(k))) { for (const k of touch.get(left[i])) comps.add(k); g.push(left[i]); left.splice(i, 1); changed = true; }
      }
    }
    if (g.length < 2) continue;
    const cs = g.map(id => w.cityMap.get(id));
    // Hub: the capital, else the oldest city (a pure function of structure, so caching stays deterministic).
    const hub = cs.find(c => c.id === w.capital) || cs.slice().sort((a, b) => a.id - b.id)[0];
    groups.push({ hub: hub.id, cities: cs.map(c => c.id).sort((a, b) => a - b) });
  }
  w._tg = groups; w._tgv = w.structVer;
  return groups;
}

function tradeReserve(w, c, res) {
  const T = w.B.trade;
  if (res === 'food') return Math.ceil((c.nCiv + c.nSol) * w.B.food.perPersonPerDay * T.foodDays) + 20;
  return T.reserve[res] || 0;
}

export function updateTrade(w) {
  const T = w.B.trade;
  if (w.tick % Math.round(T.interval / w.DT) !== 0) return;
  const calm = c => w.tick - c.lastAttack > T.attackPause / w.DT;
  for (const g of tradeGroups(w)) {
    const H = w.cityMap.get(g.hub);
    if (!H || !calm(H)) continue;
    for (const id of g.cities) {
      if (id === H.id) continue;
      const C = w.cityMap.get(id);
      if (!C || !calm(C)) continue;
      for (const res of w.B.resources) {
        const rc = tradeReserve(w, C, res), rh = tradeReserve(w, H, res);
        let amt = 0;
        if (C.stock[res] > rc) amt = Math.min(T.maxPerTrip, Math.floor((C.stock[res] - rc) * T.share));
        else if (C.stock[res] < rc && H.stock[res] > rh) amt = -Math.min(T.maxPerTrip, Math.floor(rc - C.stock[res]), Math.floor(H.stock[res] - rh));
        if (!amt) continue;
        C.stock[res] -= amt; H.stock[res] += amt;
        flow(w, C, res, -amt, amt > 0 ? `Trade to ${H.name}` : `Trade from ${H.name}`);
        flow(w, H, res, amt, amt > 0 ? `Trade from ${C.name}` : `Trade to ${C.name}`);
      }
    }
  }
}

// ---------------- settlers ----------------
// Two kinds of party: 'city' founds a new city in an unsettled region; 'camp' builds an
// outpost in the source city's own region that extends its build area.
const KIND = { city: { cfg: 'settlers', bd: 'townhall' }, camp: { cfg: 'camp', bd: 'camp' } };
export function partyCost(w, kind = 'city') {
  const S = w.B[KIND[kind].cfg], cost = { ...S.cost };
  for (const k in S.rations) cost[k] = (cost[k] || 0) + S.rations[k];
  return cost;
}

export function canFound(w, from, x, y, kind = 'city') {
  if (!KIND[kind]) return { ok: false, reason: 'Unknown expansion' };
  const d = w.BD[KIND[kind].bd], S = w.B[KIND[kind].cfg];
  const A = w.cityMap.get(from);
  if (!A) return { ok: false, reason: 'Select a source city' };
  const cx = x + d.w / 2, cy = y + d.h / 2;
  const region = w.regionAt(cx, cy);
  if (kind === 'city') {
    if (cityOfRegion(w, region)) return { ok: false, reason: 'This region already has a settlement' };
    if (w.parties.some(p => p.region === region && (p.kind || 'city') === 'city')) return { ok: false, reason: 'Settlers are already heading there' };
  } else {
    if (region !== A.region) return { ok: false, reason: `Camps go in ${A.name}'s own region` };
    if (placementCity(w, 'camp', x, y) === A) return { ok: false, reason: 'Already inside the build area' };
    const r = w.B.camp.radius;
    if (w.parties.some(p => p.kind === 'camp' && Math.hypot(p.x + d.w / 2 - cx, p.y + d.h / 2 - cy) < r)) return { ok: false, reason: 'A camp party is already heading near here' };
  }
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    if (!w.inMap(xx, yy)) return { ok: false, reason: 'Out of bounds' };
    const t = yy * w.W + xx;
    if (!w.explored[t]) return { ok: false, reason: 'Unexplored — scout it first' };
    if (w.bAt[t] || w.hSpeed[t] <= 0) return { ok: false, reason: 'Blocked' };
  }
  const civs = w.units.filter(u => !u.dead && u.k === 'civ' && u.city === A.id && !u.settler);
  if (civs.length < S.civilians + 2) return { ok: false, reason: `Need ${S.civilians} spare civilians` };
  const cost = partyCost(w, kind);
  if (!hasStock(A, cost)) return { ok: false, reason: `Needs ${costText(cost)}` };
  return { ok: true, A, region, cost, civs };
}

export function cmdFound(w, c) {
  const kind = c.kind || 'city';
  const r = canFound(w, c.from, c.x, c.y, kind);
  if (!r.ok) return r;
  const S = w.B[KIND[kind].cfg], d = w.BD[KIND[kind].bd];
  takeStock(r.A, r.cost, w, kind === 'camp' ? 'Camp party' : 'Settlers');
  const party = { id: w.nextId++, kind, from: r.A.id, region: r.region, x: c.x, y: c.y, members: [], cargo: { ...r.cost }, firstArrive: 0, waitMsg: 0 };
  const civs = r.civs.slice().sort((a, b) => (a.job ? 1 : 0) - (b.job ? 1 : 0) || a.id - b.id).slice(0, S.civilians);
  const slots = formation(civs.length, c.x + d.w / 2, c.y + d.h / 2, 1.4);
  civs.forEach((u, i) => {
    if (u.inside) w.exit(u);
    if (u.job) unassign(w, u);
    if (u.home) { const h = w.bMap.get(u.home); if (h) { const k = h.residents.indexOf(u.id); if (k >= 0) h.residents.splice(k, 1); } u.home = 0; }
    u.settler = party.id; u.task = 'settle'; u.carry = null;
    u.dx = slots[i][0]; u.dy = slots[i][1]; u.arrived = false; u.needPath = true;
    party.members.push(u.id);
  });
  w.parties.push(party);
  const where = w.map.def.regions[r.region].name;
  w.event('info', kind === 'camp' ? `A camp party sets out from ${r.A.name}` : `Settlers set out from ${r.A.name} for ${where}`, c.x, c.y);
  return { ok: true };
}

function updateParty(w, p) {
  const kind = p.kind || 'city', d = w.BD[KIND[kind].bd];
  const ms = p.members.map(id => w.unitMap.get(id)).filter(u => u && !u.dead);
  p.members = ms.map(u => u.id);
  const name = kind === 'camp' ? 'the new camp' : w.map.def.regions[p.region].name;
  if (!ms.length) {
    w.event('alert', `The settlers bound for ${name} were lost.`, p.x, p.y);
    w.parties.splice(w.parties.indexOf(p), 1);
    return;
  }
  let arrived = 0;
  for (const u of ms) {
    if (u.needPath) { u.needPath = false; if (!w.planPath(u, u.dx, u.dy)) u.arrived = true; }
    if (!u.arrived) {
      const r = w.followPath(u, w.humanSpeed(u));
      if (r !== 0) {
        if (Math.hypot(u.x - u.dx, u.y - u.dy) > 3 && u.fails++ < 4) u.needPath = true;
        else u.arrived = true;
      }
    }
    if (u.arrived) arrived++;
  }
  if (arrived && !p.firstArrive) p.firstArrive = w.tick;
  if (!(arrived === ms.length || (p.firstArrive && w.tick - p.firstArrive > 600))) return;
  const cx = p.x + d.w / 2, cy = p.y + d.h / 2;
  if (w.spatial.any(cx, cy, w.B.settlers.clearRadius, true, true)) {
    if (w.tick - p.waitMsg > 600) { p.waitMsg = w.tick; w.event('alert', `Settlers at ${name} wait: zombies nearby`, cx, cy); }
    return;
  }
  const A = w.cityMap.get(p.from);
  if (kind === 'city' && cityOfRegion(w, p.region)) { w.event('alert', `${name} is already settled; settlers return home.`, cx, cy); disband(w, p, ms, A); return; }
  if (kind === 'camp' && (!A || cityOfRegion(w, p.region) !== A)) { w.event('alert', 'The camp party has no city to serve; it disbands.', cx, cy); disband(w, p, ms, A); return; }
  let blocked = false;
  for (let y = p.y; y < p.y + d.h; y++) for (let x = p.x; x < p.x + d.w; x++) if (w.bAt[y * w.W + x] || w.hSpeed[y * w.W + x] <= 0) blocked = true;
  if (blocked) { const t = w.passableNear(w.tileOf(cx + 4, cy), w.hSpeed, 8); if (t >= 0) { p.x = (t % w.W) - 1; p.y = ((t / w.W) | 0) - 1; } return; }
  if (kind === 'camp') {
    // Wood and stone build the camp; the rations go into the city's stock.
    for (const k in w.B.camp.rations) { A.stock[k] += w.B.camp.rations[k]; flow(w, A, k, w.B.camp.rations[k], 'Camp rations returned'); }
    w.addBuilding('camp', p.x, p.y, A.id, true);
    disband(w, p, ms, A);
    return;
  }
  const city = createCity(w, p.region, cx, cy, false);
  for (const k in p.cargo) { city.stock[k] += p.cargo[k]; flow(w, city, k, p.cargo[k], 'Settlers'); }
  const hall = w.addBuilding('townhall', p.x, p.y, city.id, false);
  city.hall = hall.id;
  disband(w, p, ms, city);
  w.event('built', `${city.name} has been founded!`, cx, cy);
}

function disband(w, p, ms, city) {
  for (const u of ms) { u.settler = 0; u.task = 'idle'; u.city = city ? city.id : u.city; u.path = null; }
  w.parties.splice(w.parties.indexOf(p), 1);
}

export function updateLogistics(w) {
  updateTrade(w);
  for (const p of w.parties.slice()) updateParty(w, p);
  if (w.tick % 20 !== 0) return;
  for (const r of w.routes) {
    let n = 0;
    for (const u of w.units) if (u.k === 'cart' && u.route === r.id && !u.dead) n++;
    if (n < r.carts) {
      for (const u of w.units) {
        if (n >= r.carts) break;
        if (u.k !== 'cart' || u.dead || u.route || u.city !== r.from) continue;
        u.route = r.id; n++;
      }
    } else if (n > r.carts) {
      for (const u of w.units) {
        if (n <= r.carts) break;
        if (u.k === 'cart' && u.route === r.id && !u.cargo && (u.task === 'idle' || u.task === 'wait')) { u.route = 0; n--; }
      }
    }
  }
}
