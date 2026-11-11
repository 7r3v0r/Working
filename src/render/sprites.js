// Pixel-art sprites: 16 px per tile, dark outline, two-tone shading. Everything is drawn in code
// into one atlas canvas when a game or style loads, so there are no image files to fetch. The
// renderer then draws each unit and building with a single drawImage from the atlas.

const O = '#2b1f1a'; // outline
const CREAM = '#efe0bd', CREAM_D = '#c9b48a', TIMBER = '#8b5a2b', TIMBER_D = '#6b4423', TIMBER_L = '#b98a55', PALE = '#d9b88a';
const STONE = '#9a958c', STONE_L = '#b9b4aa', STONE_LL = '#c9c4ba', STONE_D = '#7c776f', STONE_DD = '#6a655e';
const GLASS = '#7fb6d6', GLASS_L = '#b5dcee', DARK = '#1a1410', DIRT = '#b79b6a', DIRT_D = '#9a8054', SOIL = '#7a5c38';
const WATER = '#4f8fbf', WATER_L = '#86bfe0', FIRE = '#f08a24', FIRE_L = '#ffd25a', COAL = '#2a2a2e', ORE = '#b5651d', IRON = '#9aa6b2', STEEL = '#e8eef2';
const HAY = '#e2c35a', HAY_D = '#b9982e', GREEN = '#4f8a3c', GREEN_L = '#7bb04f', RED = '#c0392b', GOLD = '#d9aa32', BONE = '#e8e2d0';
const TILE_ROOF = '#a5482e', WOOD_ROOF = '#8a6a48', SLATE = '#6f7782', BLUE_ROOF = '#4f6d8a', BLUE = '#3b82f6';

// k <= 1 darkens; 1 < k <= 2 lightens toward white by k - 1.
function tone(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1))));
  return '#' + ((1 << 24) | (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1);
}
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------- units: string grids, one letter per pixel ----------
const PAL = {
  o: O, h: '#6b4423', s: '#f0c49a', e: O, k: '#7a4a22', l: '#5a4632', b: '#3a2a1e', w: TIMBER, W: '#d9b07a',
  y: HAY, Y: HAY_D, m: IRON, M: '#dfe6ec', x: STEEL, d: '#b8c2cc', D: GOLD, g: '#3f8f6a', z: '#8fae6a', Z: '#6f8c50', R: '#ff3030',
};
const put = (rows, pts, ch) => { const a = rows.map(r => r.split('')); for (const [x, y] of pts) a[y][x] = ch; return a.map(r => r.join('')); };
const swap = (rows, map) => rows.map(r => r.replace(/./g, c => map[c] || c));

const CIV = [
  '................', '.....oooooo.....', '....ohhhhhho....', '...ohhhhhhhho...', '...ohhsssshho...', '...ohsessesho...', '...osssssssso...', '....osssssso....',
  '....otttttTo....', '...ostttttTso...', '...ostttttTso...', '....okkkkkko....', '....otttttTo....', '....olloollo....', '....obboobbo....', '....oooooooo....'];
const SWORD = [
  '................', '.....oooooo..o..', '....ommmmmmooxo.', '...ommMMmmmmoxo.', '...ommssssmmoxo.', '...omsessesmoxo.', '...ossssssssoxo.', '....ossssssooxo.',
  '.oooootttttokkko', 'oddddottttTosko.', 'oddDdottttTooo..', 'oddddokkkkko....', '.oddoottttTo....', '..ooolloollo....', '....obboobbo....', '....oooooooo....'];
const ZOMBIE = [
  '................', '.....oooooo.....', '....ozzhzzzo....', '...ozzzzzzzZo...', '...ozzzzzzzZo...', '...ozzRzzRzZo...', '...ozzzoozzZo...', '....ozzzzzZo....',
  '.oooorrrrrqoooo.', 'ozzzorrrrrqozzzo', '.oooorrzrrqoooo.', '....orrrrzqo....', '....orzrrrqo....', '....olloollo....', '....ozzoozzo....', '....oooooooo....'];
const PEASANT = put(put(put([
  '......oooo......', '.....oyyyyo.....', '....oyyyyyyo....', '..oooYYYYYYooo..', '..oyyyyyyyyyyo..', ...CIV.slice(5)],
[[14, 8], [14, 9], [14, 10], [14, 11], [14, 12], [14, 13], [14, 14]], 'w'), [[13, 7], [14, 7], [15, 7], [13, 6], [15, 6], [13, 5], [15, 5]], 'x'), [[14, 6]], 'x');
const SPEAR = put(put(put(swap(CIV, { h: 'm' }), [[6, 2], [7, 2], [5, 3]], 'M'),
  [[13, 3], [13, 4], [13, 5], [13, 6], [13, 7], [13, 8], [13, 9], [13, 10], [13, 11], [13, 12], [13, 13], [13, 14]], 'w'), [[13, 0], [12, 1], [13, 1], [14, 1], [13, 2]], 'x');
const ARCHER = put(put(swap(CIV, { h: 'g' }),
  [[2, 2], [1, 3], [1, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [1, 10], [1, 11], [2, 12]], 'w'), [[2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 10], [2, 11]], 'M');

// Walk frames: stand, left foot up, right foot up. Every figure has its legs in columns 4-11 of rows 13-15.
function steps(rows) {
  const lift = x0 => { const a = rows.map(r => r.split('')); a[13][x0 + 1] = a[13][x0 + 2] = a[14][x0 + 1]; for (let x = x0; x < x0 + 4; x++) { a[14][x] = 'o'; a[15][x] = '.'; } return a.map(r => r.join('')); };
  return [rows, lift(4), lift(8)];
}
function grid(rows, pal) {
  const c = mk(rows[0].length, rows.length), g = c.getContext('2d');
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') { g.fillStyle = pal[r[x]]; g.fillRect(x, y, 1, 1); } });
  return c;
}

// ---------- painted sprites: flat rects, then an automatic 1 px outline around the silhouette ----------
function paint(w, h, fn, outline = true) {
  const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true });
  const r = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.round(ww), Math.round(hh)); };
  fn(r, w, h);
  if (outline) {
    const img = g.getImageData(0, 0, w, h), d = img.data, solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0, add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push(x, y);
    g.fillStyle = O;
    for (let i = 0; i < add.length; i += 2) g.fillRect(add[i], add[i + 1], 1, 1);
  }
  return c;
}
// Filled ellipse, one rect per row.
const ell = (r, cx, cy, rx, ry, col) => { for (let y = -ry; y <= ry; y++) { const hw = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.01))); if (hw > 0 || ry === 0) r(cx - hw, cy + y, hw * 2 + 1, 1, col); } };
const line = (r, x0, y0, x1, y1, col, t = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) r(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, t, t, col); };

