/** Lightweight Web Audio SFX */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem('el_sound', on ? '1' : '0'); } catch {}
}

export function isSoundEnabled() {
  try { return localStorage.getItem('el_sound') !== '0'; } catch { return enabled; }
}

function ac(): AudioContext | null {
  if (!isSoundEnabled()) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.connect(g); g.connect(c.destination);
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.start(); o.stop(c.currentTime + dur);
}

export const SFX = {
  connect: () => { tone(720, 0.1, 0.06); setTimeout(() => tone(980, 0.08, 0.04), 70); },
  disconnect: () => tone(380, 0.1, 0.05, 'triangle'),
  switch: () => { tone(520, 0.06, 0.05); tone(640, 0.05, 0.04); },
  success: () => {
    tone(523, 0.12, 0.06);
    setTimeout(() => tone(659, 0.12, 0.06), 120);
    setTimeout(() => tone(784, 0.18, 0.07), 240);
  },
  door: () => { tone(180, 0.25, 0.04, 'square'); },
  lamp: () => tone(880, 0.15, 0.03),
};
