/// WebAudio 程序合成音效, 零素材文件依赖

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

function audioCtx(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, duration: number, type: OscillatorType, gainPeak: number, delayMs = 0) {
  const c = audioCtx();
  if (!c) return;
  const t0 = c.currentTime + delayMs / 1000;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function noise(duration: number, gainPeak: number, delayMs = 0) {
  const c = audioCtx();
  if (!c) return;
  const t0 = c.currentTime + delayMs / 1000;
  const frames = Math.floor(c.sampleRate * duration);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 0x2f6282a5;
  for (let i = 0; i < frames; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 0xffffffff - 0.5) * 2 * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = gainPeak;
  src.connect(gain).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  move() {
    tone(520, 0.08, "triangle", 0.18);
    noise(0.03, 0.06);
  },
  capture() {
    tone(240, 0.14, "square", 0.14);
    noise(0.09, 0.16);
  },
  check() {
    tone(660, 0.1, "sine", 0.2);
    tone(880, 0.14, "sine", 0.2, 90);
  },
  win() {
    tone(523, 0.12, "sine", 0.2);
    tone(659, 0.12, "sine", 0.2, 110);
    tone(784, 0.2, "sine", 0.22, 220);
  },
  lose() {
    tone(330, 0.16, "sine", 0.18);
    tone(247, 0.24, "sine", 0.18, 140);
  },
  click() {
    tone(880, 0.04, "square", 0.08);
  },
};
