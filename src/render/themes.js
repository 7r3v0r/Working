// Visual styles. A style is a set of colors and two flags, applied once at start (or on switch):
// the ground is repainted into its 1 px-per-tile canvas and everything else reads plain strings,
// so a style costs nothing per frame. The matching UI colors are in style.css under
// :root[data-style=...]. "classic" is the look defined by data/*.json; anything a style
// leaves out falls back to it.

// Renderer colors of the classic look.
const CLASSIC = {
  bg: '#000000',                 // behind the map
  fog: '#000000', fogSeen: 0.6,  // unexplored color; opacity over explored-but-unseen ground
  night: 'rgba(10,20,70,0.4)',
  sel: '#FFFFFF',                // selection outlines and box select
  stroke: 'dark',                // building outline: 'dark', 'light', or one fixed color
  shadow: 0,                     // opacity of a flat drop shadow under buildings (0 = none)
  font: 'system-ui, sans-serif',
  label: ['#3A2A10', '#F0F0F0'], // building letters on light / dark fills
  regionLabel: ['rgba(255,255,255,0.9)', 'rgba(0,0,0,0.55)'], // text, outline
  dormant: '#9E3A3A',
  infected: ['#E02424', '#7A1010'], nestHit: '#8E2020',
  arrow: 'rgba(230,230,230,0.6)', bolt: 'rgba(255,240,200,0.9)',
  order: ['#9FE3FF', '#FF7A7A'], // move / attack markers
  ring: 'rgba(255,255,255,0.35)',
  mini: { civ: '#F2D16B', army: '#5AA2FF', z: '#FF4040', wall: '#333333', frame: '#FFFFFF' },
};

