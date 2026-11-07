// Synthesized alert tones (Web Audio). No music.
let ac = null;
const last = {};
export function unlockAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; }
}
function tone(freq, start, dur, type = 'sine', vol = 0.12, slide = 0) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime + start);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ac.currentTime + start + dur);
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, ac.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0005, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start); o.stop(ac.currentTime + start + dur + 0.05);
}
const SOUNDS = {
  wave: () => { tone(110, 0, 0.5, 'sawtooth', 0.1); tone(98, 0.55, 0.5, 'sawtooth', 0.1); tone(82, 1.1, 0.8, 'sawtooth', 0.1); },
  attack: () => { tone(660, 0, 0.12, 'square', 0.06); tone(660, 0.18, 0.12, 'square', 0.06); },
  built: () => { tone(880, 0, 0.18, 'sine', 0.06); },
  research: () => { tone(523, 0, 0.2); tone(659, 0.12, 0.2); tone(784, 0.24, 0.35); },
  lost: () => { tone(220, 0, 0.6, 'triangle', 0.12, -80); tone(147, 0.6, 1.2, 'triangle', 0.12, -60); },
  won: () => { tone(523, 0, 0.25); tone(659, 0.2, 0.25); tone(784, 0.4, 0.25); tone(1046, 0.6, 0.6); },
};
const GAP = { wave: 2, attack: 6, built: 1.5, research: 1, lost: 5, won: 5 };
export function play(kind) {
  if (!ac || !SOUNDS[kind]) return;
  const now = performance.now() / 1000;
  if (last[kind] && now - last[kind] < GAP[kind]) return;
  last[kind] = now;
  SOUNDS[kind]();
}
