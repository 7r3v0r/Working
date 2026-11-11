// Soldiers, squads, orders, training, towers and artillery.
import { lists, hasStock, takeStock, costText } from './civ.js';

export function newSquad(w, cityId, name, auto = false) {
  const s = { id: w.nextId++, name, city: cityId, auto, members: [], order: { t: 'idle', x: 0, y: 0 }, queue: [] };
  w.squads.push(s); w.squadMap.set(s.id, s);
  return s;
}
export function defaultSquad(w, cityId) {
  for (const s of w.squads) if (s.auto && s.city === cityId && s.members.length < 50) return s;
  const c = w.cityMap.get(cityId);
  const n = w.squads.filter(s => s.city === cityId).length + 1;
  return newSquad(w, cityId, `${c ? c.name : 'Free'} Guard ${n}`, true);
}
export function addToSquad(w, u, s) { u.squad = s.id; s.members.push(u.id); }
export function removeFromSquad(w, u) {
  const s = w.squadMap.get(u.squad);
  u.squad = 0;
  if (!s) return;
  const i = s.members.indexOf(u.id); if (i >= 0) s.members.splice(i, 1);
  if (!s.members.length) { w.squads.splice(w.squads.indexOf(s), 1); w.squadMap.delete(s.id); }
}

export function formation(n, x, y, spacing = 1.3) {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = (i / cols) | 0;
    out.push([x + (c - (cols - 1) / 2) * spacing, y + (r - (rows - 1) / 2) * spacing]);
  }
  return out;
}

function nearestCityId(w, x, y) {
  let best = 0, bd = Infinity;
  for (const c of w.cities) { const d = (c.cx - x) ** 2 + (c.cy - y) ** 2; if (d < bd) { bd = d; best = c.id; } }
  return best;
}

function members(w, sqs) {
  const out = [];
  for (const s of sqs) for (const id of s.members) { const u = w.unitMap.get(id); if (u && !u.dead) out.push(u); }
  out.sort((a, b) => a.id - b.id);
  return out;
}

// Turn a set of selected units into squads: fully selected squads are kept as they are;
// soldiers picked out of a larger squad are moved into a new squad of their own.
export function squadsForUnits(w, ids, forceNew = false) {
  const bySq = new Map();
  for (const id of ids) {
    const u = w.unitMap.get(id);
    if (!u || u.dead || u.isZ || !u.squad) continue;
    if (!bySq.has(u.squad)) bySq.set(u.squad, []);
    bySq.get(u.squad).push(u);
  }
  const out = [], loose = [];
  for (const [sid, us] of bySq) {
    const s = w.squadMap.get(sid);
    if (!forceNew && s && us.length === s.members.length) out.push(s);
    else loose.push(...us);
  }
  if (forceNew && bySq.size === 1) {
    const s = w.squadMap.get([...bySq.keys()][0]);
    if (s && s.members.length === loose.length) return [s];
  }
  loose.sort((a, b) => a.id - b.id);
  for (let i = 0; i < loose.length; i += 50) {
    const chunk = loose.slice(i, i + 50);
    const cityId = chunk[0].city;
    const c = w.cityMap.get(cityId);
    const n = w.squads.filter(s => s.city === cityId).length + 1;
    const ns = newSquad(w, cityId, `${c ? c.name : 'Free'} Squad ${n}`);
    const old = w.squadMap.get(chunk[0].squad);
    if (old) { ns.order = { ...old.order }; ns.queue = (old.queue || []).map(q => ({ ...q })); }
    for (const u of chunk) { removeFromSquad(w, u); addToSquad(w, u, ns); }
    out.push(ns);
  }
  return out;
}

export function cmdGroup(w, c) {
  const sqs = squadsForUnits(w, c.units, true);
  if (!sqs.length) return { ok: false, reason: 'No soldiers selected' };
  return { ok: true, squads: sqs.map(s => s.id) };
}

const QUEUEABLE = ['move', 'amove'];
const moving = s => QUEUEABLE.includes(s.order.t);