export const THEMES = {
  classic: { name: 'Classic', r: CLASSIC },

  // 1. An inked map on paper: muted earth tones, ink outlines, blue for your troops, vermilion for the dead.
  parchment: {
    name: 'Parchment',
    ground: {
      terrain: ['#D8C9A0', '#CDB98C', '#9FA873', '#BFB296', '#A9AE8C'], tint: 0.3,
      water: '#7C9DAE', ford: '#A6BFC6', cliff: '#5A4838',
      deposit: ['#F3EEE2', '#A65A2E', '#3A332C'], road: ['#B59B6E', '#EDE6D6'],
      grain: 0.018,
    },
    cat: { housing: '#EFE3C4', production: '#B08D5B', military: '#3F5E86', defense: '#4A3E32', hall: '#C8962E', nest: '#6E1D14' },
    types: { wall: '#6B543A', gate: '#A07C4E', sgate: '#8E877A', trap: '#5A5046', ditch: '#8A7652' },
    units: { civ: '#3B2E20', peasant: '#7F9BBD', sword: '#27508C', spear: '#1F7F86', archer: '#4F8FC4', cav: '#14264A', scout: '#7A3FA6', zombie: '#C9311C', cart: '#7B5230' },
    r: {
      bg: '#2A2018', fog: '#2A2018', fogSeen: 0.5, night: 'rgba(35,30,80,0.38)',
      sel: '#1A1410', stroke: '#3B2E20', font: 'Georgia, "Times New Roman", serif',
      label: ['#2E2416', '#F4ECD8'], regionLabel: ['#F4ECD8', 'rgba(42,32,24,0.85)'],
      dormant: '#8E5A4E', infected: ['#C9311C', '#6E1D14'], nestHit: '#A3382A',
      arrow: 'rgba(40,30,20,0.7)', bolt: 'rgba(40,30,20,0.9)', order: ['#27508C', '#C9311C'], ring: 'rgba(46,36,22,0.45)',
      mini: { civ: '#3B2E20', army: '#27508C', z: '#C9311C', wall: '#4A3E32', frame: '#F4ECD8' },
    },
  },

  // 2. A dark tactical board: near-black ground, bright outlined structures, units that glow against it.
  nightwatch: {
    name: 'Night Watch',
    ground: {
      terrain: ['#22302A', '#2E2B25', '#131D18', '#30363A', '#1A2A2E'], tint: 0.35,
      water: '#1C5A8A', ford: '#3F86B5', cliff: '#07090B',
      deposit: ['#66707A', '#8A4E2A', '#000000'], road: ['#4A4234', '#5E6166'],
    },
    cat: { housing: '#7A6A45', production: '#56606A', military: '#2F6E96', defense: '#3A4048', hall: '#B8922A', nest: '#7A1230' },
    types: { wall: '#5A4A38', gate: '#8A6E4B', sgate: '#70767E', trap: '#30343A', ditch: '#3A3428' },
    units: { civ: '#FFD75A', peasant: '#B6D4FF', sword: '#3DA5FF', spear: '#2EE6C5', archer: '#9BE8FF', cav: '#8A7CFF', scout: '#FFFFFF', zombie: '#FF3B5C', cart: '#D0915A' },
    r: {
      bg: '#04060A', fog: '#04060A', fogSeen: 0.5, night: 'rgba(0,8,40,0.38)',
      stroke: 'light', font: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      label: ['#0B0F14', '#E8F1F5'], regionLabel: ['#C8EBF0', 'rgba(0,0,0,0.7)'],
      dormant: '#8A2A40', infected: ['#FF3B5C', '#7A1230'], nestHit: '#C22848',
      arrow: 'rgba(190,240,255,0.7)', bolt: 'rgba(255,230,160,0.95)', order: ['#4FE3C1', '#FF3B5C'], ring: 'rgba(79,227,193,0.4)',
      mini: { civ: '#FFD75A', army: '#3DA5FF', z: '#FF3B5C', wall: '#6A727C' },
    },
  },

  // 3. A bright board game: fresh greens and blues, cut-out buildings that cast a flat shadow.
  meadow: {
    name: 'Meadow',
    ground: {
      terrain: ['#A9D27C', '#E0CF98', '#5FA85C', '#C3C9A4', '#82B79A'], tint: 0.25,
      water: '#4FA8DE', ford: '#93D2EE', cliff: '#75655A',
      deposit: ['#F4F4EE', '#B4622E', '#2E2E33'], road: ['#C9A66B', '#E9E4D8'],
      grain: [0, 0, 0.035, 0.012, 0.02],
    },
    cat: { housing: '#F6EBD2', production: '#D98E4A', military: '#3F74D6', defense: '#6C7480', hall: '#F6C445', nest: '#5C1B3A' },
    types: { wall: '#8B6A46', gate: '#B98C54', sgate: '#9AA1AB', trap: '#56503F', ditch: '#8F7B52' },
    units: { civ: '#40332B', peasant: '#C7DBFF', sword: '#1E5AE0', spear: '#0B8E96', archer: '#5CB4FF', cav: '#1B2F86', scout: '#FFFFFF', zombie: '#D81E3F', cart: '#7A4E26' },
    r: {
      bg: '#1C3340', fog: '#1C3340', fogSeen: 0.45, night: 'rgba(20,30,95,0.38)',
      sel: '#14222B', stroke: 'dark', shadow: 0.22,
      label: ['#33291A', '#FFFFFF'], regionLabel: ['#FFFFFF', 'rgba(20,34,43,0.75)'],
      dormant: '#9A4860', infected: ['#D81E3F', '#5C1B3A'], nestHit: '#A32448',
      arrow: 'rgba(40,40,50,0.65)', bolt: 'rgba(40,40,50,0.9)', order: ['#1E5AE0', '#D81E3F'], ring: 'rgba(255,255,255,0.6)',
      mini: { civ: '#40332B', army: '#1E5AE0', z: '#D81E3F', wall: '#6C7480' },
    },
  },
};

const KEY = 'sotd.style';
export function savedTheme() {
  const q = new URLSearchParams(location.search).get('style');
  if (q && THEMES[q]) return q;
  try { const s = localStorage.getItem(KEY); if (s && THEMES[s]) return s; } catch { /* storage unavailable */ }
  return 'classic';
}

let base = null; // the classic colors from data/*.json, captured the first time a style is applied

// Writes the style's colors into the loaded data definitions (which the renderer and UI already read)
// and returns the renderer colors. Call renderer.setTheme() afterwards to repaint the ground.
export function applyTheme(defs, id) {
  const t = THEMES[id] || THEMES.classic, B = defs.buildings, U = defs.units;
  if (!base) {
    base = { cat: { ...B.categoryColors }, types: {}, units: {} };
    for (const k in B.types) base.types[k] = B.types[k].color;
    for (const k in U) base.units[k] = U[k].color;
  }
  Object.assign(B.categoryColors, base.cat, t.cat);
  for (const k in B.types) {
    const c = (t.types && t.types[k]) || base.types[k];
    if (c) B.types[k].color = c; else delete B.types[k].color;
  }
  for (const k in U) U[k].color = (t.units && t.units[k]) || base.units[k];
  document.documentElement.dataset.style = id;
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
  return { id, name: t.name, ground: t.ground || null, ...CLASSIC, ...t.r, mini: { ...CLASSIC.mini, ...(t.r && t.r.mini) } };
}
