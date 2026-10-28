// Tiny WebAudio synth: no audio files, so sound works offline too.
let ctx = null; let enabled = true; let buzz = true;
export const setSoundEnabled = (b) => { enabled = b; };
export const setHapticsEnabled = (b) => { buzz = b; };
export const haptic = (ms = 15) => { try { if (buzz) navigator.vibrate?.(ms); } catch { /* unsupported */ } };

function audio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, dur, type = 'square', vol = 0.06, at = 0, to) {
  if (!enabled) return;
  const c = audio(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain(); const t = c.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
}

export const sfx = {
  roll() { [0, 0.07, 0.14, 0.21, 0.28].forEach((a, i) => tone(280 + i * 60, 0.05, 'square', 0.05, a)); },
  move() { tone(520, 0.07, 'triangle', 0.07); },
  capture() { tone(240, 0.28, 'sawtooth', 0.09, 0, 60); haptic(40); },
  home() { [523, 659, 784].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, i * 0.09)); },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.06, i * 0.11)); haptic([30, 40, 30]); },
  pop() { tone(800, 0.08, 'sine', 0.07, 0, 1200); haptic(10); },
  error() { tone(160, 0.12, 'square', 0.05); },
};
