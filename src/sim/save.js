// Save/load: full world state + RNG state + version. Derived structures are rebuilt on load.
import { World, STATE_KEYS } from './world.js';
import { RNG } from './rng.js';
import { updateVision } from './vision.js';

const strip = (k, v) => (k && k[0] === '_') ? undefined : v;

function rle(arr) {
  const out = [];
  let cur = arr[0], n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === cur) n++;
    else { out.push(n); cur = arr[i]; n = 1; }
  }
  out.push(n);
  return { first: arr[0], runs: out };
}
function unrle(o, arr) {
  let v = o.first, i = 0;
  for (const n of o.runs) { arr.fill(v, i, i + n); i += n; v = v ? 0 : 1; }
}

export function serialize(w) {
  w.rngState = w.rng.s;
  const roadDiff = [];
  for (let t = 0; t < w.N; t++) if (w.road[t] !== w.map.road[t]) roadDiff.push(t, w.road[t]);
  w.roadDiff = roadDiff;
  w.exploredRLE = rle(w.explored);
  const data = { version: w.B.saveVersion, game: 'squares-of-the-dead', map: w.map.def.name };
  for (const k of STATE_KEYS) data[k] = w[k];
  const json = JSON.stringify(data, strip);
  delete w.roadDiff; delete w.exploredRLE;
  return json;
}

export function deserialize(defs, json, map) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.game !== 'squares-of-the-dead') throw new Error('Not a Squares of the Dead save file');
  if (data.version !== defs.balance.saveVersion) throw new Error(`Save version ${data.version} is not supported (expected ${defs.balance.saveVersion})`);
  const w = new World(defs, map);
  for (const k of STATE_KEYS) w[k] = data[k];
  w.rng = new RNG(data.rngState);
  w.road.set(w.map.road);
  for (let i = 0; i < data.roadDiff.length; i += 2) w.road[data.roadDiff[i]] = data.roadDiff[i + 1];
  unrle(data.exploredRLE, w.explored);
  delete w.roadDiff; delete w.exploredRLE; delete w.rngState;
  w.rebuildDerived();
  updateVisionNoExplore(w);
  return w;
}

// Recompute `visible` for rendering without touching explored (already restored).
function updateVisionNoExplore(w) {
  const keep = w.explored.slice();
  updateVision(w);
  w.explored.set(keep);
}

// Compact state hash for determinism tests.
export function stateHash(w) {
  let h = 2166136261 >>> 0;
  const mix = v => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
  mix(w.tick); mix(w.units.length); mix(w.buildings.length);
  for (const u of w.units) { mix(u.id); mix(Math.round(u.x * 1000)); mix(Math.round(u.y * 1000)); mix(Math.round(u.hp * 100)); }
  for (const b of w.buildings) { mix(b.id); mix(Math.round(b.hp * 100)); }
  for (const c of w.cities) for (const k in c.stock) mix(Math.round(c.stock[k] * 100));
  mix(w.rng.s);
  return h.toString(16);
}
