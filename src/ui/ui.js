// DOM UI + input handling. Reads the world, issues commands through world.cmd().
import { canPlace, canRoad, costText, lists, CATS, cityOfRegion } from '../sim/civ.js';
import { canFound } from '../sim/logistics.js';
import { squadETA, trainTime } from '../sim/military.js';
import { regionThreat } from '../sim/zombies.js';
import { TER_NAMES, DEP_NAMES } from '../sim/map.js';
import { play, unlockAudio } from './audio.js';

const $ = id => document.getElementById(id);
const fmt = v => Math.floor(v + 1e-6).toLocaleString();
const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ROADS = { road: { name: 'Dirt road', label: '', cat: 'road', color: '#9C8A68', line: true }, sroad: { name: 'Stone road', label: '', cat: 'road', color: '#B8B2A6', line: true, research: 'stoneRoads' } };
const MENU_ORDER = ['Housing', 'Food', 'Materials', 'Storage', 'Industry', 'Weapons', 'Military', 'Defense', 'Roads'];
const TRAINABLE = ['peasant', 'sword', 'spear', 'archer', 'cav', 'scout'];

// 4-connected line so walls never leave diagonal gaps.
export function lineTiles(x0, y0, x1, y1) {
  const pts = [[x0, y0]];
  const nx = Math.abs(x1 - x0), ny = Math.abs(y1 - y0), sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let x = x0, y = y0, ix = 0, iy = 0;
  while (ix < nx || iy < ny) {
    if ((0.5 + ix) / nx < (0.5 + iy) / ny) { x += sx; ix++; } else { y += sy; iy++; }
    pts.push([x, y]);
  }
  return pts;
}