export function cmdOrder(w, c) {
  let sqs = c.units ? squadsForUnits(w, c.units) : c.squads.map(id => w.squadMap.get(id)).filter(Boolean);
  if (!sqs.length) return { ok: false, reason: 'No squad selected' };
  // Shift-queued waypoint: squads already on the move add it to their queue; the rest start now.
  if (c.queue && QUEUEABLE.includes(c.o)) {
    const rest = [];
    for (const s of sqs) {
      if (moving(s)) { if (!s.queue) s.queue = []; if (s.queue.length < 20) s.queue.push({ t: c.o, x: c.x, y: c.y }); }
      else rest.push(s);
    }
    if (!rest.length) return { ok: true };
    sqs = rest;
  }
  for (const s of sqs) s.queue = [];
  const ms = members(w, sqs);
  if (c.o === 'hold') {
    for (const s of sqs) s.order = { t: 'hold' };
    for (const u of ms) { u.dx = u.x; u.dy = u.y; u.path = null; u.coarse = null; u.tgt = 0; u.needPath = false; u.arrived = true; u.garrisonB = 0; }
    return { ok: true };
  }
  let x = c.x, y = c.y;
  let order = { t: c.o, x, y };
  if (c.o === 'garrison') {
    const b = w.bMap.get(c.b);
    if (!b || !w.BD[b.type].garrison || !b.done) return { ok: false, reason: 'Pick a finished tower' };
    let free = w.BD[b.type].garrison - b.inside.length;
    x = b.x + b.w / 2; y = b.y + b.h + 2;
    order = { t: 'idle', x, y };
    const rest = [];
    for (const u of ms) {
      if (u.inside) w.exit(u);
      if (free > 0 && w.UD[u.k].ranged) { u.garrisonB = b.id; u.path = null; free--; }
      else rest.push(u);
    }
    const slots = formation(rest.length, x, y);
    rest.forEach((u, i) => { u.garrisonB = 0; u.dx = slots[i][0]; u.dy = slots[i][1]; u.needPath = true; u.arrived = false; u.tgt = 0; });
    for (const s of sqs) s.order = order;
    return { ok: true };
  }
  if (c.o === 'attack') {
    const b = w.bMap.get(c.b);
    if (!b) return { ok: false, reason: 'No target' };
    x = b.x + b.w / 2; y = b.y + b.h / 2;
    order = { t: 'attack', b: b.id, x, y };
  }
  if (c.o === 'patrol') {
    let ax = 0, ay = 0; for (const u of ms) { ax += u.x; ay += u.y; }
    order = { t: 'patrol', x, y, ax: ax / ms.length, ay: ay / ms.length, leg: 1 };
  }
  const slots = formation(ms.length, x, y, c.o === 'attack' ? 1.6 : 1.3);
  ms.forEach((u, i) => {
    if (u.inside) w.exit(u);
    u.garrisonB = 0; u.dx = slots[i][0]; u.dy = slots[i][1]; u.needPath = true; u.arrived = false; u.tgt = 0; u.chased = false; u.fails = 0;
  });
  for (const s of sqs) s.order = { ...order };
  return { ok: true };
}

export function cmdMerge(w, c) {
  const sqs = c.squads.map(id => w.squadMap.get(id)).filter(Boolean);
  if (sqs.length < 2) return { ok: false };
  const keep = sqs[0];
  for (const s of sqs.slice(1)) {
    for (const id of s.members.slice()) {
      if (keep.members.length >= 50) break;
      const u = w.unitMap.get(id); if (!u) continue;
      removeFromSquad(w, u); addToSquad(w, u, keep);
    }
  }
  keep.auto = false;
  return { ok: true, squad: keep.id };
}
export function cmdSplit(w, c) {
  const s = w.squadMap.get(c.squad);
  if (!s || s.members.length < 2) return { ok: false };
  const ns = newSquad(w, s.city, s.name.replace(/ \(split.*\)$/, '') + ' (split)');
  ns.order = { ...s.order };
  const move = s.members.slice(Math.ceil(s.members.length / 2));
  for (const id of move) { const u = w.unitMap.get(id); if (u) { removeFromSquad(w, u); addToSquad(w, u, ns); } }
  return { ok: true, squad: ns.id };
}

