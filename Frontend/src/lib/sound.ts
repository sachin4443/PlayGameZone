/** Tiny synthesised sound effects (no audio files to download). */
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('px.muted') === '1';

export const isMuted = () => muted;
export function setMuted(value: boolean) {
  muted = value;
  localStorage.setItem('px.muted', value ? '1' : '0');
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', gain = 0.08) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

const SOUNDS = {
  roll: () => [0, 0.05, 0.1, 0.15].forEach((t, i) => tone(180 + i * 40, t, 0.05, 'square', 0.04)),
  move: () => tone(520, 0, 0.06, 'triangle', 0.06),
  kill: () => { tone(220, 0, 0.18, 'sawtooth', 0.07); tone(110, 0.1, 0.25, 'sawtooth', 0.07); },
  home: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.16, 'triangle')),
  turn: () => tone(880, 0, 0.09, 'sine', 0.05),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.28, 'triangle', 0.1)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, 'sine', 0.08)),
} as const;

export function play(name: keyof typeof SOUNDS) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    SOUNDS[name]();
  } catch {
    /* audio is optional */
  }
}
