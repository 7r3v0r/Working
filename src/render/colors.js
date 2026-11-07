// Color helpers and the ground palette.
export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
export function darken(hex, k = 0.65) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

// Terrain shading relative to the region tint: [dh, ds, dl]
const TER_SHADE = [
  [0, 0, 0],          // grass
  [-6, -0.06, 0.06],  // dirt
  [18, 0.06, -0.12],  // forest
  [0, -0.12, 0.035],  // hills
  [45, -0.04, -0.08], // marsh
];
const FIXED = { 5: [59, 110, 143], 6: [107, 149, 173], 7: [46, 41, 37] };
const DEP_COL = [null, [200, 200, 192], [160, 82, 45], [30, 30, 30]];
export const ROAD_COL = [null, [156, 138, 104], [184, 178, 166]];

export function buildPalette(def) {
  const [br, bg, bb] = hexToRgb(def.baseGround);
  const [h0, s0, l0] = rgbToHsl(br, bg, bb);
  return def.regions.map(r => {
    const h = h0 + r.tint.dh, s = s0 + r.tint.ds, l = l0 + r.tint.dl;
    return TER_SHADE.map(([dh, ds, dl]) => hslToRgb(h + dh, s + ds, l + dl));
  });
}

export function tileColor(pal, map, road, t) {
  if (road[t]) return ROAD_COL[road[t]];
  const ter = map.terrain[t];
  let c = FIXED[ter] || pal[map.region[t]][ter];
  const d = map.deposit[t];
  if (d) { const k = 0.45, dc = DEP_COL[d]; c = [c[0] * (1 - k) + dc[0] * k, c[1] * (1 - k) + dc[1] * k, c[2] * (1 - k) + dc[2] * k]; }
  return c;
}