function roof(r, x, y, w, h, col) {
  r(x, y, w, h, col); r(x, y, w, 2, tone(col, 1.25));
  for (let yy = y + 4, i = 0; yy < y + h - 1; yy += 4, i++) {
    r(x, yy, w, 1, tone(col, 0.72));
    for (let xx = x + 2 + (i % 2) * 3; xx < x + w - 1; xx += 6) r(xx, yy + 1, 1, Math.min(3, y + h - 2 - yy), tone(col, 0.84));
  }
  r(x, y + h - 1, w, 1, tone(col, 0.55));
}
function bricks(r, x, y, w, h, col) {
  for (let yy = y + 3, i = 0; yy < y + h; yy += 4, i++) {
    r(x, yy, w, 1, col);
    for (let xx = x + 3 + (i % 2) * 4; xx < x + w - 1; xx += 8) r(xx, yy + 1, 1, Math.min(3, y + h - 1 - yy), col);
  }
}
function wallStone(r, x, y, w, h, col = STONE) {
  r(x, y, w, h, col); r(x + w - 3, y, 3, h, tone(col, 0.82)); r(x, y, w, 1, tone(col, 0.7)); bricks(r, x, y, w, h, tone(col, 0.7));
}
function wallPlaster(r, x, y, w, h) {
  r(x, y, w, h, CREAM); r(x, y, w, 2, CREAM_D); r(x, y, 2, h, TIMBER); r(x + w - 2, y, 2, h, TIMBER); r(x, y + h - 2, w, 2, '#b8a47a');
}
function wallWood(r, x, y, w, h, col = TIMBER) {
  r(x, y, w, h, col); r(x, y, w, 1, tone(col, 0.65));
  for (let xx = x + 3; xx < x + w; xx += 4) r(xx, y + 1, 1, h - 1, tone(col, 0.72));
  r(x, y + h - 1, w, 1, tone(col, 0.72));
}
function wallLog(r, x, y, w, h) {
  r(x, y, w, h, TIMBER_L);
  for (let yy = y + 2; yy < y + h; yy += 3) r(x, yy, w, 1, TIMBER_D);
  r(x, y, 2, h, PALE); r(x + w - 2, y, 2, h, TIMBER);
}
const door = (r, x, y, w, h, col = TIMBER_D) => { r(x - 1, y - 1, w + 2, h + 1, O); r(x, y, w, h, col); r(x + w - 2, y + (h >> 1), 1, 1, GOLD); };
const win = (r, x, y, w = 3, h = 4) => { r(x - 1, y - 1, w + 2, h + 2, O); r(x, y, w, h, GLASS); r(x, y, w, 1, GLASS_L); };
const chimney = (r, x, y, h = 7) => { r(x, y, 4, h, STONE); r(x, y, 4, 1, STONE_LL); r(x + 3, y + 1, 1, h - 1, STONE_D); };
const flag = (r, x, y, h, col) => { r(x, y, 1, h, TIMBER_D); r(x + 1, y, 5, 3, col); r(x + 1, y + 3, 3, 1, tone(col, 0.75)); };
const crate = (r, x, y, s = 6) => { r(x, y, s, s, TIMBER_L); r(x, y, s, 1, PALE); r(x, y + s - 1, s, 1, TIMBER_D); r(x, y, 1, s, TIMBER_D); r(x + s - 1, y, 1, s, TIMBER_D); line(r, x + 1, y + 1, x + s - 2, y + s - 2, TIMBER); };
const barrel = (r, x, y) => { r(x, y, 5, 7, TIMBER); r(x + 1, y, 3, 1, PALE); r(x, y + 2, 5, 1, STONE_DD); r(x, y + 5, 5, 1, STONE_DD); r(x + 4, y + 1, 1, 6, TIMBER_D); };
const sack = (r, x, y) => { ell(r, x + 3, y + 3, 3, 3, '#cdb891'); r(x + 2, y - 1, 2, 2, '#a8946a'); r(x + 4, y + 2, 2, 4, '#a8946a'); };
const logs = (r, x, y, w = 10) => { for (let i = 0; i < 3; i++) { const yy = y - i * 3, xx = x + i, ww = w - i * 2; r(xx, yy, ww, 3, TIMBER); r(xx, yy, ww, 1, TIMBER_L); r(xx, yy, 2, 3, PALE); r(xx, yy + 1, 1, 1, TIMBER); } };
const wheel = (r, cx, cy, rad = 3) => { ell(r, cx, cy, rad, rad, TIMBER_D); ell(r, cx, cy, rad - 1, rad - 1, PALE); r(cx - rad + 1, cy, rad * 2 - 1, 1, TIMBER_D); r(cx, cy - rad + 1, 1, rad * 2 - 1, TIMBER_D); r(cx, cy, 1, 1, STONE_DD); };
const tent = (r, cx, y, h, C, CD) => {
  for (let i = 0; i < h; i++) { r(cx - i * 0.8, y + i, 2 + i * 1.6, 1, C); r(cx + 1, y + i, 1 + i * 0.8, 1, CD); }
  for (let i = 0; i < h / 2; i++) r(cx - i * 0.35, y + h / 2 + i, 2 + i * 0.7, 1, DARK);
};
const block = (r, x, y, w = 6, h = 4) => { r(x - 1, y - 1, w + 2, h + 2, O); r(x, y, w, h, STONE_LL); r(x, y + h - 1, w, 1, STONE_D); };
// A roofed building: roof slab on top, wall below, centered door.
function hut(r, x, y, w, h, o = {}) {
  const rh = o.roofH || Math.round(h * 0.48), wy = y + rh, wh = h - rh;
  roof(r, x, y, w, rh, o.roof || TILE_ROOF);
  (o.wall || wallPlaster)(r, x + 2, wy, w - 4, wh, o.wallCol);
  if (o.door !== false) { const dw = o.doorW || 5; door(r, x + ((w - dw) >> 1), y + h - (o.doorH || 8), dw, o.doorH || 8); }
  if (o.win !== false && w >= 26) { win(r, x + 6, wy + 3); win(r, x + w - 9, wy + 3); }
}