export class UI {
  constructor(game) {
    this.g = game;
    this.r = game.renderer;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, in: false, down: false, bx: 0, by: 0, mid: false };
    this.alerts = [];
    this.timers = { top: 0, side: 0, sel: 0, alerts: 0 };
    this.panel = null;
    this.lastHtml = {};
    this.reset();
    this.bind();
  }
  get w() { return this.g.world; }
  // view state read by the renderer
  get view() { return { sel: this.sel, ghost: this.ghost, box: this.box }; }

  reset() {
    this.sel = { squads: new Set(), building: 0 };
    this.mode = null; this.ghost = null; this.box = null;
    this.city = this.w.capital && this.w.cityMap.get(this.w.capital) ? this.w.capital : (this.w.cities[0] ? this.w.cities[0].id : 0);
    this.alerts = [];
    this.lastHtml = {};
    this.w.events.length = 0;
    this.gameOverShown = false;
  }
  curCity() {
    let c = this.w.cityMap.get(this.city);
    if (!c && this.w.cities.length) { c = this.w.cities[0]; this.city = c.id; }
    return c;
  }

  // ---------------- input ----------------
  bind() {
    const cv = this.r.cv;
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    cv.addEventListener('mousemove', e => this.onMove(e));
    cv.addEventListener('mouseenter', () => { this.mouse.in = true; });
    cv.addEventListener('mouseleave', () => { this.mouse.in = false; this.ghost = null; });
    cv.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mouseup', e => this.onUp(e));
    cv.addEventListener('contextmenu', e => { e.preventDefault(); this.onRight(e); });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.r.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    const mm = $('minimap');
    const mmGo = e => { const rc = mm.getBoundingClientRect(); const [x, y] = this.g.minimap.toWorld(e.clientX - rc.left, e.clientY - rc.top); this.r.cam.x = x; this.r.cam.y = y; this.r.clampCam(); };
    mm.addEventListener('mousedown', e => { if (e.button === 0) { this.mmDrag = true; mmGo(e); } else if (e.button === 2 && this.sel.squads.size) { const rc = mm.getBoundingClientRect(); const [x, y] = this.g.minimap.toWorld(e.clientX - rc.left, e.clientY - rc.top); this.order('move', x, y); } });
    mm.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => { if (this.mmDrag) mmGo(e); });
    window.addEventListener('mouseup', () => { this.mmDrag = false; });
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('input', e => this.onInput(e));
    document.addEventListener('pointerdown', () => unlockAudio(), { once: false });
    $('save-btn').onclick = () => this.g.save();
    $('load-btn').onclick = () => $('load-file').click();
    $('load-file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(txt => { try { this.g.load(txt); this.closeOverlay(); } catch (err) { this.dialog(`<h1>Load failed</h1><p>${esc(err.message)}</p><div class="actions"><button data-act="close-ov">OK</button></div>`); } });
      e.target.value = '';
    };
    $('city-btn').onclick = () => this.cycleCity();
  }

  onKey(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const pan = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!down) { this.keys.delete(k); return; }
    if (e.ctrlKey || e.metaKey) return;
    if (k === 'a' && this.sel.squads.size) { this.setMode({ k: 'amove' }); return; }
    if (pan.includes(k)) { this.keys.add(k); if (k.startsWith('Arrow')) e.preventDefault(); return; }
    switch (k) {
      case ' ': e.preventDefault(); this.g.togglePause(); break;
      case '1': this.g.setSpeed(1); break;
      case '2': this.g.setSpeed(2); break;
      case '3': this.g.setSpeed(4); break;
      case 'b': this.togglePanel('build'); break;
      case 'c': this.togglePanel('city'); break;
      case 'l': this.togglePanel('logistics'); break;
      case 'r': this.togglePanel('research'); break;
      case 'F1': case '?': e.preventDefault(); this.togglePanel('help'); break;
      case 't': this.toggleOverlay('threat'); break;
      case 'y': this.toggleOverlay('borders'); break;
      case 'v': this.toggleOverlay('vision'); break;
      case 'Tab': e.preventDefault(); this.cycleCity(); break;
      case 'h': if (this.sel.squads.size) this.order('hold'); break;
      case 'g': if (this.sel.squads.size) this.setMode({ k: 'garrison' }); break;
      case 'p': if (this.sel.squads.size) this.setMode({ k: 'patrol' }); break;
      case 'Escape':
        if (this.mode) this.setMode(null);
        else if (this.sel.squads.size || this.sel.building) { this.sel.squads.clear(); this.sel.building = 0; }
        else if (this.panel) this.togglePanel(this.panel);
        break;
      case 'Delete': case 'Backspace': this.demolish(); break;
    }
  }

  tileAt(sx, sy) { const [x, y] = this.r.toWorld(sx, sy); return [Math.floor(x), Math.floor(y), x, y]; }

  onMove(e) {
    this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; this.mouse.in = true;
    if (this.mouse.mid) {
      this.r.cam.x -= e.movementX / this.r.cam.s; this.r.cam.y -= e.movementY / this.r.cam.s; this.r.clampCam();
    }
    if (this.mouse.down && !this.mode) {
      if (Math.hypot(e.offsetX - this.mouse.bx, e.offsetY - this.mouse.by) > 5) this.box = { x0: this.mouse.bx, y0: this.mouse.by, x1: e.offsetX, y1: e.offsetY };
    }
    this.updateStatus();
  }
  onDown(e) {
    unlockAudio();
    if (e.button === 1) { this.mouse.mid = true; e.preventDefault(); return; }
    if (e.button !== 0) return;
    const [tx, ty, wx, wy] = this.tileAt(e.offsetX, e.offsetY);
    const m = this.mode;
    if (m) {
      if (m.k === 'build') { this.placeBuilding(e.shiftKey); return; }
      if (m.k === 'line') { m.start = [tx, ty]; return; }
      if (m.k === 'found') { this.found(); return; }
      if (m.k === 'amove') { this.order('amove', wx, wy); if (!e.shiftKey) this.setMode(null); return; }
      if (m.k === 'patrol') { this.order('patrol', wx, wy); this.setMode(null); return; }
      if (m.k === 'garrison') {
        const b = this.buildingAt(tx, ty);
        if (b && this.w.BD[b.type].garrison) { this.order('garrison', wx, wy, b.id); this.setMode(null); }
        else this.flash('Click a finished tower to garrison archers');
        return;
      }
    }
    this.mouse.down = true; this.mouse.bx = e.offsetX; this.mouse.by = e.offsetY;
  }
  onUp(e) {
    if (e.button === 1) { this.mouse.mid = false; return; }
    if (e.button !== 0) return;
    const m = this.mode;
    if (m && m.k === 'line' && m.start) {
      const [tx, ty] = this.tileAt(this.mouse.x, this.mouse.y);
      const pts = lineTiles(m.start[0], m.start[1], tx, ty);
      const r = this.w.cmd({ t: 'line', type: m.type, pts, city: this.city });
      if (!r.ok) this.flash(r.reason || 'Cannot build there');
      else if (r.placed < pts.length && r.reason) this.flash(`Placed ${r.placed}/${pts.length}: ${r.reason}`);
      m.start = null;
      if (!e.shiftKey && !this.keys.has('Shift')) { /* stay in line mode for chaining */ }
      return;
    }
    if (!this.mouse.down) return;
    this.mouse.down = false;
    if (this.box) { this.boxSelect(this.box, e.shiftKey); this.box = null; return; }
    if (e.target !== this.r.cv) return;
    this.clickSelect(e.offsetX, e.offsetY, e.shiftKey);
  }
  onRight(e) {
    if (this.mode) { this.setMode(null); return; }
    if (!this.sel.squads.size) return;
    const [tx, ty, wx, wy] = this.tileAt(e.offsetX, e.offsetY);
    const b = this.buildingAt(tx, ty);
    if (b && (b.infected || this.w.BD[b.type].zombie)) this.order('attack', wx, wy, b.id);
    else if (b && this.w.BD[b.type].garrison && b.done) this.order('garrison', wx, wy, b.id);
    else this.order(e.shiftKey ? 'amove' : 'move', wx, wy);
  }

  buildingAt(tx, ty) {
    if (!this.w.inMap(tx, ty)) return null;
    const id = this.w.bAt[ty * this.w.W + tx];
    const b = id ? this.w.bMap.get(id) : null;
    if (b && !this.w.explored[ty * this.w.W + tx]) return null;
    return b;
  }
  clickSelect(sx, sy, add) {
    const [tx, ty, wx, wy] = this.tileAt(sx, sy);
    const w = this.w;
    let best = null, bd = Math.max(1.2, 6 / this.r.cam.s) ** 2;
    for (const u of w.units) {
      if (u.dead || u.inside || u.isZ || !u.squad) continue;
      const d = (u.x - wx) ** 2 + (u.y - wy) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    if (best) {
      if (!add) { this.sel.squads.clear(); this.sel.building = 0; }
      if (add && this.sel.squads.has(best.squad)) this.sel.squads.delete(best.squad); else this.sel.squads.add(best.squad);
      return;
    }
    const b = this.buildingAt(tx, ty);
    this.sel.squads.clear();
    this.sel.building = b ? b.id : 0;
    if (b && b.city) {
      this.city = b.city;
      if (b.type === 'townhall' && this.panel !== 'city') this.togglePanel('city');
    }
  }
  boxSelect(box, add) {
    const [x0, y0] = this.r.toWorld(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
    const [x1, y1] = this.r.toWorld(Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
    if (!add) this.sel.squads.clear();
    this.sel.building = 0;
    for (const u of this.w.units) {
      if (u.dead || u.isZ || !u.squad) continue;
      const ux = u.inside ? (this.w.bMap.get(u.inside) || u).x : u.x, uy = u.inside ? (this.w.bMap.get(u.inside) || u).y : u.y;
      if (ux >= x0 && ux <= x1 && uy >= y0 && uy <= y1) this.sel.squads.add(u.squad);
    }
  }
  order(o, x, y, b) {
    const r = this.w.cmd({ t: 'order', squads: [...this.sel.squads], o, x, y, b });
    if (!r.ok && r.reason) this.flash(r.reason);
  }

  setMode(m) {
    this.mode = m;
    this.ghost = null;
    this.r.cv.style.cursor = m ? 'crosshair' : 'default';
    this.updateModeHint();
  }
  updateModeHint() {
    const el = $('mode-hint'), m = this.mode;
    if (!m) { el.hidden = true; return; }
    let t = '';
    const name = m.type ? (this.w.BD[m.type] || ROADS[m.type]).name : '';
    if (m.k === 'build') t = `Placing ${name} — click to place (Shift keeps placing), right-click/Esc to cancel`;
    if (m.k === 'line') t = `Drawing ${name} — drag to draw a line, right-click/Esc to finish`;
    if (m.k === 'found') t = 'Found settlement — click a spot in an explored, unsettled region';
    if (m.k === 'amove') t = 'Attack-move — click a destination';
    if (m.k === 'patrol') t = 'Patrol — click the far end of the route';
    if (m.k === 'garrison') t = 'Garrison — click a tower (archers go inside)';
    if (this.ghost && this.ghost.reason) t += ` · <span class="warn">${esc(this.ghost.reason)}</span>`;
    el.innerHTML = t; el.hidden = false;
  }
  flash(msg) { this.pushAlert({ kind: 'alert', msg }); }

  placeBuilding(keep) {
    const m = this.mode;
    if (m.x === undefined) return;
    const r = this.w.cmd({ t: 'build', type: m.type, x: m.x, y: m.y });
    if (!r.ok) { this.flash(r.reason); return; }
    if (!keep) this.setMode(null);
  }
  found() {
    const m = this.mode;
    if (m.x === undefined) return;
    const r = this.w.cmd({ t: 'found', from: this.city, x: m.x, y: m.y });
    if (!r.ok) { this.flash(r.reason); return; }
    this.setMode(null);
  }
  demolish() {
    const b = this.w.bMap.get(this.sel.building);
    if (!b || !b.city) return;
    if (b.type === 'townhall' && !confirm('Demolish the town hall?')) return;
    this.w.cmd({ t: 'demolish', b: b.id });
    this.sel.building = 0;
  }

  updateGhost() {
    const m = this.mode, w = this.w;
    if (!m || !this.mouse.in || !['build', 'line', 'found'].includes(m.k)) { this.ghost = null; return; }
    const [wx, wy] = this.r.toWorld(this.mouse.x, this.mouse.y);
    const c = this.curCity();
    if (m.k === 'build' || m.k === 'found') {
      const d = m.k === 'found' ? w.BD.townhall : w.BD[m.type];
      const x = Math.floor(wx - d.w / 2 + 0.5), y = Math.floor(wy - d.h / 2 + 0.5);
      const r = m.k === 'found' ? canFound(w, this.city, x, y) : canPlace(w, m.type, x, y);
      m.x = x; m.y = y;
      let radius = null;
      if (m.k === 'build') {
        const pc = cityOfRegion(w, w.regionAt(x + d.w / 2, y + d.h / 2)) || c;
        if (pc) radius = [pc.cx, pc.cy, d.defense ? w.B.city.defenseRadius : w.B.city.buildRadius];
      }
      this.ghost = { tiles: [[x, y, r.ok, d.w, d.h]], reason: r.ok ? '' : r.reason, radius };
    } else {
      const [tx, ty] = [Math.floor(wx), Math.floor(wy)];
      const pts = m.start ? lineTiles(m.start[0], m.start[1], tx, ty) : [[tx, ty]];
      const tiles = [];
      let reason = '';
      for (const [x, y] of pts) {
        if (!w.inMap(x, y)) continue;
        const r = ROADS[m.type] ? canRoad(w, y * w.W + x, m.type, c) : canPlace(w, m.type, x, y);
        tiles.push([x, y, r.ok]);
        if (!r.ok) reason = r.reason;
      }
      const d = w.BD[m.type];
      const cost = ROADS[m.type] ? (m.type === 'sroad' ? w.B.roads.stone.cost : w.B.roads.dirt.cost) : d.cost;
      const n = tiles.filter(t => t[2]).length;
      const tot = {}; for (const k in cost) tot[k] = cost[k] * n;
      this.ghost = { tiles, reason: (m.start ? `${n} tiles · ${costText(tot)}` : '') + (reason ? ` · ${reason}` : '') };
    }
  }

  onClick(e) {
    const t = e.target.closest('[data-act],[data-panel],[data-overlay],[data-speed]');
    if (!t) return;
    if (t.dataset.panel) { this.togglePanel(t.dataset.panel); return; }
    if (t.dataset.overlay) { this.toggleOverlay(t.dataset.overlay); return; }
    if (t.dataset.speed !== undefined) { const s = +t.dataset.speed; if (s === 0) this.g.togglePause(); else this.g.setSpeed(s); return; }
    const a = t.dataset.act, w = this.w, ds = t.dataset;
    const b = w.bMap.get(this.sel.building);
    const res = r => { if (r && !r.ok && r.reason) this.flash(r.reason); this.lastHtml = {}; };
    switch (a) {
      case 'place': {
        const type = ds.type;
        const line = ROADS[type] || w.BD[type].line;
        this.setMode(line ? { k: 'line', type, start: null } : { k: 'build', type });
        break;
      }
      case 'found': this.setMode({ k: 'found' }); break;
      case 'research': res(w.cmd({ t: 'research', id: ds.id })); break;
      case 'train': if (b) res(w.cmd({ t: 'train', b: b.id, k: ds.k, n: +ds.n })); break;
      case 'qcancel': if (b) res(w.cmd({ t: 'cancelTrain', b: b.id, i: +ds.i })); break;
      case 'cart': if (b) res(w.cmd({ t: 'buildCart', b: b.id, n: +ds.n || 1 })); break;
      case 'demolish': this.demolish(); break;
      case 'deselect': this.sel.squads.clear(); this.sel.building = 0; break;
      case 'sq-hold': this.order('hold'); break;
      case 'sq-amove': this.setMode({ k: 'amove' }); break;
      case 'sq-patrol': this.setMode({ k: 'patrol' }); break;
      case 'sq-garrison': this.setMode({ k: 'garrison' }); break;
      case 'sq-split': { const r = w.cmd({ t: 'split', squad: [...this.sel.squads][0] }); if (r.ok) this.sel.squads.add(r.squad); res(r); break; }
      case 'sq-merge': { const r = w.cmd({ t: 'merge', squads: [...this.sel.squads] }); if (r.ok) { this.sel.squads = new Set([r.squad]); } res(r); break; }
      case 'sq-only': this.sel.squads = new Set([+ds.id]); break;
      case 'goto': this.r.cam.x = +ds.x; this.r.cam.y = +ds.y; this.r.clampCam(); break;
      case 'route-add': {
        const g = id => $(id) && $(id).value;
        res(w.cmd({ t: 'route', res: g('rt-res'), from: +g('rt-from'), to: +g('rt-to'), min: +g('rt-min'), max: +g('rt-max'), carts: +g('rt-carts') }));
        break;
      }
      case 'route-del': res(w.cmd({ t: 'delRoute', id: +ds.id })); break;
      case 'route-carts': { const r = w.routes.find(r => r.id === +ds.id); if (r) { r.carts = Math.max(0, r.carts + +ds.d); this.lastHtml = {}; } break; }
      case 'pick-city': this.city = +ds.id; this.lastHtml = {}; break;
      case 'close': this.togglePanel(this.panel); break;
      case 'close-ov': this.closeOverlay(); break;
      case 'newgame': this.closeOverlay(); this.g.newGame(); break;
      case 'load': $('load-file').click(); break;
    }
  }
  onInput(e) {
    const t = e.target;
    if (t.dataset.act === 'pri') this.w.cmd({ t: 'priority', city: this.city, cat: t.dataset.cat, val: +t.value });
  }

  togglePanel(p) {
    this.panel = this.panel === p ? null : p;
    document.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === this.panel));
    this.lastHtml.side = null;
    if (p === 'help' && this.panel === 'help') { this.panel = null; this.showHelp(); return; }
    this.renderSide(true);
  }
  toggleOverlay(k) {
    this.r.overlays[k] = !this.r.overlays[k];
    if (k === 'vision') this.r.forceFog = true;
    document.querySelectorAll('[data-overlay]').forEach(b => b.classList.toggle('on', !!this.r.overlays[b.dataset.overlay]));
  }
  cycleCity() {
    const cs = this.w.cities;
    if (!cs.length) return;
    const i = cs.findIndex(c => c.id === this.city);
    const c = cs[(i + 1) % cs.length];
    this.city = c.id;
    this.r.cam.x = c.cx; this.r.cam.y = c.cy; this.r.clampCam();
    this.sel.squads.clear(); this.sel.building = c.hall || 0;
    this.lastHtml = {};
  }

  dialog(html) { const o = $('overlay'); o.innerHTML = `<div class="dialog">${html}</div>`; o.hidden = false; }
  closeOverlay() { $('overlay').hidden = true; }
  showHelp() {
    const UD = this.w.UD;
    const sw = c => `<i class="sw" style="background:${c}"></i>`;
    this.dialog(`<h1>Squares of the Dead</h1>
<p>Grow a medieval economy, arm it, and ship soldiers and goods to wherever the next wave lands. <b>Destroy all four zombie nests to win.</b> Lose your capital's town hall and the run is over.</p>
<div class="legend">${['civ', 'peasant', 'sword', 'spear', 'archer', 'cav', 'scout', 'zombie', 'cart'].map(k => `<span class="chip">${sw(UD[k].color)} ${UD[k].name}</span>`).join('')}</div>
<p class="muted">Every person is one square. Waves arrive at night and are announced at least a day ahead. Anyone killed by a zombie rises again; a zombie that breaks into an occupied building turns everyone inside.</p>
<div class="keys">
<kbd>WASD</kbd><span>Pan (or edge-scroll, middle-drag, minimap)</span>
<kbd>Wheel</kbd><span>Zoom</span>
<kbd>Left click / drag</kbd><span>Select squad / building · box-select squads</span>
<kbd>Right click</kbd><span>Move (on a nest/infected building: attack; on a tower: garrison)</span>
<kbd>A</kbd><span>Attack-move (with squads selected)</span>
<kbd>H</kbd> <span>Hold position</span>
<kbd>G</kbd><span>Garrison archers into a tower</span>
<kbd>P</kbd><span>Patrol</span>
<kbd>Space</kbd><span>Pause (orders still work)</span>
<kbd>1 2 3</kbd><span>Speed 1x / 2x / 4x</span>
<kbd>B C L R</kbd><span>Build · City · Logistics · Research panels</span>
<kbd>Tab</kbd><span>Cycle cities</span>
<kbd>T Y V</kbd><span>Threat heatmap · region borders · vision overlays</span>
<kbd>Del</kbd><span>Demolish selected building</span>
<kbd>Esc</kbd><span>Cancel / deselect</span>
</div>
<p class="muted">Tips: build farms and houses first; set job priorities in the City panel; found settlements (City panel) to reach stone, ore and coal; link cities with roads and cart routes; research stone walls before the waves grow.</p>
<div class="actions"><button data-act="close-ov">Play</button><button data-act="newgame">New game</button><button data-act="load">Load save…</button></div>`);
  }

  pushAlert(e) {
    this.alerts.unshift({ ...e, t: performance.now() });
    if (this.alerts.length > 7) this.alerts.length = 7;
    this.timers.alerts = 0;
  }

  // ---------------- per-frame ----------------
  update(dt) {
    const r = this.r, cam = r.cam;
    const sp = 700 / cam.s * dt;
    if (this.keys.has('w') || this.keys.has('ArrowUp')) cam.y -= sp;
    if (this.keys.has('s') || this.keys.has('ArrowDown')) cam.y += sp;
    if (this.keys.has('a') || this.keys.has('ArrowLeft')) cam.x -= sp;
    if (this.keys.has('d') || this.keys.has('ArrowRight')) cam.x += sp;
    if (this.mouse.in && !this.mouse.down && document.hasFocus()) {
      const m = 6, x = this.mouse.x, y = this.mouse.y;
      if (x < m) cam.x -= sp; else if (x > r.vw - m) cam.x += sp;
      if (y < m) cam.y -= sp; else if (y > r.vh - m) cam.y += sp;
    }
    r.clampCam();
    // events -> alerts + audio
    const w = this.w;
    for (const e of w.events) {
      this.pushAlert(e);
      play(e.kind === 'infect' || e.kind === 'raid' ? 'attack' : e.kind === 'nest' ? 'research' : e.kind);
    }
    w.events.length = 0;
    this.updateGhost();
    const now = performance.now();
    if (now - this.timers.top > 200) { this.timers.top = now; this.renderTop(); this.renderBanner(); this.updateModeHint(); }
    if (now - this.timers.side > 400) { this.timers.side = now; this.renderSide(); }
    if (now - this.timers.sel > 250) { this.timers.sel = now; this.renderSel(); }
    if (now - this.timers.alerts > 1000) { this.timers.alerts = now; this.renderAlerts(); }
    if (w.status.state !== 'playing' && !this.gameOverShown) {
      this.gameOverShown = true;
      const won = w.status.state === 'won';
      this.dialog(`<h1>${won ? 'Victory' : 'Defeat'}</h1><p>${esc(w.status.reason)}</p><p class="muted">Day ${w.day()} · ${w.stats.killed} zombies destroyed · ${w.stats.lost} people lost · ${w.stats.waves} waves faced</p><div class="actions"><button data-act="newgame">New game</button><button data-act="load">Load save…</button><button data-act="close-ov">Look around</button></div>`);
    }
  }

  updateStatus() {
    const w = this.w;
    const [tx, ty] = this.tileAt(this.mouse.x, this.mouse.y);
    if (!w.inMap(tx, ty)) { $('status').textContent = ''; return; }
    const t = ty * w.W + tx;
    if (!w.explored[t]) { $('status').textContent = `(${tx}, ${ty}) · unexplored`; return; }
    const parts = [`(${tx}, ${ty})`, w.map.def.regions[w.map.region[t]].name, TER_NAMES[w.map.terrain[t]]];
    if (w.map.deposit[t]) parts.push(`${DEP_NAMES[w.map.deposit[t]]} deposit`);
    if (w.road[t]) parts.push(w.road[t] === 2 ? 'stone road' : (w.map.terrain[t] === 5 ? 'bridge' : 'dirt road'));
    const b = this.buildingAt(tx, ty);
    if (b) parts.push(b.type === 'nest' ? (b.name || 'nest') : w.BD[b.type].name);
    $('status').textContent = parts.join(' · ') + (this.g.fps ? ` · ${this.g.fps} fps` : '');
  }

  renderTop() {
    const w = this.w, c = this.curCity();
    $('city-btn').textContent = c ? `${c.name}${c.id === w.capital ? ' ★' : ''} ▸` : 'No city';
    if (c) {
      const RC = w.B.resourceColors;
      $('stock').innerHTML = w.B.resources.map(k => `<span class="res${c.stock[k] < 1 ? ' zero' : ''}" title="${k}"><i style="background:${RC[k]}"></i>${fmt(c.stock[k])}</span>`).join('');
      const idle = w.units.filter(u => !u.dead && u.k === 'civ' && u.city === c.id && !u.job && !u.settler).length;
      $('pop').innerHTML = `👥 ${c.nCiv} <span class="muted">(${idle} idle)</span> · ⚔ ${c.nSol} · 🏠 ${c.housing}`;
      $('pop').title = 'Civilians (idle) · soldiers stationed · housing';
      const tr = c.trend;
      $('food-trend').innerHTML = c.starving ? '<span class="bad">STARVING</span>' : `food <span class="${tr < 0 ? 'neg' : 'pos'}">${tr >= 0 ? '+' : ''}${Math.round(tr)}/day</span>`;
    }
    $('rp').textContent = `📜 ${fmt(w.research.rp)} RP`;
    const tod = w.tod(), B = w.B;
    const hrs = tod < B.dayTime ? 6 + tod / B.dayTime * 14 : 20 + (tod - B.dayTime) / (B.dayLength - B.dayTime) * 10;
    const h = Math.floor(hrs) % 24, mi = Math.floor((hrs % 1) * 60);
    $('clock').innerHTML = `${w.isNight() ? '☾' : '☀'} Day ${w.day()} · ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    document.querySelectorAll('#speed button').forEach(b => {
      const s = +b.dataset.speed;
      b.classList.toggle('on', s === 0 ? this.g.paused : (!this.g.paused && this.g.speed === s));
    });
  }

  renderBanner() {
    const w = this.w, el = $('banner');
    const ws = w.waves.list.filter(v => v.announced && w.tick < v.arrive + 1200).sort((a, b) => a.arrive - b.arrive);
    if (!ws.length) { el.hidden = true; return; }
    const v = ws[0];
    const left = (v.arrive - w.tick) * w.DT;
    const where = v.cityName || '?';
    const status = left > 0 ? `arrives in ~${mmss(left)} (game time)` : 'is arriving now';
    el.innerHTML = `⚠ Wave ${v.n} → ${esc(where)} · ${v.size} zombies · ${status}<div class="sub">${v.spawned ? 'On the march — intercept it or reinforce the walls' : 'Gathering at the nests'}</div>`;
    el.hidden = false;
  }

  renderAlerts() {
    const now = performance.now();
    this.alerts = this.alerts.filter(a => now - a.t < 30000);
    const html = this.alerts.map(a => `<div class="alert ${a.kind}" ${a.x != null ? `data-act="goto" data-x="${a.x}" data-y="${a.y}"` : ''} style="opacity:${Math.max(0.35, 1 - (now - a.t) / 30000)}">${esc(a.msg)}</div>`).join('');
    if (html !== this.lastHtml.alerts) { $('alerts').innerHTML = html; this.lastHtml.alerts = html; }
  }

  setHtml(id, html) {
    const el = $(id);
    if (this.lastHtml[id] === html) return;
    if (el.contains(document.activeElement) && document.activeElement !== el && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    el.innerHTML = html;
    this.lastHtml[id] = html;
  }

  // ---------------- side panels ----------------
  renderSide(force) {
    const el = $('side');
    if (!this.panel) { el.hidden = true; return; }
    el.hidden = false;
    if (force) this.lastHtml.side = null;
    let html = '';
    if (this.panel === 'build') html = this.buildPanel();
    else if (this.panel === 'city') html = this.cityPanel();
    else if (this.panel === 'logistics') html = this.logisticsPanel();
    else if (this.panel === 'research') html = this.researchPanel();
    this.setHtml('side', html);
  }
  head(t) { return `<h2><span>${t}</span><button class="close" data-act="close">✕</button></h2>`; }

  buildPanel() {
    const w = this.w, c = this.curCity(), CC = w.defs.buildings.categoryColors;
    const groups = {};
    for (const [k, d] of Object.entries(w.BD)) { if (!d.menu) continue; (groups[d.menu] = groups[d.menu] || []).push([k, d]); }
    groups.Roads = Object.entries(ROADS);
    if (c && !c.hall) (groups.Housing = groups.Housing || []).unshift(['townhall', w.BD.townhall]);
    let html = this.head(`Build · ${c ? esc(c.name) : ''}`);
    html += `<p class="muted">Buildings go within ${w.B.city.buildRadius} tiles of a town centre (defenses ${w.B.city.defenseRadius}). Costs come from that city's stockpile.</p>`;
    for (const g of MENU_ORDER) {
      if (!groups[g]) continue;
      html += `<h3>${g}</h3><div class="grid">`;
      for (const [k, d] of groups[g]) {
        const locked = d.research && !w.has(d.research);
        const cost = ROADS[k] ? (k === 'sroad' ? w.B.roads.stone.cost : w.B.roads.dirt.cost) : d.cost;
        const afford = c && Object.entries(cost).every(([r, v]) => c.stock[r] >= v);
        const tip = [d.workers ? `${d.workers} workers` : '', d.out ? `→ ${Object.entries(d.out).map(([r, v]) => `${v} ${r}`).join(', ')}` : '', d.in ? `uses ${costText(d.in)}` : '', d.housing ? `+${d.housing} housing` : '', d.req ? `needs ${d.req.terrain ? d.req.terrain.join('/') : d.req.deposit.join('/') + ' deposit'}` : ''].filter(Boolean).join(' · ');
        html += `<button class="bbtn" data-act="place" data-type="${k}" ${locked ? 'disabled' : ''} title="${esc(tip)}"><span class="nm"><i class="sw" style="background:${d.color || CC[d.cat] || '#999'}"></i>${d.name}</span><span class="ct ${afford ? '' : 'warn'}">${locked ? '🔒 research' : costText(cost) + (ROADS[k] || d.line ? ' /tile' : '')}</span></button>`;
      }
      html += '</div>';
    }
    return html;
  }

  cityPanel() {
    const w = this.w, c = this.curCity();
    if (!c) return this.head('City') + '<p>No city.</p>';
    const L = lists(w, c), RC = w.B.resourceColors;
    let html = this.head(`${esc(c.name)}${c.id === w.capital ? ' ★ capital' : ''}`);
    html += `<div class="row"><span class="muted">Region threat</span> <b>${w.threat[c.region]}</b> ${c.hall ? '' : '<span class="bad">· no town hall!</span>'}</div>`;
    if (w.cities.length > 1) html += `<div class="row">${w.cities.map(o => `<button data-act="pick-city" data-id="${o.id}" class="${o.id === c.id ? 'on' : ''}">${esc(o.name)}</button>`).join('')}</div>`;
    html += '<h3>Stockpile</h3><table>';
    const rs = w.B.resources;
    for (let i = 0; i < rs.length; i += 2) html += `<tr>${[rs[i], rs[i + 1]].map(k => k ? `<td><i class="sw" style="background:${RC[k]}"></i> ${k}</td><td class="n">${fmt(c.stock[k])}</td>` : '').join('')}</tr>`;
    html += '</table>';
    html += `<h3>People</h3><div class="row">Civilians ${c.nCiv} · soldiers ${c.nSol} · housing ${c.housing} · food ${c.trend >= 0 ? '+' : ''}${Math.round(c.trend)}/day ${c.starving ? '<span class="bad">STARVING</span>' : ''}</div>`;
    html += '<h3>Job priorities</h3><p class="muted">Higher fills first; 0 = no workers.</p>';
    for (const k of CATS) html += `<div class="row"><label>${k}</label><input type="range" min="0" max="5" step="1" value="${c.pri[k]}" data-act="pri" data-cat="${k}"><b>${c.pri[k]}</b></div>`;
    html += '<h3>Buildings</h3><table><tr><th>Type</th><th class="n">#</th><th class="n">Staff</th></tr>';
    const agg = {};
    for (const b of L.all) {
      const d = w.BD[b.type];
      const a = agg[b.type] = agg[b.type] || { n: 0, s: 0, need: 0, build: 0 };
      a.n++; if (!b.done) a.build++;
      if (d.workers) { a.s += b.workers.length; a.need += d.workers; }
    }
    for (const [k, a] of Object.entries(agg)) html += `<tr><td>${w.BD[k].name}${a.build ? ` <span class="muted">(${a.build} building)</span>` : ''}</td><td class="n">${a.n}</td><td class="n">${a.need ? `${a.s}/${a.need}` : ''}</td></tr>`;
    html += '</table>';
    const S = w.B.settlers;
    const sc = { ...S.cost }; for (const k in S.rations) sc[k] = (sc[k] || 0) + S.rations[k];
    html += `<h3>Expand</h3><p class="muted">Send ${S.civilians} civilians with ${costText(sc)} to found a settlement in another region.</p><div class="actions"><button data-act="found">Found settlement…</button>${c.hall ? `<button data-act="goto" data-x="${c.cx}" data-y="${c.cy}">Go to town hall</button>` : ''}</div>`;
    return html;
  }

  logisticsPanel() {
    const w = this.w, RC = w.B.resourceColors;
    let html = this.head('Logistics');
    html += '<p class="muted">Carts are built at a Cart depot (select it). A route sends a resource from A to B while A has more than <i>min</i> and B has less than <i>max</i>.</p>';
    html += '<h3>Carts</h3><table><tr><th>City</th><th class="n">Carts</th><th class="n">Idle</th></tr>';
    for (const c of w.cities) {
      const carts = w.units.filter(u => u.k === 'cart' && !u.dead && u.city === c.id);
      html += `<tr><td>${esc(c.name)}</td><td class="n">${carts.length}</td><td class="n">${carts.filter(u => !u.route).length}</td></tr>`;
    }
    html += '</table><h3>Routes</h3>';
    if (!w.routes.length) html += '<p class="muted">No routes yet.</p>';
    else {
      html += '<table><tr><th>Goods</th><th>From → to</th><th class="n">min/max</th><th class="n">Carts</th><th></th></tr>';
      for (const r of w.routes) {
        const A = w.cityMap.get(r.from), B = w.cityMap.get(r.to);
        const n = w.units.filter(u => u.k === 'cart' && u.route === r.id && !u.dead).length;
        html += `<tr><td><i class="sw" style="background:${RC[r.res]}"></i> ${r.res}</td><td>${esc(A ? A.name : '?')} → ${esc(B ? B.name : '?')}</td><td class="n">${r.min}/${r.max}</td><td class="n"><button data-act="route-carts" data-id="${r.id}" data-d="-1">−</button> ${n}/${r.carts} <button data-act="route-carts" data-id="${r.id}" data-d="1">+</button></td><td><button data-act="route-del" data-id="${r.id}">✕</button></td></tr>`;
      }
      html += '</table>';
    }
    const opts = w.cities.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    html += `<h3>New route</h3>
<div class="row"><label>Goods</label><select id="rt-res">${w.B.resources.map(r => `<option>${r}</option>`).join('')}</select></div>
<div class="row"><label>From</label><select id="rt-from">${opts}</select></div>
<div class="row"><label>To</label><select id="rt-to">${w.cities.map((c, i) => `<option value="${c.id}" ${i === 1 ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
<div class="row"><label>While A &gt;</label><input id="rt-min" type="number" value="50" min="0"><label style="width:auto">and B &lt;</label><input id="rt-max" type="number" value="100" min="0"></div>
<div class="row"><label>Carts</label><input id="rt-carts" type="number" value="1" min="0"> <button data-act="route-add">Add route</button></div>`;
    return html;
  }

  researchPanel() {
    const w = this.w;
    let html = this.head(`Research · ${fmt(w.research.rp)} RP`);
    html += '<p class="muted">Libraries produce research points. Each branch unlocks in order.</p><div class="cols">';
    for (const br of w.RD.branches) {
      html += `<div class="tech"><h3>${br.name}</h3>`;
      br.techs.forEach((t, i) => {
        const done = w.has(t.id);
        const avail = !done && (i === 0 || w.has(br.techs[i - 1].id));
        if (done) html += `<div class="done" title="${esc(t.desc)}">✓ ${t.name}</div>`;
        else html += `<button data-act="research" data-id="${t.id}" ${avail && w.research.rp >= t.cost ? '' : 'disabled'} title="${esc(t.desc)}">${avail ? '' : '🔒 '}${t.name}<br><span class="muted">${t.cost} RP · ${esc(t.desc)}</span></button>`;
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  // ---------------- selection panel ----------------
  renderSel() {
    const w = this.w, el = $('selection');
    for (const id of [...this.sel.squads]) if (!w.squadMap.get(id)) this.sel.squads.delete(id);
    if (this.sel.building && !w.bMap.get(this.sel.building)) this.sel.building = 0;
    let html = '';
    if (this.sel.squads.size) html = this.squadSel();
    else if (this.sel.building) html = this.buildingSel(w.bMap.get(this.sel.building));
    if (!html) { el.hidden = true; this.lastHtml.selection = ''; return; }
    el.hidden = false;
    this.setHtml('selection', html);
  }
  squadSel() {
    const w = this.w, UD = w.UD;
    const sqs = [...this.sel.squads].map(id => w.squadMap.get(id)).filter(Boolean);
    let html = '';
    const ORD = { idle: 'Standing guard', move: 'Moving', amove: 'Attack-moving', hold: 'Holding', patrol: 'Patrolling', attack: 'Attacking' };
    for (const s of sqs.slice(0, 4)) {
      const counts = {};
      let inside = 0;
      for (const id of s.members) { const u = w.unitMap.get(id); if (!u) continue; counts[u.k] = (counts[u.k] || 0) + 1; if (u.inside) inside++; }
      const eta = squadETA(w, s);
      html += `<h4><a data-act="sq-only" data-id="${s.id}" style="cursor:pointer">${esc(s.name)}</a> <span class="muted">· ${s.members.length}/50 · ${ORD[s.order.t] || s.order.t}${eta ? ` · ETA ${mmss(eta)}` : ''}${inside ? ` · ${inside} garrisoned` : ''}</span></h4>`;
      html += `<div class="chips">${Object.entries(counts).map(([k, n]) => `<span class="chip"><i class="sw" style="background:${UD[k].color}"></i>${n} ${UD[k].name}</span>`).join('')}</div>`;
    }
    if (sqs.length > 4) html += `<div class="muted">+${sqs.length - 4} more squads</div>`;
    html += `<div class="actions"><button data-act="sq-amove" title="A">Attack-move</button><button data-act="sq-hold" title="H">Hold</button><button data-act="sq-patrol" title="P">Patrol</button><button data-act="sq-garrison" title="G">Garrison</button>${sqs.length === 1 ? '<button data-act="sq-split">Split</button>' : '<button data-act="sq-merge">Merge</button>'}<button data-act="deselect">✕</button></div><div class="muted" style="margin-top:4px">Right-click to move · right-click a nest to attack it</div>`;
    return html;
  }
  buildingSel(b) {
    if (!b) return '';
    const w = this.w, d = w.BD[b.type], c = w.cityMap.get(b.city);
    const mhp = b.maxHp || d.hp;
    let html = `<h4>${esc(b.type === 'nest' ? (b.name || 'Zombie nest') : d.name)} <span class="muted">${c ? '· ' + esc(c.name) : ''}</span></h4>`;
    html += `<div class="bar"><div style="width:${Math.max(0, b.hp / mhp * 100)}%;background:${b.hp / mhp > 0.5 ? '#6BCB4F' : '#E0A030'}"></div></div><div class="muted">HP ${fmt(b.hp)}/${fmt(mhp)}</div>`;
    if (!b.done) html += `<div>Under construction · ${Math.round(b.prog * 100)}%</div>`;
    if (b.infected) html += `<div class="bad">INFECTED — releases ${b.infCount} zombies in ${Math.ceil(b.infT)}s unless soldiers clear it (${Math.ceil(b.infHp)} left)</div>`;
    if (d.workers) html += `<div>Workers ${b.workers.length}/${d.workers}${d.crew ? (b.crewed ? ' · crewed' : ' · <span class="warn">needs crew</span>') : ''}${b.yieldF && b.yieldF !== 1 ? ` · yield ×${b.yieldF.toFixed(2)}` : ''}</div>`;
    if (d.housing) html += `<div>Residents ${b.residents.length}/${d.housing}</div>`;
    if (b.inside.length && !d.garrison) html += `<div>${b.inside.length} inside</div>`;
    if (d.garrison) html += `<div>Garrison ${b.inside.length}/${d.garrison} archers (+${w.UD.archer.towerBonus} range)</div>`;
    if (d.out) html += `<div class="muted">${d.in ? costText(d.in) + ' → ' : ''}${Object.entries(d.out).map(([r, v]) => `${v} ${r}`).join(', ')} every ${d.cycle}s per worker</div>`;
    if (d.rp) html += `<div class="muted">${d.rp} RP every ${d.cycle}s per worker</div>`;
    if (d.drop) html += `<div class="muted">Drop-off for ${d.drop[0] === '*' ? 'all goods' : d.drop.join(', ')}</div>`;
    if (b.type === 'nest') html += `<div class="muted">Strength ${b.strength}. Spawns defenders while under attack. Select soldiers and right-click it to attack.</div>`;
    if (d.train && b.done) {
      const t = trainTime(w);
      html += `<div class="muted">Each recruit uses 1 civilian + equipment · ${t}s</div><div class="actions">`;
      for (const k of TRAINABLE) {
        const u = w.UD[k], locked = u.research && !w.has(u.research);
        html += `<button data-act="train" data-k="${k}" data-n="1" ${locked ? 'disabled' : ''} title="${costText(u.cost)}"><i class="sw" style="background:${u.color}"></i> ${u.name}</button><button data-act="train" data-k="${k}" data-n="5" ${locked ? 'disabled' : ''}>×5</button>`;
      }
      html += '</div>';
      if (b.queue.length) html += `<div class="queue">${b.queue.map((k, i) => `<button data-act="qcancel" data-i="${i}" title="Cancel">${i === 0 && b.training ? '▶ ' : ''}${w.UD[k].name}${i === 0 && b.training ? ` ${Math.ceil(b.trainT)}s` : ''}</button>`).join('')}</div>`;
      if (b.stall) html += `<div class="warn">${esc(b.stall)}</div>`;
    }
    if (d.carts && b.done) {
      const n = w.units.filter(u => u.k === 'cart' && u.city === b.city && !u.dead).length;
      html += `<div>${n} carts in this city · each ${costText(w.B.carts.cost)}</div><div class="actions"><button data-act="cart" data-n="1">Build cart</button><button data-act="cart" data-n="5">×5</button><button data-panel="logistics">Routes…</button></div>`;
      if (b.queue.length) html += `<div class="muted">Queue: ${b.queue.length}${b.training ? ` · next in ${Math.ceil(b.trainT)}s` : ''}</div>`;
      if (b.stall) html += `<div class="warn">${esc(b.stall)}</div>`;
    }
    if (b.city) html += `<div class="actions"><button data-act="demolish">Demolish</button><button data-act="deselect">✕</button></div>`;
    return html;
  }
}
