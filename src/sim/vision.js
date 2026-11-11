// Vision and fog of war. Explored tiles persist; visible is recomputed every few ticks.
const circles = new Map();
function circle(r, W) {
  const key = r * 100000 + W;
  let c = circles.get(key);
  if (c) return c;
  const dx = [], dy = [];
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) { dx.push(x); dy.push(y); }
  c = { dx: Int16Array.from(dx), dy: Int16Array.from(dy) };
  circles.set(key, c);
  return c;
}

// explore=false recomputes `visible` only (used after loading a save).
export function updateVision(w, explore = true) {
  const vis = w.visible, exp = w.explored, W = w.W, H = w.H;
  vis.fill(0);
  const nm = w.isNight() ? w.B.vision.nightMult : 1;
  const seen = new Set();
  const stamp = (x, y, r0) => stampRaw(x, y, Math.max(1, Math.round(r0 * nm)));
  const stampRaw = (x, y, r) => {
    const cx = x | 0, cy = y | 0;
    const key = (cy * W + cx) * 64 + r;
    if (seen.has(key)) return;
    seen.add(key);
    const c = circle(r, W);
    const n = c.dx.length;
    if (cx - r >= 0 && cy - r >= 0 && cx + r < W && cy + r < H) {
      const base = cy * W + cx;
      for (let i = 0; i < n; i++) { const t = base + c.dy[i] * W + c.dx[i]; vis[t] = 1; if (explore && !exp[t]) w.explore(t); }
    } else {
      for (let i = 0; i < n; i++) {
        const xx = cx + c.dx[i], yy = cy + c.dy[i];
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const t = yy * W + xx; vis[t] = 1; if (explore && !exp[t]) w.explore(t);
      }
    }
  };
  for (const u of w.units) {
    if (u.dead || u.isZ || u.inside) continue;
    stamp(u.x, u.y, w.UD[u.k].vision || 6);
  }
  const bv = w.B.vision.building;
  for (const b of w.buildings) {
    if (b.dead || !b.city) continue;
    const d = w.BD[b.type];
    if (d.line && !d.vision) continue;
    // Vision is measured from the building's edge, and buildings always see at least `bv` tiles.
    const r = Math.max(bv, Math.round(((b.done && d.vision) || bv) * nm));
    stampRaw(b.x + b.w / 2, b.y + b.h / 2, r + Math.ceil(Math.max(b.w, b.h) / 2));
  }
  w.flushExplore();
}
