// Small inline SVG icons for resources (16x16 viewBox), drawn in the flat style of the game.
const LIGHT = '#E6E2D8', STEEL = '#D5DCE4', SHAFT = '#B08A5A';

const ICONS = {
  food: c => `<path d="M8 15V4.5" stroke="${c}" stroke-width="1.3"/>` +
    [[6.2, 5.2, -30], [9.8, 5.2, 30], [6.2, 8.4, -30], [9.8, 8.4, 30], [6.2, 11.6, -30], [9.8, 11.6, 30]]
      .map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="1.4" ry="2.2" transform="rotate(${a} ${x} ${y})" fill="${c}"/>`).join('') +
    `<ellipse cx="8" cy="2.6" rx="1.2" ry="2" fill="${c}"/>`,
  wood: c => `<rect x="1" y="4.5" width="12.5" height="7" rx="1.2" fill="${c}"/>` +
    `<ellipse cx="13.2" cy="8" rx="2.3" ry="3.5" fill="#D9B07A"/><ellipse cx="13.2" cy="8" rx="1" ry="1.6" fill="none" stroke="${c}" stroke-width=".8"/>` +
    `<path d="M3 6.5H9M4.5 9.5H11" stroke="#6B4320" stroke-width=".8"/>`,
  stone: c => `<path d="M1.5 12.5L3.5 6.5L8 3L12.5 4.5L14.5 11L10.5 14H4.5Z" fill="${c}"/>` +
    `<path d="M8 3L7 8L3.5 6.5M7 8L10.5 14M7 8L12.5 4.5" stroke="#7E7E78" stroke-width=".8" fill="none"/>`,
  ore: c => `<path d="M1.5 12.5L3.5 6.5L8 3L12.5 4.5L14.5 11L10.5 14H4.5Z" fill="#7E7A74"/>` +
    `<circle cx="5.5" cy="9.5" r="1.5" fill="${c}"/><circle cx="9.5" cy="6.5" r="1.3" fill="${c}"/><circle cx="10.5" cy="11" r="1.2" fill="${c}"/>`,
  fuel: () => `<path d="M8 1.2C9.2 4.4 12.8 6 12.8 10.2a4.8 4.8 0 0 1-9.6 0c0-2.1 1.2-3.4 2.1-4.2.2 1.6.9 2.4 1.7 2.7C7.4 6.6 7 3.9 8 1.2Z" fill="#E8742A"/>` +
    `<path d="M8 8.8c.7 1.1 2 1.7 2 3.2a2 2 0 0 1-4 0c0-1.1.9-1.7 2-3.2Z" fill="#FFD25A"/>`,
  iron: c => `<path d="M1 12.5L3.8 7H12.2L15 12.5Z" fill="${c}"/><path d="M3.8 7L5.3 4.5H10.7L12.2 7Z" fill="${STEEL}"/>`,
  bows: c => `<path d="M4.5 1.5C12 4 12 12 4.5 14.5" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
    `<path d="M4.5 1.5V14.5" stroke="${LIGHT}" stroke-width=".7"/>` +
    `<path d="M1.5 8H12.5M12.5 8L10.3 6.4M12.5 8L10.3 9.6" stroke="${LIGHT}" stroke-width=".9" fill="none" stroke-linecap="round"/>`,
  spears: c => `<path d="M2 14L10.5 5.5" stroke="${SHAFT}" stroke-width="1.5" stroke-linecap="round"/><path d="M15 1L9.2 3.7L12.3 6.8Z" fill="${c}"/>`,
  swords: c => `<path d="M6 10L14.5 1.5" stroke="${STEEL}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M3.5 8.5L7.5 12.5" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/><path d="M1.8 14.2L5 11" stroke="#8B5A2B" stroke-width="2" stroke-linecap="round"/>`,
  horses: c => `<path d="M4.2 2.5C1.2 8.5 3 14 8 14S14.8 8.5 11.8 2.5" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
    `<circle cx="3.6" cy="7" r=".6" fill="${LIGHT}"/><circle cx="12.4" cy="7" r=".6" fill="${LIGHT}"/><circle cx="4.6" cy="11" r=".6" fill="${LIGHT}"/><circle cx="11.4" cy="11" r=".6" fill="${LIGHT}"/>`,
};

// Icon colors: the resource palette, lifted where the swatch is too dark to read on the dark UI.
const ICON_COLOR = { wood: '#A0693A', horses: '#B08050', fuel: '#E8742A' };

export function resIcon(res, colors, size = 14) {
  const c = ICON_COLOR[res] || (colors && colors[res]) || '#999';
  const body = ICONS[res] ? ICONS[res](c) : `<rect x="3" y="3" width="10" height="10" fill="${c}"/>`;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

export function costHtml(cost, colors) {
  const e = Object.entries(cost);
  if (!e.length) return 'free';
  return e.map(([k, v]) => `<span class="cost" title="${k}">${resIcon(k, colors, 12)}${v}</span>`).join(' ');
}