// ETA in seconds for a squad to reach its order target (coarse estimate).
export function squadETA(w, s) {
  if (!s.order || !['move', 'amove', 'patrol', 'attack'].includes(s.order.t)) return null;
  const ms = members(w, [s]);
  if (!ms.length) return null;
  let worst = 0;
  for (const u of ms) {
    if (u.arrived) continue;
    const st = w.passableNear(w.tileOf(u.x, u.y), w.hSpeed, 3), gt = w.passableNear(w.tileOf(u.dx, u.dy), w.hSpeed, 6);
    if (st < 0 || gt < 0) continue;
    const d = Math.hypot(u.dx - u.x, u.dy - u.y);
    let cost = d < 30 ? d : w.hg.pathCost(w.hg.comp[st], w.hg.comp[gt]);
    if (!isFinite(cost)) cost = d;
    worst = Math.max(worst, cost / w.UD[u.k].speed);
    if (ms.length > 12) break; // first moving member is representative
  }
  return worst;
}

function findStructTarget(w, u, r) {
  const W = w.W, x0 = Math.max(0, (u.x - r) | 0), x1 = Math.min(W - 1, (u.x + r) | 0);
  const y0 = Math.max(0, (u.y - r) | 0), y1 = Math.min(w.H - 1, (u.y + r) | 0);
  let best = 0, bd = Infinity;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const id = w.bAt[y * W + x];
    if (!id) continue;
    const b = w.bMap.get(id);
    if (!b || b.dead || !(b.infected || w.BD[b.type].zombie)) continue;
    const d = (x - u.x) ** 2 + (y - u.y) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

const tmp = [];
function strike(w, u, d, t) {
  let dmg = d.dps * w.DT;
  if (u.k === 'spear') {
    if (w.has('spearFormation')) {
      w.spatial.within(u.x, u.y, 3, false, tmp);
      let n = 0; for (const o of tmp) if (o.k === 'spear' && o !== u) n++;
      if (n >= 3) dmg *= 1 + (d.formationBonus || 0.3);
    }
    w.damageUnit(t, dmg, u);
    if ((d.targets || 1) > 1) {
      const t2 = w.spatial.nearest(u.x, u.y, d.range + 0.3, true, false, t);
      if (t2) w.damageUnit(t2, dmg, u);
    }
  } else w.damageUnit(t, dmg, u);
  if (d.ranged && (w.tick + u.id) % 8 === 0) w.fx.push({ k: 'arrow', x1: u.x, y1: u.y, x2: t.x, y2: t.y, tick: w.tick });
}

function hitBuilding(w, u, d, b) {
  const dmg = d.dps * w.DT;
  if (b.infected) {
    b.infHp -= dmg;
    if (b.infHp <= 0) {
      b.infected = false; b.infCount = 0; b.inside.length = 0;
      w.event('info', `Infection cleared at ${w.BD[b.type].name}`, b.x + b.w / 2, b.y + b.h / 2);
    }
  } else {
    w.damageBuilding(b, dmg, false);
  }
  if (d.ranged && (w.tick + u.id) % 8 === 0) w.fx.push({ k: 'arrow', x1: u.x, y1: u.y, x2: b.x + b.w / 2, y2: b.y + b.h / 2, tick: w.tick });
}

function towerFire(w, u, d) {
  const b = w.bMap.get(u.inside);
  if (!b || d.dps <= 0) return;
  if ((w.tick + u.id) % 3 === 0 || !w.unit(u.tgt)) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const t = w.spatial.nearest(cx, cy, d.range + (d.towerBonus || 0), true);
    u.tgt = t ? t.id : 0;
  }
  const t = w.unit(u.tgt);
  if (t && !t.dead) {
    const dmg = d.dps * w.DT;
    w.damageUnit(t, dmg, u);
    if ((w.tick + u.id) % 8 === 0) w.fx.push({ k: 'arrow', x1: b.x + b.w / 2, y1: b.y + b.h / 2, x2: t.x, y2: t.y, tick: w.tick });
  }
}

