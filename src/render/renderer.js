// Canvas 2D renderer: pre-rendered ground and fog (1 px per tile, scaled up), flat-colored squares for everything else.
import { buildPalette, tileColor, darken, lighten, luma, abgr } from './colors.js';

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 330, y: 400, s: 8 };
    this.overlays = { threat: false, borders: false, vision: false };
    this.vw = 800; this.vh = 600; this.dpr = 1;
    this.buckets = new Map();
    this.th = null;      // renderer colors of the active style (themes.js)
    this.bcol = new Map(); // building fill -> [outline, label]
  }

  // Switch style: repaint the ground and fog with the new colors. Everything else is read at draw time.
  setTheme(th) {
    this.th = th;
    this.bcol.clear();
    this.fogDark = abgr(th.fog); this.fogSeen = abgr(th.fog, th.fogSeen);
    if (this.w) { this.paintGround(); this.forceFog = true; }
  }
  paintGround() {
    const w = this.w, d = this.gimg.data, N = w.N;
    this.pal = buildPalette(w.map.def, this.th.ground);
    for (let t = 0; t < N; t++) {
      const c = tileColor(this.pal, w.map, w.road, t);
      d[t * 4] = c[0]; d[t * 4 + 1] = c[1]; d[t * 4 + 2] = c[2]; d[t * 4 + 3] = 255;
    }
    this.gctx.putImageData(this.gimg, 0, 0);
    w.dirtyTiles.length = 0;
  }
  // Outline and label colors for a building fill, computed once per color.
  bStyle(fill) {
    let v = this.bcol.get(fill);
    if (!v) {
      const th = this.th, k = th.stroke;
      v = [k === 'dark' ? darken(fill, 0.6) : k === 'light' ? lighten(fill, 0.45) : k, th.label[luma(fill) > 0.6 ? 0 : 1]];
      this.bcol.set(fill, v);
    }
    return v;
  }

  setWorld(w) {
    this.w = w;
    const W = w.W, H = w.H;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    this.ground = mk(); this.gctx = this.ground.getContext('2d');
    this.gimg = this.gctx.createImageData(W, H);
    this.paintGround();
    this.fog = mk(); this.fctx = this.fog.getContext('2d');
    this.fimg = this.fctx.createImageData(W, H);
    this.f32 = new Uint32Array(this.fimg.data.buffer);
    this.vis = mk(); this.vctx = this.vis.getContext('2d');
    this.vimg = this.vctx.createImageData(W, H);
    this.v32 = new Uint32Array(this.vimg.data.buffer);
    this.fogTick = -1;
    // region borders
    this.borders = mk();
    const bctx = this.borders.getContext('2d'), bimg = bctx.createImageData(W, H), b32 = new Uint32Array(bimg.data.buffer);
    const R = w.map.region;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const t = y * W + x, r = R[t];
      if (R[t + 1] !== r || R[t + W] !== r) b32[t] = 0xB0FFFFFF;
    }
    bctx.putImageData(bimg, 0, 0);
    this.threatCv = mk(); this.threatKey = '';
    this.cam.x = w.cities[0] ? w.cities[0].cx : W / 2;
    this.cam.y = w.cities[0] ? w.cities[0].cy : H / 2;
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.vw = this.cv.clientWidth; this.vh = this.cv.clientHeight;
    this.cv.width = Math.round(this.vw * this.dpr); this.cv.height = Math.round(this.vh * this.dpr);
  }
  minScale() { return Math.min(this.vw / this.w.W, this.vh / this.w.H) * 0.95; }
  clampCam() {
    const c = this.cam, w = this.w;
    c.s = Math.max(this.minScale(), Math.min(24, c.s));
    const hw = this.vw / 2 / c.s, hh = this.vh / 2 / c.s;
    c.x = hw * 2 >= w.W ? w.W / 2 : Math.max(hw, Math.min(w.W - hw, c.x));
    c.y = hh * 2 >= w.H ? w.H / 2 : Math.max(hh, Math.min(w.H - hh, c.y));
  }
  toScreen(x, y) { const c = this.cam; return [(x - c.x) * c.s + this.vw / 2, (y - c.y) * c.s + this.vh / 2]; }
  toWorld(sx, sy) { const c = this.cam; return [(sx - this.vw / 2) / c.s + c.x, (sy - this.vh / 2) / c.s + c.y]; }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.s *= f;
    this.clampCam();
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny;
    this.clampCam();
  }

  updateGround() {
    const w = this.w, dt = w.dirtyTiles;
    if (!dt.length) return;
    const d = this.gimg.data, W = w.W;
    for (const t of dt) {
      const c = tileColor(this.pal, w.map, w.road, t);
      d[t * 4] = c[0]; d[t * 4 + 1] = c[1]; d[t * 4 + 2] = c[2];
      this.gctx.putImageData(this.gimg, 0, 0, t % W, (t / W) | 0, 1, 1);
    }
    dt.length = 0;
  }
  updateFog() {
    const w = this.w;
    if (this.fogTick === w.visionTick && !this.forceFog) return;
    this.fogTick = w.visionTick; this.forceFog = false;
    const vis = w.visible, exp = w.explored, f = this.f32, v = this.v32, N = w.N, dark = this.fogDark, seen = this.fogSeen;
    for (let t = 0; t < N; t++) {
      if (vis[t]) { f[t] = 0; v[t] = 0x3CFFE070; }
      else { f[t] = exp[t] ? seen : dark; v[t] = 0; }
    }
    this.fctx.putImageData(this.fimg, 0, 0);
    if (this.overlays.vision) this.vctx.putImageData(this.vimg, 0, 0);
  }
  updateThreat() {
    const w = this.w, key = w.threat.join(',');
    if (key === this.threatKey) return;
    this.threatKey = key;
    const W = w.W, H = w.H, ctx = this.threatCv.getContext('2d'), img = ctx.createImageData(W, H), d32 = new Uint32Array(img.data.buffer);
    const mx = Math.max(1, ...w.threat);
    const cols = w.threat.map(v => {
      const k = v / mx;
      const a = Math.round(40 + 130 * k);
      const r = 255, g = Math.round(220 * (1 - k)), b = 40;
      return (a << 24) | (b << 16) | (g << 8) | r;
    });
    const R = w.map.region;
    for (let t = 0; t < W * H; t++) d32[t] = cols[R[t]];
    ctx.putImageData(img, 0, 0);
  }

  render(alpha, ui) {
    const w = this.w, ctx = this.ctx, c = this.cam, s = c.s, th = this.th;
    this.updateGround();
    this.updateFog();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, this.vw, this.vh);
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.vw, this.vh);
    const tx0 = Math.max(0, Math.floor(x0)), ty0 = Math.max(0, Math.floor(y0));
    const tx1 = Math.min(w.W, Math.ceil(x1)), ty1 = Math.min(w.H, Math.ceil(y1));
    const sw = tx1 - tx0, sh = ty1 - ty0;
    const [dx, dy] = this.toScreen(tx0, ty0);
    ctx.drawImage(this.ground, tx0, ty0, sw, sh, dx, dy, sw * s, sh * s);
    this.drawBuildings(tx0, ty0, tx1, ty1, ui);
    this.drawUnits(alpha, x0 - 2, y0 - 2, x1 + 2, y1 + 2, ui);
    this.drawFx();
    ctx.drawImage(this.fog, tx0, ty0, sw, sh, dx, dy, sw * s, sh * s);
    if (w.isNight()) { ctx.fillStyle = th.night; ctx.fillRect(0, 0, this.vw, this.vh); }
    if (this.overlays.vision) ctx.drawImage(this.vis, tx0, ty0, sw, sh, dx, dy, sw * s, sh * s);
    if (this.overlays.threat) { this.updateThreat(); ctx.globalAlpha = 0.55; ctx.drawImage(this.threatCv, tx0, ty0, sw, sh, dx, dy, sw * s, sh * s); ctx.globalAlpha = 1; }
    if (this.overlays.borders) ctx.drawImage(this.borders, tx0, ty0, sw, sh, dx, dy, sw * s, sh * s);
    this.drawRegionLabels();
    this.drawUi(ui);
  }

  drawBuildings(tx0, ty0, tx1, ty1, ui) {
    const w = this.w, ctx = this.ctx, s = this.cam.s, BD = w.BD, CC = w.defs.buildings.categoryColors, th = this.th;
    const flash = (performance.now() / 250 | 0) % 2 === 0;
    const sel = ui && ui.sel.building;
    const labels = s >= 10;
    if (labels) { ctx.font = `bold ${Math.min(13, s * 0.8) | 0}px ${th.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
    if (th.shadow && s >= 3) { // flat drop shadows: one path, one fill, under every building
      const o = Math.min(4, s * 0.3);
      ctx.fillStyle = '#000'; ctx.globalAlpha = th.shadow;
      ctx.beginPath();
      for (const b of w.buildings) {
        if (b.dead || !b.done || b.x + b.w < tx0 || b.y + b.h < ty0 || b.x > tx1 || b.y > ty1 || !w.explored[b.y * w.W + b.x]) continue;
        const [sx, sy] = this.toScreen(b.x, b.y);
        ctx.rect(sx + o, sy + o, b.w * s, b.h * s);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const b of w.buildings) {
      if (b.dead || b.x + b.w < tx0 || b.y + b.h < ty0 || b.x > tx1 || b.y > ty1) continue;
      if (!w.explored[b.y * w.W + b.x]) continue;
      const d = BD[b.type];
      const [sx, sy] = this.toScreen(b.x, b.y);
      const bw = b.w * s, bh = b.h * s;
      const base = d.color || CC[d.cat], bs = this.bStyle(base);
      let col = base;
      if (b.infected) col = th.infected[flash ? 0 : 1];
      else if (d.zombie) col = flash || w.tick - b.lastHit > 30 ? CC.nest : th.nestHit;
      ctx.globalAlpha = b.done ? 1 : 0.45;
      ctx.fillStyle = col;
      ctx.fillRect(sx, sy, bw, bh);
      if (s >= 3) {
        ctx.strokeStyle = b.id === sel ? th.sel : bs[0];
        ctx.lineWidth = b.id === sel ? 2 : 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, bw - 1, bh - 1);
      }
      ctx.globalAlpha = 1;
      if (!b.done && s >= 3) { ctx.fillStyle = '#F2D16B'; ctx.fillRect(sx, sy + bh - 2, bw * b.prog, 2); }
      const mhp = b.maxHp || d.hp;
      if (b.done && b.hp < mhp && s >= 3) {
        ctx.fillStyle = '#000'; ctx.fillRect(sx, sy - 3, bw, 2);
        ctx.fillStyle = b.hp / mhp > 0.5 ? '#6BCB4F' : '#E0A030'; ctx.fillRect(sx, sy - 3, bw * Math.max(0, b.hp / mhp), 2);
      }
      if (labels && d.label && b.w * s >= 14) {
        ctx.fillStyle = bs[1];
        ctx.fillText(d.label, sx + bw / 2, sy + bh / 2);
      }
      if (d.garrison && b.inside.length && s >= 4) {
        ctx.fillStyle = w.UD.archer.color;
        for (let i = 0; i < b.inside.length; i++) ctx.fillRect(sx + 2 + i * 3, sy + 2, 2, 2);
      }
    }
  }

  drawUnits(alpha, x0, y0, x1, y1, ui) {
    const w = this.w, ctx = this.ctx, s = this.cam.s, UD = w.UD, W = w.W, vis = w.visible;
    const B = this.buckets, dormant = this.th.dormant;
    for (const v of B.values()) v.length = 0;
    const selU = ui ? ui.sel.units : null;
    const sel = [];
    const carriers = [];
    for (const u of w.units) {
      if (u.dead || u.inside) continue;
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (u.isZ && !vis[(y | 0) * W + (x | 0)]) continue;
      const col = u.isZ && u.dormant ? dormant : UD[u.k].color;
      let arr = B.get(col); if (!arr) { arr = []; B.set(col, arr); }
      const sz = (UD[u.k].size || 1);
      arr.push(x, y, sz);
      if (selU && selU.has(u.id)) sel.push(x, y, sz);
      if (u.carry && s >= 4) carriers.push(x, y, w.B.resourceColors[u.carry.r]);
      else if (u.cargo && s >= 3) carriers.push(x, y, w.B.resourceColors[u.cargo.r]);
    }
    const vw2 = this.vw / 2, vh2 = this.vh / 2, cx = this.cam.x, cy = this.cam.y;
    const minPx = 1.5;
    for (const [col, a] of B) {
      if (!a.length) continue;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < a.length; i += 3) {
        const px = Math.max(minPx, a[i + 2] * s * 0.9);
        ctx.rect((a[i] - cx) * s + vw2 - px / 2, (a[i + 1] - cy) * s + vh2 - px / 2, px, px);
      }
      ctx.fill();
    }
    if (sel.length) {
      ctx.strokeStyle = this.th.sel; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < sel.length; i += 3) {
        const px = Math.max(minPx, sel[i + 2] * s * 0.9) + 2;
        ctx.rect((sel[i] - cx) * s + vw2 - px / 2, (sel[i + 1] - cy) * s + vh2 - px / 2, px, px);
      }
      ctx.stroke();
    }
    for (let i = 0; i < carriers.length; i += 3) {
      ctx.fillStyle = carriers[i + 2];
      ctx.fillRect((carriers[i] - cx) * s + vw2 - 0.5, (carriers[i + 1] - cy) * s + vh2 - 0.5, Math.max(1, s * 0.25), Math.max(1, s * 0.25));
    }
  }

  drawFx() {
    const w = this.w, ctx = this.ctx, s = this.cam.s, th = this.th;
    if (!w.fx.length) return;
    ctx.lineWidth = 1;
    for (const f of w.fx) {
      if (f.k === 'arrow' || f.k === 'bolt') {
        if (!w.visible[w.tileOf(f.x2, f.y2)] && !w.visible[w.tileOf(f.x1, f.y1)]) continue;
        const [a, b] = this.toScreen(f.x1, f.y1), [c, d] = this.toScreen(f.x2, f.y2);
        ctx.strokeStyle = f.k === 'bolt' ? th.bolt : th.arrow;
        ctx.lineWidth = f.k === 'bolt' ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      } else if (f.k === 'boom') {
        const [a, b] = this.toScreen(f.x, f.y);
        ctx.strokeStyle = 'rgba(255,170,60,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(a, b, f.r * s, 0, 6.2832); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  }

  drawRegionLabels() {
    const w = this.w, ctx = this.ctx, s = this.cam.s, th = this.th;
    if (s > 3 && !this.overlays.threat && !this.overlays.borders) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = th.regionLabel[1];
    w.map.def.regions.forEach((r, i) => {
      const [cx, cy] = w.map.centroids[i];
      const [x, y] = this.toScreen(cx, cy);
      if (x < -100 || y < -40 || x > this.vw + 100 || y > this.vh + 40) return;
      ctx.font = `600 13px ${th.font}`;
      ctx.strokeText(r.name, x, y);
      ctx.fillStyle = th.regionLabel[0]; ctx.fillText(r.name, x, y);
      if (this.overlays.threat) {
        ctx.font = `600 11px ${th.font}`;
        ctx.strokeText(`threat ${w.threat[i]}`, x, y + 15); ctx.fillText(`threat ${w.threat[i]}`, x, y + 15);
      }
    });
    ctx.lineWidth = 1; ctx.lineJoin = 'miter';
  }

  drawUi(ui) {
    if (!ui) return;
    const w = this.w, ctx = this.ctx, s = this.cam.s, th = this.th;
    // squad order targets
    for (const id of ui.sel.squads) {
      const q = w.squadMap.get(id);
      if (!q || !q.order || q.order.x === undefined || q.order.t === 'hold') continue;
      const col = t => th.order[t === 'amove' || t === 'attack' ? 1 : 0];
      const [x, y] = this.toScreen(q.order.x, q.order.y);
      ctx.strokeStyle = col(q.order.t);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      // queued waypoints: dashed legs, small markers
      let px = x, py = y;
      for (const wp of q.queue || []) {
        const [qx, qy] = this.toScreen(wp.x, wp.y);
        ctx.strokeStyle = col(wp.t); ctx.globalAlpha = 0.7; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(qx, qy, 3.5, 0, 6.2832); ctx.stroke();
        px = qx; py = qy;
      }
      if (q.order.t === 'patrol') {
        const [ax, ay] = this.toScreen(q.order.ax, q.order.ay);
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // placement ghost
    const g = ui.ghost;
    if (g) {
      ctx.globalAlpha = 0.55;
      for (const p of g.tiles) {
        const [sx, sy] = this.toScreen(p[0], p[1]);
        ctx.fillStyle = p[2] ? '#5BD15B' : '#E04040';
        ctx.fillRect(sx, sy, (p[3] || 1) * s, (p[4] || 1) * s);
      }
      ctx.globalAlpha = 1;
      for (const [rx, ry, rr, hot] of g.rings || []) {
        const [cx, cy] = this.toScreen(rx, ry);
        ctx.strokeStyle = hot ? 'rgba(242,209,107,0.7)' : th.ring; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(cx, cy, rr * s, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (ui.box) {
      const b = ui.box;
      ctx.strokeStyle = th.sel; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.setLineDash([]);
    }
  }
}

export class Minimap {
  constructor(canvas, renderer) {
    this.cv = canvas; this.r = renderer; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.last = 0;
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.cw = this.cv.clientWidth; this.ch = this.cv.clientHeight;
    this.cv.width = Math.round(this.cw * dpr); this.cv.height = Math.round(this.ch * dpr);
    this.dpr = dpr;
  }
  draw(force) {
    const now = performance.now();
    if (!force && now - this.last < 250) { this.drawCam(); return; }
    this.last = now;
    const r = this.r, w = r.w, ctx = this.ctx, th = r.th, mc = th.mini;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const sx = this.cw / w.W, sy = this.ch / w.H;
    ctx.drawImage(r.ground, 0, 0, this.cw, this.ch);
    const CC = w.defs.buildings.categoryColors;
    for (const b of w.buildings) {
      if (b.dead || !w.explored[b.y * w.W + b.x]) continue;
      const d = w.BD[b.type];
      if (d.line && d.cat === 'defense') ctx.fillStyle = mc.wall;
      else ctx.fillStyle = b.infected || d.zombie ? mc.z : (d.color || CC[d.cat]);
      ctx.fillRect(b.x * sx, b.y * sy, Math.max(1.5, b.w * sx), Math.max(1.5, b.h * sy));
    }
    ctx.drawImage(r.fog, 0, 0, this.cw, this.ch);
    const vis = w.visible;
    const zs = [], hs = [];
    for (const u of w.units) {
      if (u.dead || u.inside) continue;
      if (u.isZ) { if (vis[w.tileOf(u.x, u.y)]) zs.push(u.x * sx, u.y * sy); }
      else hs.push(u.x * sx, u.y * sy, u.k === 'civ');
    }
    ctx.fillStyle = mc.civ;
    for (let i = 0; i < hs.length; i += 3) if (hs[i + 2]) ctx.fillRect(hs[i] - 0.5, hs[i + 1] - 0.5, 1.5, 1.5);
    ctx.fillStyle = mc.army;
    for (let i = 0; i < hs.length; i += 3) if (!hs[i + 2]) ctx.fillRect(hs[i] - 0.75, hs[i + 1] - 0.75, 2, 2);
    ctx.fillStyle = mc.z;
    for (let i = 0; i < zs.length; i += 2) ctx.fillRect(zs[i] - 0.75, zs[i + 1] - 0.75, 2, 2);
    if (w.isNight()) { ctx.fillStyle = th.night; ctx.fillRect(0, 0, this.cw, this.ch); }
    this.snap = ctx.getImageData(0, 0, this.cv.width, this.cv.height);
    this.drawCam(true);
  }
  drawCam(fresh) {
    const r = this.r, w = r.w, ctx = this.ctx;
    if (!fresh && this.snap) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(this.snap, 0, 0); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
    const sx = this.cw / w.W, sy = this.ch / w.H;
    const [x0, y0] = r.toWorld(0, 0), [x1, y1] = r.toWorld(r.vw, r.vh);
    ctx.strokeStyle = r.th.mini.frame; ctx.lineWidth = 1;
    ctx.strokeRect(Math.max(0, x0 * sx) + 0.5, Math.max(0, y0 * sy) + 0.5, Math.min(this.cw - 1, (x1 - x0) * sx), Math.min(this.ch - 1, (y1 - y0) * sy));
  }
  toWorld(mx, my) { const w = this.r.w; return [mx / this.cw * w.W, my / this.ch * w.H]; }
}
