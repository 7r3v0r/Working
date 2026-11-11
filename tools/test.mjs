// Headless integration tests for the simulation. Run: node tools/test.mjs
import { newWorld, loadDefs } from './headless.mjs';
import { build, run, findSpot } from './scenario.mjs';
import { serialize, deserialize, stateHash } from '../src/sim/save.js';
import { canFound } from '../src/sim/logistics.js';
import { canPlace } from '../src/sim/civ.js';
import { TER } from '../src/sim/map.js';
import { Graph } from '../src/sim/pathing.js';

let failed = 0;
const results = [];
function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}
const civs = (w, c) => w.units.filter(u => !u.dead && u.k === 'civ' && u.city === c.id).length;
const killDormantNear = (w, x, y, r) => { for (const u of w.units) if (u.isZ && Math.hypot(u.x - x, u.y - y) < r) u.dead = true; };
// An explored, empty, buildable 2×2 spot near (x, y), ignoring build-area rules.
const findOpen = (w, x0, y0) => {
  for (let r = 3; r < 15; r++) for (let a = 0; a < 24; a++) {
    const x = Math.round(x0 + Math.cos(a / 24 * 6.283) * r), y = Math.round(y0 + Math.sin(a / 24 * 6.283) * r);
    let ok = true;
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
      const t = yy * w.W + xx, ter = w.map.terrain[t];
      if (!w.explored[t] || w.bAt[t] || ter === TER.RIVER || ter === TER.FORD || ter === TER.CLIFF) ok = false;
    }
    if (ok) return [x, y];
  }
  return [x0, y0];
};
const starterTown = w => {
  const c = w.cities[0];
  for (const t of ['farm', 'farm', 'farm', 'house', 'house', 'house', 'house', 'granary', 'woodcutter']) build(w, t, c.cx, c.cy);
  return c;
};

// 1. Economy: production, housing, growth
{
  const w = newWorld(11); const c = starterTown(w);
  const food0 = c.stock.food;
  run(w, 3000);
  check('economy: farms raise food stock', c.stock.food > food0, `${food0} -> ${c.stock.food.toFixed(0)}`);
  check('economy: houses add housing', c.housing >= 34, `housing ${c.housing}`);
  run(w, 3000);
  check('economy: population grows with free housing + surplus', civs(w, c) > 30, `civilians ${civs(w, c)}`);
}

// 2. One zombie in an undefended town converts it within ~60 s
{
  const w = newWorld(12); const c = starterTown(w);
  run(w, 600);
  for (const u of w.units) if (!u.isZ && u.k !== 'civ') u.dead = true;
  run(w, 1);
  w.spawn('zombie', c.cx + 6.5, c.cy + 6.5, { zg: { t: 'city', c: c.id } });
  let t = 0;
  while (t < 1200 && civs(w, c) > 0 && w.status.state === 'playing') { run(w, 10); t += 10; }
  check('infection: one zombie converts an undefended town in ~60 s', civs(w, c) === 0 && t <= 900, `${(t * w.DT).toFixed(0)} s, civilians left ${civs(w, c)}`);
}