export function updateSoldier(w, u) {
  const d = w.UD[u.k];
  if (u.inside) { towerFire(w, u, d); return; }
  if ((w.tick + u.id) % 50 === 0) u.city = nearestCityId(w, u.x, u.y) || u.city;
  const sq = w.squadMap.get(u.squad);
  const o = sq ? sq.order : { t: 'idle' };
  const S = w.B.soldier;
  const spd = w.humanSpeed(u);
  if (u.garrisonB) {
    const b = w.bMap.get(u.garrisonB);
    if (!b || b.dead || !b.done) u.garrisonB = 0;
    else if (w.distToBuilding(u.x, u.y, b) <= 1.3) {
      if (b.inside.length < w.BD[b.type].garrison) w.enter(u, b);
      u.garrisonB = 0; u.dx = u.x; u.dy = u.y;
      return;
    } else {
      if (!u.path) {
        const t = w.approach(b, u.x, u.y);
        if (t < 0 || !w.planPath(u, t % w.W + 0.5, ((t / w.W) | 0) + 0.5)) { u.garrisonB = 0; return; }
      }
      w.followPath(u, spd);
      return;
    }
  }
  if (d.dps > 0 && o.t !== 'move') {
    const hold = o.t === 'hold';
    const engage = hold ? d.range + 0.5 : Math.max(d.range + 0.5, o.t === 'idle' ? S.engage : S.amoveEngage);
    if ((w.tick + u.id) % 3 === 0 || (u.tgt && !w.unit(u.tgt))) {
      const t = w.spatial.nearest(u.x, u.y, engage, true);
      u.tgt = t ? t.id : 0;
      if (t && o.t === 'idle' && !d.ranged && Math.hypot(t.x - u.dx, t.y - u.dy) > S.leash) u.tgt = 0;
    }
    const t = w.unit(u.tgt);
    if (t && !t.dead) {
      const dist = Math.hypot(t.x - u.x, t.y - u.y);
      const reach = d.ranged ? d.range : d.range + 0.3;
      if (dist <= reach) { strike(w, u, d, t); return; }
      if (!hold) {
        if (!u.chased) { u.chased = true; u.path = null; u.coarse = null; }
        if (w.steer(u, t.x, t.y, spd, false) !== 0) u.tgt = 0;
        return;
      }
    } else u.tgt = 0;
    // Structures: nests and infected buildings
    let tb = o.t === 'attack' ? w.bMap.get(o.b) : null;
    if (!tb && !hold) {
      if ((w.tick + u.id) % 10 === 0) u.tb = findStructTarget(w, u, engage);
      tb = w.bMap.get(u.tb);
    }
    if (tb && !tb.dead && (tb.infected || w.BD[tb.type].zombie)) {
      const dist = w.distToBuilding(u.x, u.y, tb);
      if (dist <= (d.ranged ? d.range : 1.3)) { u.path = null; hitBuilding(w, u, d, tb); return; }
      if (!hold) {
        if (!u.path || u.pathFor !== tb.id) {
          const at = w.approach(tb, u.x, u.y);
          u.pathFor = tb.id;
          if (at < 0 || !w.planPath(u, at % w.W + 0.5, ((at / w.W) | 0) + 0.5)) { u.tb = 0; return; }
        }
        w.followPath(u, spd);
        return;
      }
    }
  }
  if (u.chased || u.pathFor) { u.chased = false; u.pathFor = 0; u.needPath = !u.arrived || Math.hypot(u.x - u.dx, u.y - u.dy) > 2; }
  if (u.needPath) {
    u.needPath = false; u.arrived = false;
    if (!w.planPath(u, u.dx, u.dy)) { u.arrived = true; }
  }
  if (u.path) {
    const r = w.followPath(u, spd);
    if (r !== 0) {
      if (r === -1 && Math.hypot(u.x - u.dx, u.y - u.dy) > 2.5 && u.fails++ < 3) u.needPath = true;
      else { u.arrived = true; u.fails = 0; }
    }
  } else if (!u.arrived && !u.needPath) u.arrived = true;
}

