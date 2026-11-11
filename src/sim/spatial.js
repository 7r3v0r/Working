// Uniform-grid spatial hash rebuilt every tick. Units inside buildings are not indexed.
export class Spatial {
  constructor(W, H, cs = 4) {
    this.cs = cs; this.cw = Math.ceil(W / cs); this.ch = Math.ceil(H / cs);
    this.head = new Int32Array(this.cw * this.ch);
    this.head.fill(-1);
    this.next = new Int32Array(8192);
    this.units = [];
  }
  build(units) {
    this.units = units;
    this.head.fill(-1);
    if (this.next.length < units.length) this.next = new Int32Array(units.length * 2);
    const cs = this.cs, cw = this.cw;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.inside) continue;
      const c = ((u.y / cs) | 0) * cw + ((u.x / cs) | 0);
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }
  // mode: 1 = zombies (awake only if awakeOnly), 0 = humans
  nearest(x, y, r, wantZ, awakeOnly = false, exclude = null) {
    const cs = this.cs, cw = this.cw;
    const cx0 = Math.max(0, ((x - r) / cs) | 0), cx1 = Math.min(cw - 1, ((x + r) / cs) | 0);
    const cy0 = Math.max(0, ((y - r) / cs) | 0), cy1 = Math.min(this.ch - 1, ((y + r) / cs) | 0);
    let best = null, bd = r * r;
    const U = this.units;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = this.head[cy * cw + cx]; i >= 0; i = this.next[i]) {
        const u = U[i];
        if (u.dead || u.isZ !== wantZ) continue;
        if (awakeOnly && u.dormant) continue;
        if (u === exclude) continue;
        const dx = u.x - x, dy = u.y - y, d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; best = u; }
      }
    }
    return best;
  }
  any(x, y, r, wantZ, awakeOnly = true) {
    const cs = this.cs, cw = this.cw;
    const cx0 = Math.max(0, ((x - r) / cs) | 0), cx1 = Math.min(cw - 1, ((x + r) / cs) | 0);
    const cy0 = Math.max(0, ((y - r) / cs) | 0), cy1 = Math.min(this.ch - 1, ((y + r) / cs) | 0);
    const r2 = r * r, U = this.units;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = this.head[cy * cw + cx]; i >= 0; i = this.next[i]) {
        const u = U[i];
        if (u.dead || u.isZ !== wantZ) continue;
        if (awakeOnly && u.dormant) continue;
        const dx = u.x - x, dy = u.y - y;
        if (dx * dx + dy * dy <= r2) return u;
      }
    }
    return null;
  }
  // Collect units of a side within r into out (array), returns out.
  within(x, y, r, wantZ, out) {
    out.length = 0;
    const cs = this.cs, cw = this.cw;
    const cx0 = Math.max(0, ((x - r) / cs) | 0), cx1 = Math.min(cw - 1, ((x + r) / cs) | 0);
    const cy0 = Math.max(0, ((y - r) / cs) | 0), cy1 = Math.min(this.ch - 1, ((y + r) / cs) | 0);
    const r2 = r * r, U = this.units;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = this.head[cy * cw + cx]; i >= 0; i = this.next[i]) {
        const u = U[i];
        if (u.dead || u.isZ !== wantZ) continue;
        const dx = u.x - x, dy = u.y - y;
        if (dx * dx + dy * dy <= r2) out.push(u);
      }
    }
    return out;
  }
}