const BUILD = {
  townhall(r) {
    flag(r, 23, 1, 8, RED);
    roof(r, 15, 5, 18, 8, tone(GOLD, 1.15)); roof(r, 2, 11, 44, 14, GOLD);
    wallStone(r, 4, 25, 40, 22, STONE_L);
    door(r, 20, 32, 8, 15); r(24, 32, 1, 15, O); r(19, 30, 10, 2, STONE_D);
    for (const x of [8, 14, 31, 37]) win(r, x, 30, 3, 6);
    r(17, 46, 14, 1, STONE_LL);
  },
  camp(r) {
    tent(r, 15, 7, 16, '#e0d3ae', '#b8a87e');
    flag(r, 15, 1, 6, GREEN_L);
    r(22, 28, 7, 2, TIMBER_D); r(24, 24, 3, 4, FIRE); r(25, 25, 1, 3, FIRE_L);
    crate(r, 2, 24, 5);
  },
  house(r) { chimney(r, 21, 1); hut(r, 1, 5, 30, 26); },
  stonehouse(r) { chimney(r, 5, 1, 8); chimney(r, 22, 1, 8); hut(r, 1, 5, 30, 26, { roof: SLATE, wall: wallStone, wallCol: STONE_L }); },
  farm(r) {
    r(1, 1, 62, 62, SOIL);
    for (let y = 3; y < 62; y += 5) { r(2, y, 60, 3, HAY); r(2, y, 60, 1, tone(HAY, 1.3)); for (let x = 4 + (y % 2) * 3; x < 61; x += 6) r(x, y + 1, 1, 2, HAY_D); }
    r(1, 1, 28, 27, SOIL);
    hut(r, 3, 3, 23, 23, { roof: '#9a3a2a', wall: wallWood, wallCol: '#a5482e', win: false, doorW: 7, doorH: 9 });
    r(11, 17, 7, 1, CREAM); line(r, 11, 18, 17, 25, CREAM); line(r, 17, 18, 11, 25, CREAM);
  },
  fishery(r) {
    r(1, 18, 30, 13, WATER); for (const [x, y] of [[3, 21], [14, 23], [24, 20], [8, 27], [20, 28]]) r(x, y, 4, 1, WATER_L);
    r(2, 15, 28, 5, TIMBER_L); for (let x = 5; x < 30; x += 5) r(x, 15, 1, 5, TIMBER); r(2, 19, 28, 1, TIMBER_D);
    for (const x of [3, 15, 27]) r(x, 20, 2, 4, TIMBER_D);
    hut(r, 3, 2, 18, 14, { roof: '#3f7a8a', wall: wallWood, win: false, doorH: 6, doorW: 4 });
    r(23, 6, 1, 9, TIMBER_D); r(28, 6, 1, 9, TIMBER_D); r(23, 6, 6, 1, TIMBER_D);
    for (const x of [24, 26]) { r(x, 8, 2, 4, '#9ab4c4'); r(x, 12, 2, 1, '#6a8494'); }
    r(18, 24, 10, 4, TIMBER); r(19, 24, 8, 2, PALE);
  },
  hunter(r) {
    roof(r, 1, 4, 30, 11, '#5f6e3c'); wallLog(r, 3, 15, 26, 16);
    door(r, 13, 23, 6, 8);
    r(15, 18, 2, 3, BONE); for (const [x, y] of [[13, 17], [12, 16], [12, 15], [14, 16], [18, 17], [19, 16], [19, 15], [17, 16]]) r(x, y, 1, 1, BONE);
    r(5, 19, 5, 6, '#a8703c'); r(6, 20, 3, 4, '#c98a4e'); r(22, 19, 5, 6, '#a8703c'); r(23, 20, 3, 4, '#c98a4e');
  },
  granary(r) {
    roof(r, 1, 2, 46, 12, HAY_D); wallWood(r, 3, 14, 42, 17, TIMBER_L);
    door(r, 19, 18, 10, 13); r(24, 18, 1, 13, O);
    r(22, 15, 4, 2, HAY); sack(r, 6, 24); sack(r, 11, 25); sack(r, 34, 25); sack(r, 39, 24);
  },
  woodcutter(r) {
    hut(r, 1, 5, 17, 26, { roof: WOOD_ROOF, wall: wallWood, win: false });
    logs(r, 20, 28, 11);
    r(21, 12, 6, 4, TIMBER_L); r(21, 12, 6, 1, PALE); line(r, 27, 6, 24, 11, TIMBER_D); r(27, 5, 3, 3, IRON); r(29, 5, 1, 3, STEEL);
  },
  quarry(r) {
    r(1, 1, 46, 46, STONE_L); r(5, 5, 38, 38, STONE); r(10, 10, 28, 28, STONE_D); r(16, 16, 17, 17, STONE_DD);
    for (const [x, y, w] of [[5, 5, 38], [10, 10, 28], [16, 16, 17]]) { r(x, y, w, 1, O); r(x, y, 1, w, O); r(x + 1, y + w - 1, w - 1, 1, STONE_LL); }
    bricks(r, 1, 1, 46, 4, STONE_D); bricks(r, 16, 17, 17, 16, '#5a554e');
    for (const [x, y] of [[33, 34], [7, 36], [36, 7]]) { r(x - 1, y - 1, 8, 6, O); r(x, y, 6, 4, STONE_LL); r(x, y + 3, 6, 1, STONE_D); }
    line(r, 2, 22, 15, 26, TIMBER_L, 2); r(20, 22, 2, 5, TIMBER_D); r(18, 21, 6, 2, IRON);
  },
  mine(r) {
    const R = '#8a7a66';
    ell(r, 23, 26, 21, 20, R); ell(r, 20, 20, 14, 11, tone(R, 1.2)); r(3, 36, 42, 9, tone(R, 0.8));
    for (const [x, y, w] of [[6, 24, 5], [34, 18, 6], [11, 12, 4], [36, 30, 5], [27, 9, 5]]) { r(x, y, w, 3, tone(R, 0.72)); r(x, y, w, 1, tone(R, 1.35)); }
    r(15, 20, 18, 26, O); r(17, 23, 14, 23, DARK);
    r(15, 22, 3, 24, TIMBER); r(30, 22, 3, 24, TIMBER); r(14, 19, 20, 4, TIMBER_L); r(14, 19, 20, 1, PALE);
    r(20, 34, 1, 12, IRON); r(27, 34, 1, 12, IRON); for (let y = 36; y < 46; y += 3) r(19, y, 10, 1, TIMBER_D);
    r(35, 38, 10, 6, TIMBER); r(35, 38, 10, 1, PALE); for (const [x, y] of [[36, 36], [39, 35], [42, 36]]) r(x, y, 2, 2, ORE); wheel(r, 37, 45, 1); wheel(r, 42, 45, 1);
  },
  coalpit(r) {
    r(1, 1, 46, 46, DIRT_D); r(6, 9, 36, 34, '#4a443e'); r(10, 13, 28, 26, COAL);
    r(6, 9, 36, 1, O); r(6, 9, 1, 34, O);
    for (const [x, y] of [[13, 16], [22, 20], [30, 15], [17, 28], [27, 31], [33, 25], [12, 34]]) { r(x, y, 3, 2, '#4c4a56'); r(x, y, 1, 1, '#7a7888'); }
    r(3, 3, 3, 14, TIMBER); r(42, 3, 3, 14, TIMBER); r(2, 2, 44, 3, TIMBER_L); r(2, 2, 44, 1, PALE);
    r(23, 5, 1, 6, CREAM_D); r(21, 11, 6, 5, TIMBER_D); r(21, 11, 6, 1, COAL);
    ell(r, 38, 40, 6, 4, COAL); r(35, 38, 3, 1, '#7a7888');
  },
  stockpile(r) {
    r(1, 1, 46, 46, DIRT); for (const [x, y] of [[8, 20], [25, 24], [40, 28], [17, 42], [33, 14]]) r(x, y, 3, 1, DIRT_D);
    for (const [x, y, w, h] of [[1, 1, 46, 2], [1, 45, 46, 2], [1, 1, 2, 46], [45, 1, 2, 46]]) r(x, y, w, h, TIMBER);
    for (let i = 1; i < 47; i += 9) { r(i, 1, 2, 2, PALE); r(i, 45, 2, 2, PALE); r(1, i, 2, 2, PALE); r(45, i, 2, 2, PALE); }
    logs(r, 5, 14, 13); crate(r, 22, 5, 7); crate(r, 30, 5, 7); crate(r, 26, 12, 7); barrel(r, 39, 5); barrel(r, 39, 14);
    for (const [x, y] of [[5, 34], [11, 34], [8, 30]]) { r(x - 1, y - 1, 7, 6, O); r(x, y, 5, 4, STONE_LL); r(x, y + 3, 5, 1, STONE_D); }
    sack(r, 21, 28); sack(r, 27, 30); sack(r, 22, 35);
    ell(r, 38, 37, 5, 4, STONE_DD); for (const [x, y] of [[35, 36], [39, 34], [41, 38]]) r(x, y, 2, 2, ORE);
  },
  charcoal(r) {
    const E = '#6a5a48';
    r(11, 8, 9, 3, E); r(8, 11, 15, 4, E); r(5, 15, 21, 6, E); r(4, 21, 23, 9, E);
    r(11, 8, 9, 1, tone(E, 1.3)); r(8, 11, 3, 1, tone(E, 1.3)); r(5, 15, 3, 1, tone(E, 1.3)); r(4, 27, 23, 3, tone(E, 0.75));
    for (const [x, y] of [[9, 24], [19, 22], [14, 17]]) { r(x - 1, y - 1, 4, 4, O); r(x, y, 2, 2, FIRE); r(x, y, 1, 1, FIRE_L); }
    r(14, 3, 4, 3, STONE_LL); r(18, 1, 3, 2, STONE_LL);
    logs(r, 21, 29, 10);
  },
  smelter(r) {
    r(26, 2, 9, 13, STONE_D); r(25, 1, 11, 3, STONE); r(26, 2, 9, 1, STONE_LL); bricks(r, 26, 4, 9, 11, STONE_DD);
    r(4, 12, 33, 4, STONE_LL); wallStone(r, 6, 16, 29, 30);
    r(13, 29, 14, 17, O); r(15, 31, 10, 15, FIRE); r(17, 35, 6, 11, FIRE_L); r(15, 31, 10, 1, '#c05a10');
    r(1, 34, 6, 10, TIMBER_D); r(1, 34, 6, 1, TIMBER_L); r(6, 38, 3, 2, STONE_DD);
    ell(r, 41, 41, 5, 4, STONE_DD); for (const [x, y] of [[38, 40], [42, 38], [43, 42]]) r(x, y, 2, 2, ORE);
    r(37, 30, 6, 2, IRON); r(38, 27, 6, 2, IRON); r(37, 30, 6, 1, STEEL); r(38, 27, 6, 1, STEEL);
  },
  library(r) {
    const M = '#d8d2c4';
    roof(r, 1, 2, 46, 8, '#5a5f8a'); r(2, 10, 44, 3, M); r(2, 12, 44, 1, STONE_D);
    r(3, 13, 42, 17, STONE_L); r(3, 29, 42, 2, M);
    for (const x of [5, 13, 32, 40]) { r(x, 13, 3, 16, '#f0ebe0'); r(x + 2, 13, 1, 16, STONE); }
    door(r, 20, 18, 8, 12); r(24, 18, 1, 12, O); win(r, 9, 17, 3, 6); win(r, 36, 17, 3, 6);
    r(21, 4, 6, 4, CREAM); r(24, 4, 1, 4, TIMBER_D); r(21, 4, 6, 1, RED);
  },
  fletcher(r) {
    hut(r, 1, 5, 22, 26, { roof: WOOD_ROOF, win: false });
    r(24, 9, 7, 8, PALE); r(27, 6, 1, 3, TIMBER_D);
    for (const [x, y] of [[26, 10], [28, 11], [29, 12], [29, 13], [28, 14], [26, 15]]) r(x, y, 1, 1, TIMBER_D); r(26, 11, 1, 4, STONE_DD);
    for (const x of [25, 27, 29]) { r(x, 20, 1, 10, TIMBER_L); r(x, 19, 1, 2, STEEL); r(x, 28, 1, 2, RED); }
  },
  poleturner(r) {
    hut(r, 1, 5, 22, 26, { roof: WOOD_ROOF, wall: wallWood, win: false });
    for (const x of [25, 27, 29]) { r(x, 8, 1, 22, TIMBER_L); r(x - 1, 5, 3, 2, STEEL); r(x, 3, 1, 2, STEEL); }
    r(24, 22, 7, 1, TIMBER_D);
  },
  blacksmith(r) {
    chimney(r, 4, 0, 9);
    hut(r, 1, 6, 22, 25, { roof: SLATE, wall: wallStone, win: false });
    r(4, 20, 6, 6, O); r(5, 21, 4, 4, FIRE); r(6, 22, 2, 3, FIRE_L);
    r(24, 23, 7, 2, '#4a4e56'); r(24, 23, 7, 1, IRON); r(26, 25, 3, 3, '#4a4e56'); r(24, 28, 7, 2, '#3a3e46');
    line(r, 29, 15, 26, 20, TIMBER_L); r(28, 13, 3, 3, IRON);
  },
  armory(r) {
    hut(r, 1, 3, 30, 28, { roof: BLUE_ROOF, wall: wallStone, win: false, doorW: 6 });
    for (const x of [6, 22]) { r(x - 1, 18, 6, 8, O); r(x, 19, 4, 5, BLUE); r(x + 1, 24, 2, 1, BLUE); r(x + 1, 20, 2, 2, GOLD); }
  },
  stable(r) {
    roof(r, 1, 2, 46, 14, BLUE_ROOF); wallWood(r, 3, 16, 42, 24);
    for (const x of [6, 19, 32]) {
      r(x - 1, 20, 11, 20, O); r(x, 21, 9, 19, DARK); r(x, 33, 9, 7, TIMBER_L); r(x, 33, 9, 1, PALE);
      r(x + 3, 25, 4, 8, '#8a5a34'); r(x + 3, 23, 1, 2, '#8a5a34'); r(x + 6, 23, 1, 2, '#8a5a34'); r(x + 4, 30, 2, 3, '#6b4423'); r(x + 3, 27, 1, 1, O); r(x + 6, 27, 1, 1, O);
    }
    r(1, 42, 46, 2, TIMBER_L); for (let x = 1; x < 47; x += 9) r(x, 40, 2, 7, TIMBER);
    r(37, 42, 8, 5, HAY); r(37, 42, 8, 1, tone(HAY, 1.3)); r(40, 42, 1, 5, HAY_D);
  },
  barracks(r) {
    flag(r, 23, 0, 7, BLUE);
    roof(r, 1, 6, 46, 15, BLUE_ROOF); wallStone(r, 3, 21, 42, 26);
    door(r, 19, 33, 10, 14); r(24, 33, 1, 14, O);
    line(r, 20, 24, 27, 31, STEEL); line(r, 27, 24, 20, 31, STEEL); r(20, 30, 2, 2, GOLD); r(26, 30, 2, 2, GOLD);
    for (const x of [8, 36]) { r(x - 1, 25, 6, 13, O); r(x, 26, 4, 11, BLUE); r(x, 30, 4, 2, GOLD); r(x + 1, 37, 2, 1, BLUE); }
    r(14, 28, 2, 6, DARK); r(32, 28, 2, 6, DARK);
  },
  cartdepot(r) {
    roof(r, 1, 3, 46, 10, WOOD_ROOF); r(5, 13, 38, 12, '#4a3a2a'); r(5, 13, 38, 2, DARK);
    r(3, 13, 3, 18, TIMBER); r(42, 13, 3, 18, TIMBER); r(23, 13, 2, 8, TIMBER);
    r(5, 25, 38, 6, DIRT); r(5, 25, 38, 1, DIRT_D);
    r(11, 19, 18, 6, TIMBER_L); r(11, 19, 18, 1, PALE); r(11, 24, 18, 1, TIMBER_D); r(29, 21, 6, 1, TIMBER_D);
    wheel(r, 15, 26, 3); wheel(r, 25, 26, 3); wheel(r, 37, 25, 4);
  },
  wall(r) {
    r(0, 0, 16, 16, O); r(1, 1, 14, 5, TIMBER_L); r(1, 6, 14, 9, '#7a5a3a');
    for (const x of [5, 10]) r(x, 1, 1, 14, O); r(1, 5, 14, 1, '#5a4028'); for (const x of [2, 7, 12]) r(x, 2, 2, 2, PALE);
  },
  swall(r) {
    r(0, 0, 16, 16, O); r(1, 1, 14, 5, STONE_LL); r(1, 6, 14, 9, STONE); r(1, 5, 14, 1, STONE_DD);
    r(1, 10, 14, 1, STONE_DD); for (const [x, y] of [[5, 6], [11, 6], [8, 11], [3, 11], [13, 11]]) r(x, y, 1, 4, STONE_DD); for (const x of [4, 9]) r(x, 1, 1, 4, STONE_D);
  },
  gate(r) {
    r(0, 0, 16, 16, O); r(1, 1, 14, 14, TIMBER_L); r(1, 1, 14, 1, PALE); r(3, 4, 10, 11, O);
    r(4, 5, 4, 10, TIMBER_D); r(8, 5, 4, 10, TIMBER_D); r(8, 5, 1, 10, O); r(4, 7, 8, 1, IRON); r(4, 12, 8, 1, IRON); r(7, 10, 1, 1, GOLD); r(9, 10, 1, 1, GOLD);
  },
  sgate(r) {
    r(0, 0, 16, 16, O); r(1, 1, 14, 14, STONE); r(1, 1, 14, 3, STONE_LL); r(12, 4, 3, 11, STONE_D); r(3, 5, 10, 10, O); r(4, 4, 8, 1, O);
    r(4, 6, 8, 9, DARK); for (const x of [5, 7, 9, 11]) r(x, 6, 1, 9, IRON); r(4, 9, 8, 1, IRON); r(4, 13, 8, 1, IRON);
  },
  tower(r) {
    roof(r, 3, 2, 26, 7, WOOD_ROOF);
    r(5, 9, 2, 3, TIMBER); r(25, 9, 2, 3, TIMBER); r(15, 9, 2, 3, TIMBER);
    r(2, 12, 28, 6, TIMBER_L); r(2, 12, 28, 1, PALE); r(2, 17, 28, 1, TIMBER_D); for (let x = 6; x < 30; x += 5) r(x, 13, 1, 4, TIMBER);
    r(6, 18, 3, 13, TIMBER); r(23, 18, 3, 13, TIMBER); line(r, 9, 19, 22, 29, TIMBER_D); line(r, 22, 19, 9, 29, TIMBER_D);
    r(13, 18, 1, 13, PALE); r(18, 18, 1, 13, PALE); for (let y = 20; y < 31; y += 3) r(13, y, 6, 1, PALE);
  },
  lookout(r) {
    flag(r, 7, 0, 5, RED);
    r(2, 5, 12, 3, TIMBER_L); r(2, 5, 12, 1, PALE); r(4, 8, 2, 8, TIMBER); r(10, 8, 2, 8, TIMBER); line(r, 6, 9, 9, 14, TIMBER_D); r(4, 12, 8, 1, TIMBER_D);
  },
  stower(r) {
    wallStone(r, 6, 10, 20, 21); r(4, 4, 24, 7, STONE_L); r(4, 9, 24, 2, '#8e887c');
    for (const x of [4, 11, 18, 25]) { r(x, 1, 3, 4, STONE_LL); r(x + 2, 2, 1, 3, STONE); }
    r(14, 16, 4, 8, O); r(15, 17, 2, 6, DARK); door(r, 13, 26, 6, 5);
  },
  trap(r) {
    r(1, 1, 14, 14, '#4a3f33'); r(2, 2, 12, 12, '#3a3028');
    for (const [x, y] of [[3, 3], [8, 2], [12, 4], [5, 7], [10, 8], [3, 11], [8, 12], [12, 11]]) { r(x, y, 1, 1, STEEL); r(x, y + 1, 1, 2, IRON); }
  },
  ditch(r) { r(0, 0, 16, 16, '#6e5a3e'); r(2, 2, 12, 12, '#4a3a26'); r(3, 4, 10, 9, '#3a2c1c'); r(2, 2, 12, 1, '#2e2216'); r(2, 13, 12, 1, '#8a7450'); },
  catapult(r) {
    r(3, 22, 26, 4, TIMBER); r(3, 22, 26, 1, TIMBER_L); wheel(r, 7, 26, 3); wheel(r, 24, 26, 3);
    r(14, 9, 3, 14, TIMBER_D); line(r, 9, 22, 14, 12, TIMBER_D, 2); line(r, 21, 22, 16, 12, TIMBER_D, 2);
    line(r, 5, 19, 25, 6, TIMBER_L, 2); r(23, 3, 6, 4, TIMBER_D); r(24, 1, 4, 3, STONE_L); r(24, 1, 4, 1, STONE_LL);
    r(2, 17, 6, 5, STONE_D); r(2, 17, 6, 1, STONE_L);
  },
  ballista(r) {
    r(7, 25, 18, 3, TIMBER_D); wheel(r, 8, 28, 2); wheel(r, 23, 28, 2); r(14, 18, 4, 8, TIMBER_D);
    r(13, 5, 6, 20, TIMBER); r(13, 5, 2, 20, TIMBER_L);
    r(3, 9, 26, 3, TIMBER_L); r(3, 9, 26, 1, PALE); r(2, 11, 3, 4, TIMBER_L); r(27, 11, 3, 4, TIMBER_L);
    line(r, 3, 15, 15, 21, CREAM); line(r, 28, 15, 16, 21, CREAM);
    r(15, 1, 2, 20, IRON); r(14, 2, 4, 2, STEEL); r(15, 0, 2, 2, STEEL);
  },
  watermill(r) {
    r(27, 37, 20, 10, WATER); for (const [x, y] of [[29, 40], [38, 43], [41, 39]]) r(x, y, 4, 1, WATER_L);
    chimney(r, 20, 3); hut(r, 1, 8, 28, 39);
    wheel(r, 37, 29, 10); for (const [x, y] of [[36, 17], [36, 39], [26, 28], [46, 28], [29, 21], [44, 21], [29, 36], [44, 36]]) r(x, y, 3, 3, TIMBER);
    r(36, 28, 3, 3, STONE_DD);
  },
  sawmill(r) {
    hut(r, 1, 3, 30, 28, { roof: WOOD_ROOF, wall: wallWood, win: false, doorW: 8 });
    r(33, 22, 13, 3, TIMBER_L); r(34, 25, 2, 6, TIMBER); r(43, 25, 2, 6, TIMBER);
    ell(r, 39, 18, 5, 5, IRON); ell(r, 39, 18, 3, 3, STEEL); r(39, 18, 1, 1, O); for (const [x, y] of [[39, 12], [33, 18], [45, 18], [35, 14], [43, 14]]) r(x, y, 1, 1, STEEL);
    r(33, 5, 13, 2, PALE); r(34, 7, 11, 2, TIMBER_L); r(33, 9, 13, 2, PALE);
  },
  masonyard(r) {
    r(1, 1, 46, 46, '#c2b9a4'); for (const [x, y] of [[26, 22], [12, 27], [40, 14], [30, 43]]) r(x, y, 3, 1, STONE);
    hut(r, 3, 3, 20, 21, { roof: SLATE, wall: wallStone, win: false });
    for (const [x, y] of [[27, 5], [34, 5], [41, 5], [30, 10], [37, 10]]) block(r, x, y, 5, 4);
    wallStone(r, 4, 34, 22, 11, STONE_L); r(4, 30, 8, 4, STONE_L); r(4, 30, 8, 1, STONE_LL); r(3, 29, 10, 1, O); r(12, 30, 1, 4, O); r(12, 33, 15, 1, O);
    r(34, 18, 2, 27, TIMBER); r(30, 44, 10, 2, TIMBER_D); line(r, 35, 18, 44, 22, TIMBER_L, 2); line(r, 35, 26, 40, 20, TIMBER_D);
    r(44, 24, 1, 9, CREAM_D); block(r, 41, 33, 6, 5);
  },
  peatcutter(r) {
    hut(r, 1, 5, 17, 26, { roof: '#5f6e3c', wall: wallWood, win: false });
    const P = '#4e4232', PL = '#6e5e48';
    for (const [x, y, w] of [[20, 24, 11], [21, 20, 9], [22, 16, 7]]) { r(x, y, w, 4, P); r(x, y, w, 1, PL); for (let xx = x + 3; xx < x + w; xx += 4) r(xx, y + 1, 1, 3, '#3a3024'); }
    r(20, 28, 11, 3, '#2e2618'); r(20, 28, 11, 1, '#5a6e5a');
    r(26, 4, 1, 8, TIMBER_L); r(25, 3, 3, 1, TIMBER); r(25, 12, 3, 3, IRON);
  },
  forge(r) {
    for (const x of [7, 35]) { r(x, 1, 6, 9, STONE_D); r(x - 1, 0, 8, 2, STONE); bricks(r, x, 2, 6, 7, STONE_DD); }
    roof(r, 1, 8, 46, 9, SLATE); wallStone(r, 3, 17, 42, 30, STONE_D);
    r(16, 27, 16, 20, O); r(18, 29, 12, 18, FIRE); r(20, 34, 8, 13, FIRE_L); r(18, 29, 12, 1, '#c05a10');
    r(6, 37, 8, 2, IRON); r(8, 39, 4, 3, '#4a4e56'); r(6, 42, 8, 2, '#3a3e46');
    for (const x of [35, 38, 41]) { r(x, 24, 1, 14, STEEL); r(x - 1, 38, 3, 1, GOLD); r(x, 39, 1, 3, TIMBER); }
  },
  crypt(r) {
    for (let i = 0; i < 8; i++) r(8 + i * 2, 15 - i, 32 - i * 4, 1, i ? STONE_L : STONE_D);
    wallStone(r, 8, 16, 32, 31); r(6, 45, 36, 2, STONE_LL);
    for (const x of [11, 34]) { r(x, 17, 3, 28, STONE_LL); r(x + 2, 17, 1, 28, STONE); }
    r(18, 25, 12, 21, O); r(20, 27, 8, 19, DARK); r(22, 34, 1, 1, '#6fe0a0'); r(25, 34, 1, 1, '#6fe0a0');
    r(22, 18, 4, 3, BONE); r(23, 21, 2, 1, BONE); r(22, 19, 1, 1, O); r(25, 19, 1, 1, O);
    for (const [x, y] of [[2, 37], [42, 39]]) { r(x, y, 4, 8, STONE_D); r(x + 1, y - 1, 2, 1, STONE_D); r(x + 1, y + 2, 2, 1, STONE_LL); r(x + 1, y + 1, 1, 4, STONE_LL); }
  },
  warcamp(r) {
    flag(r, 23, 1, 12, BLUE);
    tent(r, 12, 8, 20, '#a04a34', '#7a3424'); tent(r, 34, 10, 20, '#a04a34', '#7a3424');
    r(20, 43, 8, 2, TIMBER_D); r(22, 38, 4, 5, FIRE); r(23, 40, 2, 3, FIRE_L);
    r(2, 38, 13, 1, TIMBER_D); r(2, 38, 1, 8, TIMBER); r(14, 38, 1, 8, TIMBER);
    for (const x of [5, 8, 11]) { r(x, 33, 1, 12, TIMBER_L); r(x, 31, 1, 2, STEEL); }
    for (const x of [34, 40]) { r(x - 1, 37, 6, 8, O); r(x, 38, 4, 5, BLUE); r(x + 1, 43, 2, 1, BLUE); r(x + 1, 39, 2, 2, GOLD); }
  },
  nest(r) {
    const F = '#6a1c1c', FL = '#8e3030', FD = '#461010';
    ell(r, 32, 36, 29, 24, F); ell(r, 30, 30, 22, 16, FL); ell(r, 27, 26, 12, 7, '#a84040');
    for (let i = 0; i < 7; i++) r(4 + i * 8, 52 + (i % 2) * 2, 5, 8 - (i % 3) * 2, F);
    r(4, 46, 56, 10, FD); ell(r, 32, 48, 28, 9, FD); ell(r, 32, 44, 26, 8, F);
    for (const [x, y, rx, ry] of [[20, 30, 5, 4], [41, 26, 6, 4], [32, 43, 7, 5], [50, 41, 4, 3], [12, 43, 4, 3]]) { ell(r, x, y, rx + 1, ry + 1, FD); ell(r, x, y, rx, ry, '#1a0606'); r(x - rx + 1, y + ry - 1, rx * 2 - 1, 1, '#c02020'); }
    for (const [x, y] of [[26, 36], [45, 33], [16, 36], [38, 50], [24, 49]]) { r(x, y, 4, 1, BONE); r(x - 1, y - 1, 1, 3, BONE); r(x + 4, y - 1, 1, 3, BONE); }
    for (const [x, y] of [[14, 22], [50, 24], [31, 14], [8, 34], [56, 36]]) { line(r, x, y, x + (x < 32 ? -3 : 3), y - 7, F, 2); r(x + (x < 32 ? -3 : 3), y - 8, 1, 2, FL); }
  },
};
const FLAT = { ditch: true, wall: true, swall: true, gate: true, sgate: true }; // drawn edge to edge, no added outline

