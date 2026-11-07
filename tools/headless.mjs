// Headless simulation runner for tests: node tools/headless.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { World } from '../src/sim/world.js';
export function loadDefs() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const r = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return { balance: r('balance.json'), units: r('units.json'), buildings: r('buildings.json'), research: r('research.json'), map: r('map.json') };
}
export function newWorld(seed = 1) { const w = new World(loadDefs()); w.newGame(seed); return w; }
