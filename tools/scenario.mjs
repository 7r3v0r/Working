// Scripted scenario helpers shared by tests.
import { canPlace } from '../src/sim/civ.js';
export function findSpot(w, type, cx, cy, maxR = 40) {
  for (let r = 3; r <= maxR; r++) {
    for (let a = 0; a < 32; a++) {
      const x = Math.round(cx + Math.cos(a / 32 * 6.283) * r), y = Math.round(cy + Math.sin(a / 32 * 6.283) * r);
      if (canPlace(w, type, x, y).ok) return [x, y];
    }
  }
  return null;
}
export function build(w, type, cx, cy) {
  const s = findSpot(w, type, cx, cy);
  if (!s) return null;
  const r = w.cmd({ t: 'build', type, x: s[0], y: s[1] });
  return r.ok ? w.bMap.get(r.b) : null;
}
export function run(w, ticks) { for (let i = 0; i < ticks; i++) w.step(); }
