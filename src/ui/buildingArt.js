// Hand-drawn flat SVG pictures for the build bar (48x48 viewBox).
const SH = '<ellipse cx="24" cy="42.5" rx="19" ry="3.2" fill="rgba(0,0,0,.3)"/>';
const DOOR = '#4A3220', WIN = '#4A3220', TAN = '#C8A97E', ROOF = '#8B4A2B', WOOD = '#8B5A2B', LOGEND = '#D9B07A';
const STONE = '#A39E94', STONE_D = '#7C776F', SLATE = '#4E5560', STEEL = '#4F6D8A', STEEL_L = '#7D9AB8', GOLD = '#D4AF37';
const GREEN = '#3E6B34', GREEN_L = '#5C8A44', METAL = '#D5DCE4', FIRE = '#F08A24', FIRE_L = '#FFD25A', CLOTH = '#C0392B';

const hut = (x, y, w, h, wall, roof, door = true) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${wall}"/>` +
  `<path d="M${x - 2} ${y + 1}L${x + w / 2} ${y - h * 0.65}L${x + w + 2} ${y + 1}Z" fill="${roof}"/>` +
  (door ? `<rect x="${x + w / 2 - 2.5}" y="${y + h - 8}" width="5" height="8" fill="${DOOR}"/>` : '');
const tree = (x, y, s = 1) =>
  `<rect x="${x - 1.2 * s}" y="${y}" width="${2.4 * s}" height="${6 * s}" fill="#5A3A1E"/>` +
  `<path d="M${x} ${y - 14 * s}L${x + 7 * s} ${y + 1}H${x - 7 * s}Z" fill="${GREEN}"/>` +
  `<path d="M${x} ${y - 14 * s}L${x + 4 * s} ${y - 5 * s}H${x - 4 * s}Z" fill="${GREEN_L}"/>`;
const bricks = (x, y, w, h, c = STONE_D) => {
  let s = '';
  for (let r = 0, yy = y + 4; yy < y + h; yy += 4, r++) {
    s += `<path d="M${x} ${yy}H${x + w}" stroke="${c}" stroke-width=".7"/>`;
    for (let xx = x + (r % 2 ? 3 : 6); xx < x + w; xx += 6) s += `<path d="M${xx} ${yy - 4}V${yy}" stroke="${c}" stroke-width=".7"/>`;
  }
  return s;
};
const crenels = (x, y, w, c, n) => {
  let s = '';
  const step = w / (n * 2 - 1);
  for (let i = 0; i < n; i++) s += `<rect x="${x + i * step * 2}" y="${y - 4}" width="${step}" height="4" fill="${c}"/>`;
  return s;
};
const workshop = item => SH + hut(5, 20, 22, 21, '#B5AFA3', '#6B5A4A') + item;
const sword = (x1, y1, x2, y2, guard = STEEL) => {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const gx = x1 + ux * 5, gy = y1 + uy * 5;
  return `<path d="M${gx} ${gy}L${x2} ${y2}" stroke="${METAL}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M${gx - uy * 4} ${gy + ux * 4}L${gx + uy * 4} ${gy - ux * 4}" stroke="${guard}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M${x1} ${y1}L${gx} ${gy}" stroke="${WOOD}" stroke-width="2.6" stroke-linecap="round"/>`;
};
const spear = (x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const bx = x2 - ux * 6, by = y2 - uy * 6;
  return `<path d="M${x1} ${y1}L${bx} ${by}" stroke="#B08A5A" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M${x2} ${y2}L${bx - uy * 2.6} ${by + ux * 2.6}L${bx + uy * 2.6} ${by - ux * 2.6}Z" fill="#2BB3C0"/>`;
};
const arrow = (x, y1, y2) =>
  `<path d="M${x} ${y1}V${y2}" stroke="${LOGEND}" stroke-width="1.4"/><path d="M${x - 2} ${y1 + 3}L${x} ${y1}L${x + 2} ${y1 + 3}" fill="${METAL}"/>` +
  `<path d="M${x - 2.2} ${y2 - 4}L${x} ${y2 - 1.5}L${x + 2.2} ${y2 - 4}V${y2}L${x} ${y2 + 1.5}L${x - 2.2} ${y2}Z" fill="${CLOTH}"/>`;