export function updateSquads(w) {
  if (w.tick % 10 !== 0) return;
  for (const s of w.squads) {
    const o = s.order;
    if (o.t !== 'move' && o.t !== 'amove' && o.t !== 'patrol') continue;
    let all = true;
    for (const id of s.members) { const u = w.unitMap.get(id); if (u && !u.arrived) { all = false; break; } }
    if (!all) continue;
    if (o.t === 'patrol') {
      o.leg = 1 - o.leg;
      const tx = o.leg ? o.x : o.ax, ty = o.leg ? o.y : o.ay;
      const ms = members(w, [s]);
      const slots = formation(ms.length, tx, ty);
      ms.forEach((u, i) => { u.dx = slots[i][0]; u.dy = slots[i][1]; u.needPath = true; u.arrived = false; });
    } else if (s.queue && s.queue.length) {
      const nx = s.queue.shift();
      s.order = { t: nx.t, x: nx.x, y: nx.y };
      const ms = members(w, [s]);
      const slots = formation(ms.length, nx.x, nx.y);
      ms.forEach((u, i) => { u.dx = slots[i][0]; u.dy = slots[i][1]; u.needPath = true; u.arrived = false; u.tgt = 0; u.chased = false; u.fails = 0; });
    } else s.order = { t: 'idle', x: o.x, y: o.y };
  }
}

// ---------------- training ----------------
function pickRecruit(w, city) {
  let best = null, score = -1;
  for (const u of w.units) {
    if (u.dead || u.k !== 'civ' || u.city !== city.id || u.settler || u.task === 'shelter' || u.task === 'flee') continue;
    const s = u.job ? 1 : 2;
    if (s > score) { score = s; best = u; if (s === 2) break; }
  }
  return best;
}
export function consumeCiv(w, u) {
  if (u.inside) w.exit(u);
  if (u.job) { const b = w.bMap.get(u.job); if (b) { const i = b.workers.indexOf(u.id); if (i >= 0) b.workers.splice(i, 1); } u.job = 0; }
  if (u.home) { const h = w.bMap.get(u.home); if (h) { const i = h.residents.indexOf(u.id); if (i >= 0) h.residents.splice(i, 1); } u.home = 0; }
  u.dead = true;
}

export function trainTime(w) { return w.B.training.time * (w.has('fastTraining') ? 0.5 : 1); }

export function updateBarracks(w, b) {
  if (!b.queue.length) { b.stall = ''; return; }
  const city = w.cityMap.get(b.city);
  if (!city) return;
  if (!b.training) {
    const k = b.queue[0], d = w.UD[k];
    if (d.research && !w.has(d.research)) { b.stall = 'Needs research'; return; }
    if (!hasStock(city, d.cost)) { b.stall = `Needs ${costText(d.cost)}`; return; }
    const civ = pickRecruit(w, city);
    if (!civ) { b.stall = 'No civilians available'; return; }
    takeStock(city, d.cost, w, 'Training');
    consumeCiv(w, civ);
    b.training = k; b.trainT = trainTime(w); b.stall = '';
  }
  b.trainT -= w.DT;
  if (b.trainT > 0) return;
  const k = b.training;
  b.training = null; b.queue.shift();
  const t = w.passableNear(w.tileOf(b.x + b.w / 2, b.y + b.h), w.hSpeed, 4);
  const x = t >= 0 ? t % w.W + 0.5 : b.x + b.w / 2, y = t >= 0 ? ((t / w.W) | 0) + 0.5 : b.y + b.h + 0.5;
  const [rx, ry] = rallySlot(w, x, y + 1.5);
  const u = w.spawn(k, x, y, { city: city.id, dx: rx, dy: ry });
  u.needPath = rx !== x || ry !== y;
  addToSquad(w, u, defaultSquad(w, city.id));
}

// New recruits walk to the nearest open spot below the barracks instead of piling onto the exit.
function rallySlot(w, x, y) {
  const slots = formation(49, x, y + 3, 1.3).sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
  const sol = w.units.filter(u => !u.dead && !u.isZ && !u.inside && u.squad);
  for (const [sx, sy] of slots) {
    if (!w.inMap(sx, sy) || w.hSpeed[w.tileOf(sx, sy)] <= 0) continue;
    if (sol.some(u => Math.hypot(u.x - sx, u.y - sy) < 0.9 || Math.hypot(u.dx - sx, u.dy - sy) < 0.9)) continue;
    return [sx, sy];
  }
  return [x, y];
}

