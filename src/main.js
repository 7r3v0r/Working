// Bootstrap + fixed-timestep loop (sim at 10 ticks/s per 1x, render at display rate with interpolation).
import { World } from './sim/world.js';
import { serialize, deserialize } from './sim/save.js';
import { Renderer, Minimap } from './render/renderer.js';
import { UI } from './ui/ui.js';
import * as Store from './ui/storage.js';
import { THEMES, savedTheme, applyTheme } from './render/themes.js';

const AUTOSAVE_TICKS = 1200; // every 2 in-game minutes

async function loadDefs() {
  const get = n => fetch(`data/${n}.json`).then(r => { if (!r.ok) throw new Error(`data/${n}.json: ${r.status}`); return r.json(); });
  const [balance, units, buildings, research, map] = await Promise.all(['balance', 'units', 'buildings', 'research', 'map'].map(get));
  return { balance, units, buildings, research, map };
}

const game = {
  world: null, defs: null, map: null, speed: 1, paused: false, fps: 0,
  setSpeed(s) { this.speed = s; this.paused = false; },
  togglePause() { this.paused = !this.paused; },
  setWorld(w) {
    this.world = w; this.map = w.map;
    this.renderer.setWorld(w);
    this.renderer.resize(); this.renderer.clampCam();
    this.autoTick = w.tick;
    if (this.ui) this.ui.reset();
    this.minimap && this.minimap.draw(true);
    window.world = w; // handy for debugging from the console
  },
  newGame(seed) {
    const w = new World(this.defs, this.map);
    w.newGame(seed ?? ((Date.now() % 1e9) | 0));
    this.setWorld(w);
  },
  saveMeta(auto) {
    const w = this.world, cap = w.cityMap.get(w.capital);
    return { id: auto ? 'auto' : 'm' + Date.now(), auto, name: auto ? 'Autosave' : `${cap ? cap.name : 'Game'} · day ${w.day()}`, day: w.day(), cities: w.cities.length };
  },
  // Manual save: browser slot plus a downloaded copy in case browser storage is cleared.
  async save() {
    const json = serialize(this.world);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `squares-of-the-dead-day${this.world.day()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    try { await Store.putSave(this.saveMeta(false), json); this.ui.flash('Saved in the browser and downloaded a copy'); }
    catch (e) { this.ui.flash(`Browser save failed (${e.message}); the downloaded file is your save`); }
  },
  async autosave() {
    const w = this.world;
    if (!w || w.status.state !== 'playing' || this.saving) return;
    this.autoTick = w.tick;
    this.saving = true;
    try { await Store.putSave(this.saveMeta(true), serialize(w)); } catch (e) { console.warn('Autosave failed', e); }
    this.saving = false;
  },
  // Visual style: recolors the data definitions, the ground canvas and the UI (see render/themes.js).
  setStyle(id) {
    this.style = id;
    this.renderer.setTheme(applyTheme(this.defs, id));
    document.getElementById('style-btn').textContent = `Style: ${THEMES[id].name}`;
    if (this.minimap) this.minimap.draw(true);
  },
  cycleStyle() { const ids = Object.keys(THEMES); this.setStyle(ids[(ids.indexOf(this.style) + 1) % ids.length]); },
  load(json) {
    const w = deserialize(this.defs, json, this.map);
    this.setWorld(w);
    this.paused = true;
    this.ui.flash(`Loaded day ${w.day()} — paused`);
  },
  async loadSlot(id) { this.load(await Store.getSave(id)); },
};

async function main() {
  const loading = document.getElementById('loading');
  try {
    game.defs = await loadDefs();
  } catch (e) {
    loading.textContent = `Could not load data files (${e.message}). Serve this folder over HTTP, e.g. "npx serve".`;
    return;
  }
  await new Promise(r => setTimeout(r, 30));
  game.renderer = new Renderer(document.getElementById('view'));
  game.setStyle(savedTheme());
  document.getElementById('style-btn').onclick = () => game.cycleStyle();
  const params = new URLSearchParams(location.search);
  const seed = params.has('seed') ? +params.get('seed') : undefined;
  const w = new World(game.defs);
  w.newGame(seed ?? ((Date.now() % 1e9) | 0));
  game.minimap = new Minimap(document.getElementById('minimap'), game.renderer);
  game.setWorld(w);
  game.ui = new UI(game);
  game.minimap.resize();
  loading.hidden = true;
  game.ui.renderBuildBar(true);
  if (!params.has('nohelp')) game.ui.showHelp();
  window.game = game;

  const onResize = () => { document.documentElement.style.setProperty('--tb-h', document.getElementById('topbar').offsetHeight + 'px'); game.renderer.resize(); game.renderer.clampCam(); game.minimap.resize(); game.minimap.draw(true); };
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(document.getElementById('topbar'));
  const bb = document.getElementById('buildbar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--bb-h', bb.offsetHeight + 'px')).observe(bb);
  onResize();

  const STEP = game.defs.balance.dt;
  let last = performance.now(), acc = 0, frames = 0, fpsT = last;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const w = game.world;
    if (!game.paused && w.status.state === 'playing') {
      acc += dt * game.speed;
      let n = 0;
      while (acc >= STEP && n < 16) { w.step(); acc -= STEP; n++; }
      if (n >= 16) acc = 0;
    }
    if (w.tick - game.autoTick >= AUTOSAVE_TICKS) game.autosave();
    const alpha = game.paused ? 1 : Math.min(1, acc / STEP);
    game.ui.update(dt);
    game.renderer.render(alpha, game.ui.view);
    game.minimap.draw();
    frames++;
    if (now - fpsT > 1000) { game.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; game.ui.updateStatus(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && game.world.tick > game.autoTick) game.autosave(); });
}
main();
