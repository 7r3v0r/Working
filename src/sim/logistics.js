// Carts, cart routes, settler parties.
import { lists, hasStock, takeStock, costText, cityOfRegion, nearestDrop, createCity, unassign } from './civ.js';
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
    takeStock(city, C.cost);
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
        const c = w.cityMap.get(u.city); if (c) c.stock[u.cargo.r] += u.cargo.a; u.cargo = null;
      }
      if (home && w.distToBuilding(u.x, u.y, home) > 2) { goB(w, u, home, 'return'); return; }
      const r = w.routes.find(r => r.id === u.route);
      if (!r) { u.task = 'wait'; u.timer = 3; return; }
      const A = w.cityMap.get(r.from), B = w.cityMap.get(r.to);
      if (!A || !B) { u.route = 0; return; }
      const amt = Math.floor(Math.min(cartCap(w), A.stock[r.res] - r.min, r.max - B.stock[r.res]));
      if (amt < 1) { u.task = 'wait'; u.timer = 3; return; }
      A.stock[r.res] -= amt;
      u.cargo = { r: r.res, a: amt };
      const drop = nearestDrop(w, B, r.res, u.x, u.y) || w.bMap.get(B.hall);
      if (!drop) { A.stock[r.res] += amt; u.cargo = null; u.task = 'wait'; u.timer = 5; return; }
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
        if (c) c.stock[u.cargo.r] += u.cargo.a;
        u.cargo = null;
        const home = homeOf(w, u);
        if (home) { goB(w, u, home, 'return'); return; }
      }
      u.task = 'idle';
      return;
    }
  }
}

// ---------------- settlers ----------------
export function canFound(w, from, x, y) {
  const d = w.BD.townhall, S = w.B.settlers;
  const A = w.cityMap.get(from);
  if (!A) return { ok: false, reason: 'Select a source city' };
  const region = w.regionAt(x + 1.5, y + 1.5);
  if (cityOfRegion(w, region)) return { ok: false, reason: 'This region already has a settlement' };
  if (w.parties.some(p => p.region === region)) return { ok: false, reason: 'Settlers are already heading there' };
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    if (!w.inMap(xx, yy)) return { ok: false, reason: 'Out of bounds' };
    const t = yy * w.W + xx;
    if (!w.explored[t]) return { ok: false, reason: 'Unexplored — scout it first' };
    if (w.bAt[t] || w.hSpeed[t] <= 0) return { ok: false, reason: 'Blocked' };
  }
  const civs = w.units.filter(u => !u.dead && u.k === 'civ' && u.city === A.id && !u.settler);
  if (civs.length < S.civilians + 2) return { ok: false, reason: `Need ${S.civilians} spare civilians` };
  const cost = { ...S.cost };
  for (const k in S.rations) cost[k] = (cost[k] || 0) + S.rations[k];
  if (!hasStock(A, cost)) return { ok: false, reason: `Needs ${costText(cost)}` };
  return { ok: true, A, region, cost, civs };
}

export function cmdFound(w, c) {
  const r = canFound(w, c.from, c.x, c.y);
  if (!r.ok) return r;
  const S = w.B.settlers;
  takeStock(r.A, r.cost);
  const party = { id: w.nextId++, from: r.A.id, region: r.region, x: c.x, y: c.y, members: [], cargo: { ...r.cost }, firstArrive: 0, waitMsg: 0 };
  const civs = r.civs.slice().sort((a, b) => (a.job ? 1 : 0) - (b.job ? 1 : 0) || a.id - b.id).slice(0, S.civilians);
  const slots = formation(civs.length, c.x + 1.5, c.y + 1.5, 1.4);
  civs.forEach((u, i) => {
    if (u.inside) w.exit(u);
    if (u.job) unassign(w, u);
    if (u.home) { const h = w.bMap.get(u.home); if (h) { const k = h.residents.indexOf(u.id); if (k >= 0) h.residents.splice(k, 1); } u.home = 0; }
    u.settler = party.id; u.task = 'settle'; u.carry = null;
    u.dx = slots[i][0]; u.dy = slots[i][1]; u.arrived = false; u.needPath = true;
    party.members.push(u.id);
  });
  w.parties.push(party);
  w.event('info', `Settlers set out from ${r.A.name} for ${w.map.def.regions[r.region].name}`, c.x, c.y);
  return { ok: true };
}

function updateParty(w, p) {
  const ms = p.members.map(id => w.unitMap.get(id)).filter(u => u && !u.dead);
  p.members = ms.map(u => u.id);
  const name = w.map.def.regions[p.region].name;
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
  const cx = p.x + 1.5, cy = p.y + 1.5;
  if (w.spatial.any(cx, cy, w.B.settlers.clearRadius, true, true)) {
    if (w.tick - p.waitMsg > 600) { p.waitMsg = w.tick; w.event('alert', `Settlers at ${name} wait: zombies nearby`, cx, cy); }
    return;
  }
  if (cityOfRegion(w, p.region)) { w.event('alert', `${name} is already settled; settlers return home.`, cx, cy); disband(w, p, ms, w.cityMap.get(p.from)); return; }
  let blocked = false;
  for (let y = p.y; y < p.y + 3; y++) for (let x = p.x; x < p.x + 3; x++) if (w.bAt[y * w.W + x] || w.hSpeed[y * w.W + x] <= 0) blocked = true;
  if (blocked) { const t = w.passableNear(w.tileOf(cx + 4, cy), w.hSpeed, 8); if (t >= 0) { p.x = (t % w.W) - 1; p.y = ((t / w.W) | 0) - 1; } return; }
  const city = createCity(w, p.region, cx, cy, false);
  for (const k in p.cargo) city.stock[k] += p.cargo[k];
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