// Horse and rider (24 x 24, centered in a 32 px cell so every cell is a whole number of tiles), facing right; `f` picks the leg frame.
function horse(r, f, H, t, scout) {
  const HD = tone(H, 0.72), HL = tone(H, 1.2);
  r(1, 12, 3, 6, HD); r(4, 11, 14, 7, H); r(4, 11, 14, 1, HL); r(4, 16, 14, 2, HD);
  r(16, 7, 4, 6, H); r(18, 5, 5, 4, H); r(21, 8, 2, 2, H); r(18, 3, 1, 2, H); r(15, 6, 2, 6, HD); r(20, 6, 1, 1, O); r(22, 9, 1, 1, O);
  const legs = f ? [[5, 18, 3], [9, 18, 4], [13, 18, 4], [17, 18, 3]] : [[4, 18, 4], [8, 18, 3], [14, 18, 3], [16, 18, 4]];
  legs.forEach(([x, y, h], i) => { r(x, y, 2, h, i % 2 ? HD : H); r(x, y + h, 2, 1, O); });
  r(8, 10, 6, 2, '#7a4a22');
  r(9, 5, 5, 6, t); r(13, 5, 1, 6, tone(t, 0.75)); r(10, 11, 2, 4, '#5a4632'); r(10, 15, 3, 1, '#3a2a1e');
  r(9, 2, 5, 3, '#f0c49a'); r(12, 3, 1, 1, O);
  if (scout) { r(8, 0, 6, 2, '#3f8f6a'); r(8, 2, 1, 3, '#3f8f6a'); r(13, 6, 3, 2, t); }
  else { r(9, 0, 5, 2, IRON); r(10, 0, 2, 1, '#dfe6ec'); r(13, 6, 3, 2, t); r(16, 0, 1, 7, STEEL); r(15, 6, 3, 1, '#7a4a22'); }
}
function cart(r) {
  r(4, 13, 20, 8, TIMBER_L); r(4, 13, 20, 1, PALE); r(4, 20, 20, 1, TIMBER_D); for (let x = 8; x < 24; x += 5) r(x, 14, 1, 6, TIMBER);
  r(24, 16, 6, 1, TIMBER_D); r(24, 19, 6, 1, TIMBER_D); r(29, 16, 1, 4, TIMBER_D);
  wheel(r, 9, 23, 4); wheel(r, 20, 23, 4);
}