const wheel = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#5A3A1E"/><circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="none" stroke="${LOGEND}" stroke-width="1"/><circle cx="${x}" cy="${y}" r="1" fill="${LOGEND}"/>`;
const stake = (x, top, bot, c = WOOD) => `<path d="M${x - 2.4} ${bot}V${top + 3}L${x} ${top}L${x + 2.4} ${top + 3}V${bot}Z" fill="${c}"/>`;

const ART = {
  townhall: SH + `<rect x="8" y="22" width="32" height="19" fill="#E2C77A"/><path d="M5 23L24 10L43 23Z" fill="${GOLD}"/>` +
    `<path d="M20 41V34a4 4 0 0 1 8 0v7Z" fill="${DOOR}"/><rect x="11" y="27" width="5" height="5" fill="${WIN}"/><rect x="32" y="27" width="5" height="5" fill="${WIN}"/>` +
    `<path d="M24 10V2" stroke="#3A2A10" stroke-width="1.2"/><path d="M24 2h8l-2.5 2.5 2.5 2.5h-8Z" fill="${CLOTH}"/>`,
  house: SH + hut(12, 22, 24, 19, TAN, ROOF) + `<rect x="14.5" y="25.5" width="5" height="4" fill="${WIN}"/><rect x="28.5" y="25.5" width="5" height="4" fill="${WIN}"/><rect x="29" y="10" width="3.5" height="8" fill="#7A6A5A"/>`,
  stonehouse: SH + `<rect x="9" y="21" width="30" height="20" fill="${STONE}"/>` + bricks(9, 21, 30, 20) +
    `<path d="M6 22L24 8L42 22Z" fill="${SLATE}"/><rect x="21.5" y="32" width="5" height="9" fill="${DOOR}"/><rect x="12" y="25" width="5" height="5" fill="${WIN}"/><rect x="31" y="25" width="5" height="5" fill="${WIN}"/>`,
  farm: SH + `<path d="M2 41L8 22H46V41Z" fill="#C9B458"/>` +
    [25, 29, 33, 37].map(y => `<path d="M${2 + (41 - y) * 0.32} ${y}H46" stroke="#7E9B3A" stroke-width="2"/>`).join('') +
    `<rect x="6" y="11" width="13" height="11" fill="#A0412D"/><path d="M4 12L12.5 4L21 12Z" fill="#6B2A1E"/><path d="M10 22V15h5v7" fill="#5A2A1A"/><path d="M10 15l5 7M15 15l-5 7" stroke="${LOGEND}" stroke-width=".8"/>`,
  fishery: SH + `<rect x="2" y="30" width="44" height="12" rx="2" fill="#3B6E8F"/>` +
    `<path d="M5 35q3-2 6 0t6 0 6 0M26 39q3-2 6 0t6 0" stroke="#7FB0CF" stroke-width="1" fill="none"/>` +
    `<path d="M12 28V38M26 28V38" stroke="${WOOD}" stroke-width="1.6"/>` + hut(9, 17, 20, 11, TAN, ROOF) +
    `<path d="M33 34q5-4 9 0q-4 4-9 0Z" fill="${METAL}"/><path d="M42 34l3.5-2.5v5Z" fill="${METAL}"/>`,
  hunter: SH + tree(9, 30, 1.1) + `<rect x="18" y="24" width="24" height="17" fill="${WOOD}"/>` +
    [28, 32, 36].map(y => `<path d="M18 ${y}H42" stroke="#6B4320" stroke-width=".9"/>`).join('') +
    `<path d="M15 25L30 13L45 25Z" fill="#5A3A1E"/><rect x="27.5" y="33" width="5" height="8" fill="#3A2412"/>` +
    `<path d="M30 30v-5M30 27l-4-3M26 24l-1-3M30 27l4-3M34 24l1-3" stroke="#E6E2D8" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  granary: SH + `<rect x="12" y="17" width="22" height="24" fill="#D9C08A"/><path d="M10 18L23 6L36 18Z" fill="${ROOF}"/>` +
    `<path d="M12 24H34M12 31H34" stroke="#B89A5E" stroke-width="1"/><rect x="20.5" y="33" width="5" height="8" fill="${DOOR}"/>` +
    `<path d="M40 41V29" stroke="#C9A43A" stroke-width="1.2"/>` + [[38, 31], [42, 31], [38, 35], [42, 35], [40, 27.5]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.3" ry="2.2" fill="#E0C055"/>`).join(''),
  library: SH + `<rect x="7" y="21" width="34" height="20" fill="#BDB6A6"/><path d="M5 22L24 10L43 22Z" fill="#8E8576"/>` +
    [10, 17, 28, 35].map(x => `<rect x="${x}" y="23" width="3.5" height="16" fill="#E6E2D8"/>`).join('') +
    `<rect x="5" y="39" width="38" height="2.5" fill="#8E8576"/><path d="M20.5 41V31h7v10Z" fill="${DOOR}"/>` +
    `<path d="M19 16.5h10v4H19Z" fill="#6B4A8A"/><path d="M24 16.5v4" stroke="#E6E2D8" stroke-width=".8"/>`,
  cartdepot: SH + `<rect x="3" y="15" width="26" height="22" fill="#9A9186"/><path d="M1 16L16 7L31 16Z" fill="#6B5A4A"/><rect x="8" y="22" width="16" height="15" fill="#3A3028"/>` +
    `<path d="M24 31H46L44 24H26Z" fill="${WOOD}"/><path d="M26 27H44" stroke="#6B4320" stroke-width=".9"/>` + wheel(29, 36, 5) + wheel(41, 36, 5) +
    `<path d="M24 29L18 33" stroke="${WOOD}" stroke-width="1.6"/>`,
  woodcutter: SH + tree(12, 28, 1.2) + tree(23, 24, 0.9) +
    `<circle cx="31" cy="38" r="4" fill="${LOGEND}"/><circle cx="39" cy="38" r="4" fill="${LOGEND}"/><circle cx="35" cy="31.5" r="4" fill="${LOGEND}"/>` +
    [[31, 38], [39, 38], [35, 31.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="none" stroke="${WOOD}" stroke-width=".8"/>`).join('') +
    `<path d="M41 14L33 27" stroke="${WOOD}" stroke-width="2" stroke-linecap="round"/><path d="M38 12.5l6 3.5-2 3-5.5-2.5Z" fill="${METAL}"/>`,
  quarry: SH + `<path d="M3 41V31H14V23H26V15H45V41Z" fill="${STONE}"/>` +
    `<path d="M3 31H14V23H26V15H45" stroke="#C8C3B8" stroke-width="1.4" fill="none"/>` +
    `<path d="M9 31V41M20 23V41M14 34H26M33 15V30M26 26H45M38 30V41" stroke="${STONE_D}" stroke-width=".8"/>` +
    `<path d="M6 12L18 20" stroke="${WOOD}" stroke-width="2" stroke-linecap="round"/><path d="M5 17Q7 9 14 8" stroke="${METAL}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  mine: SH + `<path d="M2 41Q24 4 46 41Z" fill="#7E7A74"/>` +
    `<circle cx="10" cy="34" r="1.6" fill="#B5651D"/><circle cx="37" cy="31" r="1.8" fill="#B5651D"/><circle cx="33" cy="22" r="1.4" fill="#B5651D"/><circle cx="14" cy="25" r="1.3" fill="#B5651D"/>` +
    `<path d="M17 41V30a7 7 0 0 1 14 0V41Z" fill="#1E1A16"/><path d="M16 41V28H32V41M15 27.5H33" stroke="${WOOD}" stroke-width="2" fill="none"/>` +
    `<path d="M19 41L29 41" stroke="#555" stroke-width="1"/>`,
  coalpit: SH + `<path d="M3 41Q12 23 24 21Q36 23 45 41Z" fill="#2B2826"/>` +
    [[14, 34, 3], [22, 28, 3.5], [31, 33, 3], [38, 38, 2.5], [9, 39, 2.5], [26, 37, 2.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#3E3A37"/>`).join('') +
    `<path d="M33 14L28 29" stroke="${WOOD}" stroke-width="2" stroke-linecap="round"/><path d="M26 27l5 2-1.5 5-5-2Z" fill="${METAL}"/>`,
  stockpile: SH + `<rect x="4" y="27" width="13" height="14" fill="#A0693A"/><path d="M4 27l13 14M17 27L4 41" stroke="#6B4320" stroke-width="1"/>` +
    `<rect x="10" y="15" width="12" height="12" fill="#B07A45"/><path d="M10 15l12 12M22 15L10 27" stroke="#6B4320" stroke-width="1"/>` +
    `<rect x="19" y="33" width="26" height="8" fill="${WOOD}"/><circle cx="44" cy="37" r="4" fill="${LOGEND}"/><rect x="21" y="26" width="22" height="7" fill="${WOOD}"/><circle cx="42" cy="29.5" r="3.5" fill="${LOGEND}"/>` +
    `<path d="M28 17h9l2 9H26Z" fill="${STONE}"/>`,
  charcoal: SH + `<path d="M7 41A17 17 0 0 1 41 41Z" fill="#5A4A3A"/><path d="M11 41A13 13 0 0 1 37 41" fill="none" stroke="#6E5C48" stroke-width="1"/>` +
    `<path d="M19 41V35a5 5 0 0 1 10 0v6Z" fill="${FIRE}"/><path d="M21.5 41V37a2.5 2.5 0 0 1 5 0v4Z" fill="${FIRE_L}"/>` +
    `<circle cx="24" cy="18" r="4" fill="#9A968E" opacity=".8"/><circle cx="28" cy="12" r="3.5" fill="#B5B1A9" opacity=".7"/><circle cx="25" cy="6" r="3" fill="#CFCBC3" opacity=".6"/>`,
  smelter: SH + `<rect x="8" y="20" width="24" height="21" fill="#6E6A64"/>` + bricks(8, 20, 24, 21, '#57534E') +
    `<rect x="24" y="5" width="6" height="16" fill="#57534E"/><path d="M13 41V31a7 7 0 0 1 14 0V41Z" fill="${FIRE}"/><path d="M16 41V33a4 4 0 0 1 8 0v8Z" fill="${FIRE_L}"/>` +
    `<circle cx="27" cy="3" r="2.5" fill="#9A968E" opacity=".7"/>` +
    `<path d="M33 41L35 36H43L45 41Z" fill="#9AA6B2"/><path d="M35 36L36 34H42L43 36Z" fill="${METAL}"/>`,
  fletcher: workshop(`<path d="M33 16C44 22 44 34 33 40" stroke="#C49A6C" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M33 16V40" stroke="#E6E2D8" stroke-width=".8"/>` + arrow(38, 18, 38) + arrow(42, 20, 40)),
  poleturner: workshop(spear(30, 42, 44, 12) + spear(44, 42, 31, 14)),
  blacksmith: workshop(`<path d="M30 33H46L44 36H40V39H44V41H32V39H36V36H32Z" fill="#3A3A3A"/><path d="M30 33H46" stroke="#5A5A5A" stroke-width="1"/>` +
    `<path d="M36 16L42 28" stroke="${WOOD}" stroke-width="2" stroke-linecap="round"/><rect x="31" y="12" width="9" height="5" rx="1" transform="rotate(-27 35.5 14.5)" fill="#6E6A64"/>` +
    `<circle cx="44" cy="30" r="1" fill="${FIRE_L}"/><circle cx="46" cy="27" r=".8" fill="${FIRE}"/>`),
  armory: SH + `<rect x="7" y="18" width="34" height="23" fill="${STEEL}"/>` + crenels(7, 18, 34, STEEL, 5) +
    sword(12, 38, 34, 16, GOLD) + sword(36, 38, 14, 16, GOLD) +
    `<path d="M24 22h7v8c0 4-3.5 6-3.5 6S24 34 24 30Z" transform="translate(-3.5 2)" fill="#B23A2E" stroke="${GOLD}" stroke-width="1"/>`,
  stable: SH + `<rect x="5" y="20" width="32" height="21" fill="#A0412D"/><path d="M2 21L21 9L40 21Z" fill="#6B2A1E"/>` +
    `<rect x="9" y="27" width="10" height="14" fill="#5A2A1A"/><path d="M9 27l10 14M19 27L9 41" stroke="${LOGEND}" stroke-width=".9"/>` +
    `<rect x="23" y="27" width="10" height="7" fill="#5A2A1A"/>` +
    `<path d="M37 26C33 33 35 41 41 41S49 33 45 26" stroke="#B08050" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  barracks: SH + `<rect x="5" y="19" width="38" height="22" fill="${STEEL}"/>` + crenels(5, 19, 38, STEEL, 6) +
    `<rect x="5" y="19" width="38" height="3" fill="${STEEL_L}"/><path d="M20 41V33a4 4 0 0 1 8 0v8Z" fill="#26384A"/>` +
    sword(10, 37, 18, 25, GOLD) + sword(38, 37, 30, 25, GOLD) +
    `<path d="M24 15V3" stroke="#26384A" stroke-width="1.3"/><path d="M24 3h8l-2.5 2.5 2.5 2.5h-8Z" fill="${CLOTH}"/>`,
  wall: SH + [8, 14, 20, 26, 32, 38].map((x, i) => stake(x, 14 + (i % 2) * 2, 41)).join('') +
    `<path d="M5 24H42M5 34H42" stroke="#5A3A1E" stroke-width="1.6"/>`,
  swall: SH + `<rect x="4" y="18" width="40" height="23" fill="${STONE}"/>` + crenels(4, 18, 40, STONE, 5) + bricks(4, 18, 40, 23),
  gate: SH + [7, 13, 35, 41].map(x => stake(x, 12, 41)).join('') +
    `<path d="M16 41V22a8 8 0 0 1 16 0V41Z" fill="#8A6E4B"/><path d="M24 14V41M16 28H32" stroke="#5A3A1E" stroke-width="1.2"/>` +
    `<circle cx="22" cy="33" r=".9" fill="${METAL}"/><circle cx="26" cy="33" r=".9" fill="${METAL}"/>`,
  sgate: SH + `<rect x="4" y="16" width="40" height="25" fill="#9A968E"/>` + crenels(4, 16, 40, '#9A968E', 5) + bricks(4, 16, 40, 25, '#77736C') +
    `<path d="M15 41V26a9 9 0 0 1 18 0V41Z" fill="#2A2622"/>` +
    [18, 22, 26, 30].map(x => `<path d="M${x} 19V41" stroke="#77736C" stroke-width="1.1"/>`).join('') + `<path d="M15 30H33M15 35H33" stroke="#77736C" stroke-width="1.1"/>`,
  tower: SH + `<path d="M13 41L17 17M35 41L31 17M14.5 33H33.5M16 25H32M14.5 33L32 25M33.5 33L16 25" stroke="${WOOD}" stroke-width="1.8" fill="none"/>` +
    `<rect x="12" y="12" width="24" height="6" fill="${WOOD}"/>` + [13, 18, 23, 28, 33].map(x => `<rect x="${x}" y="8" width="2" height="4" fill="${WOOD}"/>`).join('') +
    `<path d="M10 8L24 1L38 8Z" fill="#5A3A1E"/><rect x="20" y="13" width="2" height="2" fill="#7DD3FC"/><rect x="26" y="13" width="2" height="2" fill="#7DD3FC"/>`,
  stower: SH + `<rect x="13" y="11" width="22" height="30" fill="${STONE}"/>` + bricks(13, 11, 22, 30) + crenels(11, 11, 26, STONE, 4) +
    `<path d="M21 23v-3a3 3 0 0 1 6 0v3Z" fill="#2A2622"/><path d="M20 41V35a4 4 0 0 1 8 0v6Z" fill="${DOOR}"/><path d="M24 7V1" stroke="#3A2A10" stroke-width="1"/><path d="M24 1h6l-2 1.8 2 1.8h-6Z" fill="${CLOTH}"/>`,
  trap: SH + `<rect x="4" y="34" width="40" height="6" fill="${WOOD}"/><path d="M4 37H44" stroke="#6B4320" stroke-width=".8"/>` +
    [8, 15, 22, 29, 36, 42].map((x, i) => `<path d="M${x - 2.5} 34L${x} ${20 + (i % 2) * 5}L${x + 2.5} 34Z" fill="${METAL}" stroke="#8A939C" stroke-width=".6"/>`).join(''),
  ditch: SH + `<path d="M2 26H46V41H2Z" fill="#7A6A4F"/><path d="M8 26L13 37H35L40 26Z" fill="#3A3024"/><path d="M13 37H35" stroke="#2A2218" stroke-width="2"/>` +
    `<path d="M2 26H8M40 26H46" stroke="#9C8A68" stroke-width="2"/><circle cx="5" cy="31" r="1" fill="#5A4A3A"/><circle cx="43" cy="33" r="1.2" fill="#5A4A3A"/>`,
  catapult: SH + `<path d="M6 34H40" stroke="${WOOD}" stroke-width="3.5"/><path d="M14 34L22 20L30 34" stroke="${WOOD}" stroke-width="2.4" fill="none"/>` +
    `<path d="M10 31L40 9" stroke="#6B4320" stroke-width="2.6" stroke-linecap="round"/><path d="M36 6a5 5 0 0 0 7 7Z" fill="#5A3A1E"/><circle cx="40" cy="8" r="3" fill="${STONE}"/>` +
    `<path d="M22 20L26 23" stroke="#5A3A1E" stroke-width="2"/>` + wheel(11, 36, 5) + wheel(35, 36, 5),
  ballista: SH + `<path d="M24 26L14 41M24 26L34 41M24 26V41" stroke="${WOOD}" stroke-width="2.2"/>` +
    `<path d="M6 21Q24 8 42 21" stroke="#6B4320" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M6 21L24 25L42 21" stroke="#E6E2D8" stroke-width=".9" fill="none"/>` +
    `<path d="M24 31V6" stroke="${WOOD}" stroke-width="3"/><path d="M20 9L24 2L28 9Z" fill="${METAL}"/><rect x="21" y="23" width="6" height="7" fill="#5A3A1E"/>`,
  road: SH + `<path d="M17 41L21 7H27L31 41Z" fill="#9C8A68"/><path d="M2 41L17 41L21 7L2 7Z M46 41L31 41L27 7L46 7Z" fill="#6E8F3A"/>` +
    `<path d="M22 14v3M25 22v3M22 30v3M26 36v2" stroke="#7E6E50" stroke-width="1.2"/>`,
  sroad: SH + `<path d="M15 41L20 7H28L33 41Z" fill="#B8B2A6"/><path d="M2 41L15 41L20 7L2 7Z M46 41L33 41L28 7L46 7Z" fill="#6E8F3A"/>` +
    [[19, 35], [25, 35], [20, 28], [26, 28], [21, 21], [26, 21], [22, 14], [25, 14]].map(([x, y]) => `<rect x="${x - 2.4}" y="${y - 2.6}" width="4.8" height="5.2" rx="1" fill="#D6D0C4" stroke="#8E887C" stroke-width=".6"/>`).join(''),
  found: SH + `<path d="M6 41L18 19L30 41Z" fill="#D9C8A0"/><path d="M18 19V41M18 41L14 34" stroke="#A8946A" stroke-width="1"/><path d="M15 41L18 33L21 41Z" fill="#5A3A1E"/>` +
    `<path d="M36 41V8" stroke="#5A3A1E" stroke-width="1.6"/><path d="M36 8h10l-3 3.5 3 3.5H36Z" fill="${GOLD}"/>` +
    `<circle cx="42" cy="39" r="2.4" fill="#F2D16B"/><circle cx="31" cy="39" r="2.4" fill="#F2D16B"/>`,
};

export function buildingArt(type) {
  return `<svg class="bart" viewBox="0 0 48 48" aria-hidden="true">${ART[type] || SH + '<rect x="10" y="14" width="28" height="27" fill="#8E8E8E"/>'}</svg>`;
}