// 3. Settlers, carts, routes, starvation when a food route is cut
{
  const w = newWorld(13); const c = starterTown(w);
  c.stock.wood += 600; c.stock.stone += 200; c.stock.food += 600;
  run(w, 300);
  const R = w.map.def.regions[1]; // Riverlands
  const [sx, sy] = R.seed;
  w.revealAround(sx, sy, 30);
  killDormantNear(w, sx, sy, 80);
  let spot = null;
  for (let r = 0; r < 25 && !spot; r++) for (let a = 0; a < 16 && !spot; a++) {
    const x = Math.round(sx + Math.cos(a / 16 * 6.283) * r), y = Math.round(sy + Math.sin(a / 16 * 6.283) * r);
    if (canFound(w, c.id, x, y).ok) spot = [x, y];
  }
  const fr = spot ? w.cmd({ t: 'found', from: c.id, x: spot[0], y: spot[1] }) : { ok: false };
  check('settlers: party sets out', fr.ok, fr.reason || '');
  let t = 0;
  while (t < 20000 && w.cities.length < 2) { run(w, 100); t += 100; killDormantNear(w, sx, sy, 60); }
  const nc = w.cities[1];
  check('settlers: new city founded after real travel time', !!nc, nc ? `${nc.name} after ${(t * w.DT / 60).toFixed(1)} min` : 'not founded');
  if (nc) {
    run(w, 400);
    build(w, 'house', nc.cx, nc.cy);
    const dep = build(w, 'cartdepot', c.cx, c.cy);
    run(w, 200);
    w.cmd({ t: 'buildCart', b: dep.id, n: 3 });
    run(w, 600);
    const carts = w.units.filter(u => u.k === 'cart').length;
    check('carts: depot builds carts', carts >= 3, `${carts} carts`);
    const rr = w.cmd({ t: 'route', res: 'food', from: c.id, to: nc.id, min: 50, max: 400, carts: 3 });
    const before = nc.stock.food;
    for (let i = 0; i < 40 && nc.stock.food <= before + 20; i++) { run(w, 500); killDormantNear(w, nc.cx, nc.cy, 70); }
    check('carts: route delivers food between cities', nc.stock.food > before + 20, `${before.toFixed(0)} -> ${nc.stock.food.toFixed(0)}`);
    w.cmd({ t: 'delRoute', id: rr.id });
    nc.stock.food = 5;
    let z = 0;
    for (let i = 0; i < 60 && !z; i++) {
      run(w, 100);
      z = w.units.filter(u => u.isZ && !u.dormant && Math.hypot(u.x - nc.cx, u.y - nc.cy) < 40).length + w.buildings.filter(b => b.city === nc.id && b.infected).length;
    }
    check('starvation: cutting the food route makes zombies inside the city', z > 0, `${z} zombies/infected buildings in ${nc.name}`);
  }
}

// 3b. Camps extend a city's build area within its own region
{
  const w = newWorld(17); const c = starterTown(w);
  c.stock.wood += 300; c.stock.stone += 100; c.stock.food += 200;
  run(w, 300);
  w.revealAround(c.cx, c.cy, 110);
  let spot = null;
  for (let r = 65; r < 100 && !spot; r += 2) for (let a = 0; a < 24 && !spot; a++) {
    const x = Math.round(c.cx + Math.cos(a / 24 * 6.283) * r), y = Math.round(c.cy + Math.sin(a / 24 * 6.283) * r);
    if (canFound(w, c.id, x, y, 'camp').ok) spot = [x, y];
  }
  check('camp: a spot outside the build area is valid', !!spot);
  const inside = findSpot(w, 'house', c.cx, c.cy);
  const ir = canFound(w, c.id, inside[0], inside[1], 'camp');
  check('camp: rejected inside the build area', ir.reason === 'Already inside the build area', ir.reason || 'accepted');
  if (spot) {
    const sx = spot[0] + 1, sy = spot[1] + 1;
    killDormantNear(w, sx, sy, 60);
    const before = canPlace(w, 'house', ...findOpen(w, sx, sy)).ok;
    const wood0 = c.stock.wood, food0 = c.stock.food;
    const fr = w.cmd({ t: 'found', kind: 'camp', from: c.id, x: spot[0], y: spot[1] });
    check('camp: party sets out at the camp price', fr.ok && wood0 - c.stock.wood === w.B.camp.cost.wood, fr.reason || `wood ${wood0} -> ${c.stock.wood}, food ${food0.toFixed(0)} -> ${c.stock.food.toFixed(0)}`);
    let t = 0;
    while (t < 20000 && !w.buildings.some(b => b.type === 'camp' && !b.dead)) { run(w, 100); t += 100; killDormantNear(w, sx, sy, 60); }
    const camp = w.buildings.find(b => b.type === 'camp' && !b.dead);
    check('camp: built by the party for the source city', !!camp && camp.city === c.id && w.cities.length === 1, camp ? `after ${(t * w.DT / 60).toFixed(1)} min` : 'not built');
    const [hx, hy] = findOpen(w, sx, sy);
    const after = canPlace(w, 'house', hx, hy);
    check('camp: houses can be placed near the camp', !before && after.ok && after.city === c, after.reason || '');
  }
}