// Builds the atlas. Unit tunics take each unit's color from the active style, so sprites follow it.
export function buildSprites(defs) {
  const UD = defs.units, RC = defs.balance.resourceColors, list = []; // [group, key, canvas]
  const add = (group, key, cv) => list.push([group, key, cv]);
  const team = k => ({ ...PAL, t: UD[k].color, T: tone(UD[k].color, 0.75) });
  const zpal = (skin, k) => ({ ...PAL, z: skin, Z: tone(skin, 0.78), r: tone(UD.zombie.color, k), q: tone(UD.zombie.color, k * 0.7) });
  const figs = { civ: [CIV, team('civ')], peasant: [PEASANT, team('peasant')], sword: [SWORD, team('sword')], spear: [SPEAR, team('spear')], archer: [ARCHER, team('archer')],
    zombie: [ZOMBIE, zpal('#8fae6a', 1)], zombieDormant: [ZOMBIE, { ...zpal('#7f8a78', 0.5), R: '#8a4a4a' }] };
  for (const k in figs) add('u', k, steps(figs[k][0]).map(rows => grid(rows, figs[k][1])));
  for (const [k, H] of [['cav', '#8a5a34'], ['scout', '#d8d0c0']]) { const fr = f => paint(32, 32, r => horse((x, y, w, h, c) => r(x + 4, y + 6, w, h, c), f, H, UD[k].color, k === 'scout')); add('u', k, [fr(0), fr(1), fr(0)]); }
  const c0 = paint(32, 32, cart); add('u', 'cart', [c0, c0, c0]);
  for (const res in RC) {
    const c = RC[res], L = tone(c, 1.35);
    add('load', res, [paint(16, 16, r => { r(3, 1, 10, 3, c); r(3, 1, 10, 1, L); r(3, 3, 10, 1, tone(c, 0.75)); })]); // drawn 4 px above the carrier
    add('cargo', res, [paint(32, 32, r => { r(6, 8, 16, 5, c); r(8, 6, 12, 2, c); r(8, 6, 12, 1, L); r(6, 8, 2, 1, L); })]);
  }
  for (const type in defs.buildings.types) {
    // a type with no painter of its own gets a plain hut with its category color as the roof
    const d = defs.buildings.types[type], fn = BUILD[type] || ((r, W, H) => hut(r, 1, 2, W - 2, H - 3, { roof: d.color || defs.buildings.categoryColors[d.cat], win: false, doorH: Math.min(8, H >> 2), doorW: Math.min(5, W >> 2) }));
    add('b', type, [paint(d.w * 16, d.h * 16, fn, !FLAT[type])]);
  }
  // shelf-pack: each entry is a row of frames, with a mirrored copy underneath for units
  const AW = 512, pos = []; let x = 0, y = 0, rowH = 0;
  for (const [group, , frames] of list) {
    const w = frames[0].width * frames.length, h = frames[0].height * (group === 'u' ? 2 : 1);
    if (x + w > AW) { x = 0; y += rowH; rowH = 0; }
    pos.push([x, y]); x += w; rowH = Math.max(rowH, h);
  }
  // `cells` lists the unit and load cells, which the renderer rescales per zoom level
  const cv = mk(AW, y + rowH), g = cv.getContext('2d'), S = { cv, u: {}, load: {}, cargo: {}, b: {}, cells: [] };
  list.forEach(([group, key, frames], i) => {
    const [px, py] = pos[i], c = frames[0].width, h = frames[0].height;
    frames.forEach((f, n) => {
      g.drawImage(f, px + n * c, py);
      if (group === 'u') { g.save(); g.translate(px + n * c + c, py + h); g.scale(-1, 1); g.drawImage(f, 0, 0); g.restore(); }
    });
    S[group][key] = { x: px, y: py, c, w: c, h, t: c / 16 };
    if (group !== 'b') S.cells.push(px, py, c * frames.length, group === 'u' ? h * 2 : h);
  });
  return S;
}