// Idle soldiers standing on top of each other drift apart (and keep the new spot as their post).
export function separateSoldiers(w) {
  const S = w.spatial, r = w.B.soldier.separation, r2 = r * r, U = w.units;
  for (let i = 0; i < U.length; i++) {
    const u = U[i];
    if (u.dead || u.isZ || u.inside || !u.squad || !u.arrived || u.path || u.tgt || u.garrisonB) continue;
    const cx = (u.x / S.cs) | 0, cy = (u.y / S.cs) | 0;
    let px = 0, py = 0, n = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= S.cw || yy >= S.ch) continue;
      for (let j = S.head[yy * S.cw + xx]; j >= 0; j = S.next[j]) {
        const o = S.units[j];
        if (o === u || o.dead || o.isZ || !o.squad) continue;
        const dx = u.x - o.x, dy = u.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        n++;
        if (d2 < 1e-6) { const a = (u.id * 2.39996) % 6.2832; px += Math.cos(a) * 0.1; py += Math.sin(a) * 0.1; continue; }
        const d = Math.sqrt(d2), k = (r - d) / d * 0.25;
        px += dx * k; py += dy * k;
      }
    }
    if (!n) continue;
    const nx = u.x + px, ny = u.y + py;
    if (!w.inMap(nx, ny)) continue;
    const nt = w.tileOf(nx, ny);
    if (nt !== w.tileOf(u.x, u.y) && !w.canEnter(nt, false)) continue;
    u.x = nx; u.y = ny; u.dx = nx; u.dy = ny;
  }
}

export function cmdTrain(w, c) {
  const b = w.bMap.get(c.b);
  if (!b || !w.BD[b.type].train || !b.done) return { ok: false, reason: 'Not a barracks' };
  const d = w.UD[c.k];
  if (!d || !d.soldier) return { ok: false, reason: 'Unknown unit' };
  if (d.research && !w.has(d.research)) return { ok: false, reason: 'Requires research' };
  const n = c.n || 1;
  for (let i = 0; i < n && b.queue.length < 30; i++) b.queue.push(c.k);
  return { ok: true };
}
export function cmdCancelTrain(w, c) {
  const b = w.bMap.get(c.b);
  if (!b) return { ok: false };
  const i = c.i;
  if (i === 0 && b.training) return { ok: false, reason: 'Already training' };
  if (i >= 0 && i < b.queue.length) b.queue.splice(i, 1);
  return { ok: true };
}

// ---------------- artillery ----------------
const near = [];
export function updateArtillery(w, b) {
  const d = w.BD[b.type], A = d.artillery;
  let crew = 0;
  for (const id of b.workers) { const u = w.unitMap.get(id); if (u && u.inside === b.id) crew++; }
  b.crewed = crew >= d.workers;
  if (!b.crewed) return;
  b.cd -= w.DT;
  if (b.cd > 0) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  w.spatial.within(cx, cy, A.range, true, near);
  let target = null, bestN = -1;
  for (let i = 0; i < near.length && i < 24; i++) {
    const z = near[i];
    if (z.dormant) continue;
    const dist = Math.hypot(z.x - cx, z.y - cy);
    if (dist < A.minRange) continue;
    if (!A.pierce) {
      let n = 0;
      for (const o of near) if ((o.x - z.x) ** 2 + (o.y - z.y) ** 2 <= A.radius * A.radius) n++;
      if (n > bestN) { bestN = n; target = z; }
    } else if (!target || dist < Math.hypot(target.x - cx, target.y - cy)) target = z;
  }
  if (!target) { b.cd = 0.5; return; }
  b.cd = A.reload;
  if (!A.pierce) {
    const tx = target.x, ty = target.y;
    for (const o of near.slice()) if ((o.x - tx) ** 2 + (o.y - ty) ** 2 <= A.radius * A.radius) w.damageUnit(o, A.damage, null);
    w.fx.push({ k: 'boom', x: tx, y: ty, r: A.radius, tick: w.tick });
  } else {
    let dx = target.x - cx, dy = target.y - cy;
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    for (const o of near.slice()) {
      const px = o.x - cx, py = o.y - cy;
      const along = px * dx + py * dy;
      if (along < 0 || along > A.range) continue;
      const perp = Math.abs(px * dy - py * dx);
      if (perp <= A.width) w.damageUnit(o, A.damage, null);
    }
    w.fx.push({ k: 'bolt', x1: cx, y1: cy, x2: cx + dx * A.range, y2: cy + dy * A.range, tick: w.tick });
  }
}

export { lists };