// 3c. Fog: human pathing only knows explored terrain
{
  const w = newWorld(21);
  const st = w.map.def.start, W = w.W;
  let river = -1, bd = Infinity;
  for (let t = 0; t < w.N; t++) if (w.map.terrain[t] === TER.RIVER && !w.explored[t]) {
    const d = Math.hypot(t % W - st[0], ((t / W) | 0) - st[1]); if (d < bd) { bd = d; river = t; }
  }
  check('fog: an unexplored river looks open to planners', river >= 0 && w.kSpeed[river] > 0 && w.hSpeed[river] === 0);
  const u = w.unitMap.get(w.squads[0].members[0]);
  const rx = river % W, ry = (river / W) | 0, d = Math.hypot(rx - u.x, ry - u.y);
  const gx = rx + (rx - u.x) / d * 12, gy = ry + (ry - u.y) / d * 12;
  const truth = new Graph(W, w.H, w.hSpeed, 0.5); truth.rebuildAll();
  const st0 = w.tileOf(u.x, u.y), gt = w.tileOf(gx, gy);
  const known = w.hg.pathCost(w.hg.comp[st0], w.hg.comp[gt]), real = truth.pathCost(truth.comp[st0], truth.comp[gt]);
  check('fog: the planned route does not use hidden terrain', known < real, `known ${known.toFixed(0)} vs real ${real.toFixed(0)}`);
  w.cmd({ t: 'order', units: [u.id], o: 'move', x: gx, y: gy });
  let t = 0;
  while (t < 8000 && Math.hypot(u.x - gx, u.y - gy) > 3) { run(w, 50); t += 50; killDormantNear(w, u.x, u.y, 30); }
  check('fog: the unit discovers the river and reroutes to the far bank', Math.hypot(u.x - gx, u.y - gy) <= 3, `${(t * w.DT).toFixed(0)} s`);
  check('fog: the river is now known as blocked', w.kSpeed[river] === 0 || !w.explored[river]);
}

// 3d. Shift-queued waypoints
{
  const w = newWorld(22);
  const st = w.map.def.start;
  const sq = w.squads[0], ids = [...sq.members];
  const center = () => { let x = 0, y = 0; for (const id of ids) { const u = w.unitMap.get(id); x += u.x; y += u.y; } return [x / ids.length, y / ids.length]; };
  const pts = [[st[0] + 18, st[1] + 4], [st[0] + 18, st[1] + 20], [st[0] + 2, st[1] + 22]].map(([x, y]) => { const t = w.passableNear(w.tileOf(x, y), w.hSpeed, 6); return [t % w.W + 0.5, ((t / w.W) | 0) + 0.5]; });
  w.cmd({ t: 'order', units: ids, o: 'move', x: pts[0][0], y: pts[0][1] });
  w.cmd({ t: 'order', units: ids, o: 'move', x: pts[1][0], y: pts[1][1], queue: true });
  w.cmd({ t: 'order', units: ids, o: 'amove', x: pts[2][0], y: pts[2][1], queue: true });
  const s = w.squadMap.get(w.unitMap.get(ids[0]).squad);
  check('waypoints: shift-orders are queued', s.queue.length === 2, `queue ${s.queue.length}`);
  const near = [Infinity, Infinity, Infinity];
  for (let i = 0; i < 120; i++) { run(w, 20); const [cx, cy] = center(); pts.forEach((p, k) => { near[k] = Math.min(near[k], Math.hypot(cx - p[0], cy - p[1])); }); }
  check('waypoints: the squad visits each waypoint in turn', near.every(d => d < 3) && s.queue.length === 0, near.map(d => d.toFixed(1)).join(', '));
  w.cmd({ t: 'order', units: ids, o: 'move', x: pts[0][0], y: pts[0][1] });
  w.cmd({ t: 'order', units: ids, o: 'move', x: pts[1][0], y: pts[1][1], queue: true });
  w.cmd({ t: 'order', units: ids, o: 'move', x: pts[2][0], y: pts[2][1] });
  check('waypoints: a plain order clears the queue', s.queue.length === 0);
}

