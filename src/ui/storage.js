// Browser save slots in localStorage. Saves are gzip-compressed and base64-encoded
// (about 20–100 KB each), with a small index of metadata so the load list needs no decoding.
const IDX = 'sotd.saves', KEY = id => `sotd.save.${id}`;
export const MAX_MANUAL = 10;

const hasGzip = typeof CompressionStream === 'function';

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function readIndex() {
  try { const v = JSON.parse(localStorage.getItem(IDX) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeIndex(list) { localStorage.setItem(IDX, JSON.stringify(list)); }

// Newest first.
export function listSaves() { return readIndex().sort((a, b) => b.time - a.time); }

export async function putSave(meta, json) {
  const data = hasGzip ? 'z:' + toB64(await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'))) : 'j:' + json;
  const entry = { ...meta, time: Date.now(), size: data.length };
  const store = () => {
    localStorage.setItem(KEY(entry.id), data);
    writeIndex([...readIndex().filter(e => e.id !== entry.id), entry]);
  };
  try { store(); } catch (e) {
    // Out of space: drop the oldest manual saves (never the one being written) and retry once.
    const old = readIndex().filter(e => !e.auto && e.id !== entry.id).sort((a, b) => a.time - b.time);
    if (!old.length) throw e;
    for (const o of old.slice(0, Math.max(1, Math.ceil(old.length / 2)))) deleteSave(o.id);
    store();
  }
  // Keep at most MAX_MANUAL manual saves.
  const manual = readIndex().filter(e => !e.auto).sort((a, b) => b.time - a.time);
  for (const o of manual.slice(MAX_MANUAL)) deleteSave(o.id);
  return entry;
}

export async function getSave(id) {
  const data = localStorage.getItem(KEY(id));
  if (!data) throw new Error('This save is missing from browser storage.');
  if (data.startsWith('j:')) return data.slice(2);
  if (!hasGzip) throw new Error('This browser cannot read compressed saves.');
  return new TextDecoder().decode(await pipe(fromB64(data.slice(2)), new DecompressionStream('gzip')));
}

export function deleteSave(id) {
  try { localStorage.removeItem(KEY(id)); writeIndex(readIndex().filter(e => e.id !== id)); } catch { /* storage unavailable */ }
}

export function storageAvailable() {
  try { localStorage.setItem('sotd.test', '1'); localStorage.removeItem('sotd.test'); return true; } catch { return false; }
}