// 4. Barracks training, library research
{
  const w = newWorld(14); const c = starterTown(w);
  c.stock.wood += 300; c.stock.stone += 100;
  const bar = build(w, 'barracks', c.cx, c.cy);
  const lib = build(w, 'library', c.cx, c.cy);
  run(w, 200);
  const sol0 = w.units.filter(u => !u.isZ && w.UD[u.k].soldier).length;
  w.cmd({ t: 'train', b: bar.id, k: 'sword', n: 3 });
  w.cmd({ t: 'train', b: bar.id, k: 'peasant', n: 2 });
  run(w, 1200);
  const sol1 = w.units.filter(u => !u.isZ && w.UD[u.k].soldier).length;
  check('military: barracks converts civilians + equipment into soldiers', sol1 === sol0 + 5, `${sol0} -> ${sol1}, swords left ${c.stock.swords}`);
  c.pri.research = 5;
  run(w, 4000);
  check('research: libraries produce research points', w.research.rp > 20, `${w.research.rp.toFixed(1)} RP`);
  w.research.rp += 100;
  const r = w.cmd({ t: 'research', id: 'stoneWalls' });
  check('research: tech can be unlocked', r.ok && w.has('stoneWalls'));
}

// 5. Waves: undefended region is destroyed; save/load mid-wave is deterministic
{
  const w = newWorld(15); const c = starterTown(w);
  for (const u of w.units) if (!u.isZ && u.k !== 'civ') u.dead = true;
  let saved = null, det = null;
  while (w.status.state === 'playing' && w.day() < 7) {
    run(w, 200);
    // isolate the wave: clear roaming packs/raids so only the wave attacks
    if (!w.waves.list.some(v => v.spawned)) for (const u of w.units) if (u.isZ && !u.dormant) u.dead = true;
    if (!saved && w.waves.list.some(v => v.spawned)) {
      run(w, 600);
      saved = serialize(w);
      const w2 = deserialize(loadDefs(), saved, w.map);
      run(w, 600); run(w2, 600);
      det = [stateHash(w), stateHash(w2)];
    }
  }
  check('waves: a wave is announced and spawned', !!saved);
  check('waves: an undefended capital falls to a wave', w.status.state === 'lost', `${w.status.state} on day ${w.day()}: ${w.status.reason}`);
  check('saves: export/import mid-wave resumes the identical state', det && det[0] === det[1], det ? det.join(' vs ') : 'no save');
}

// 6. Nests can be destroyed; destroying all wins
{
  const w = newWorld(16);
  const ns = w.buildings.filter(b => b.type === 'nest');
  const sq = [];
  for (const n of ns) {
    for (let i = 0; i < 60; i++) {
      const u = w.spawn('cav', n.x - 8 + (i % 10), n.y - 10 + ((i / 10) | 0), { city: w.cities[0].id });
      sq.push(u);
    }
  }
  const { newSquad, addToSquad } = await import('../src/sim/military.js');
  ns.forEach((n, k) => {
    const s = newSquad(w, w.cities[0].id, 'Strike ' + k);
    for (const u of sq.slice(k * 60, k * 60 + 60)) addToSquad(w, u, s);
    w.cmd({ t: 'order', squads: [s.id], o: 'attack', b: n.id });
  });
  let t = 0;
  while (w.status.state === 'playing' && t < 6000) { run(w, 100); t += 100; }
  check('nests: destroying all nests wins the run', w.status.state === 'won', `${w.status.state} after ${(t * w.DT).toFixed(0)} s`);
}

// 7. Performance: 4,000 units
{
  const w = newWorld(17); const c = starterTown(w);
  c.stock.food = 1e6;
  for (let i = 0; i < 300; i++) w.spawn(['sword', 'archer', 'spear'][i % 3], c.cx - 15 + (i % 20), c.cy - 20 + ((i / 20) | 0), { city: c.id });
  for (let i = 0; i < 4000 && w.units.length < 4100; i++) { const x = c.cx + 50 + (i % 60), y = c.cy - 30 + ((i / 60) | 0); if (w.tSpeed[w.tileOf(x, y)] > 0) w.spawn('zombie', x + 0.5, y + 0.5, { zg: { t: 'city', c: c.id } }); }
  run(w, 50);
  const t0 = performance.now(); run(w, 400); const ms = (performance.now() - t0) / 400;
  check('perf: 4,000 units simulate fast enough for 4x (40 ticks/s)', ms < 12, `${ms.toFixed(2)} ms/tick with ${w.units.length} units`);
}

console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
