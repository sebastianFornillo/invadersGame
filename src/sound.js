// Sonido sintetizado con WebAudio: no hay archivos de audio que descargar.
import { store } from './storage.js';

let ac = null;
let master = null;
let noiseBuf = null;
let muted = store.get('invaders.muted', false);

function ensure() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.35;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function tone({ f = 440, f2 = null, d = 0.1, type = 'square', v = 0.2, delay = 0 }) {
  if (muted || !ac || ac.state !== 'running') return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + d + 0.02);
}

function noise({ d = 0.3, v = 0.3, f = 1800, f2 = 200, delay = 0 }) {
  if (muted || !ac || ac.state !== 'running') return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ac.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(f, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + d);
  const g = ac.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(filt);
  filt.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + d + 0.02);
}

const seq = (notes, step, opts) =>
  notes.forEach((f, i) => tone({ f, delay: i * step, ...opts }));

export const Sound = {
  unlock: ensure,
  get muted() {
    return muted;
  },
  toggle() {
    muted = !muted;
    store.set('invaders.muted', muted);
  },
  shoot: () => tone({ f: 980, f2: 260, d: 0.09, v: 0.07 }),
  enemyShoot: () => tone({ f: 320, f2: 110, d: 0.12, type: 'sawtooth', v: 0.04 }),
  explode: () => noise({ d: 0.28, v: 0.28, f: 2200, f2: 240 }),
  big: () => {
    noise({ d: 1.1, v: 0.5, f: 1600, f2: 60 });
    tone({ f: 90, f2: 25, d: 0.9, type: 'sine', v: 0.4 });
  },
  hurt: () => {
    noise({ d: 0.6, v: 0.45, f: 1400, f2: 80 });
    tone({ f: 420, f2: 50, d: 0.55, type: 'sawtooth', v: 0.18 });
  },
  shield: () => tone({ f: 200, f2: 900, d: 0.25, type: 'triangle', v: 0.2 }),
  power: () => seq([523, 659, 784, 1047], 0.06, { d: 0.08, type: 'triangle', v: 0.18 }),
  life: () => seq([784, 988, 1175, 1568], 0.08, { d: 0.1, v: 0.1 }),
  bossHit: () => tone({ f: 180, f2: 120, d: 0.05, v: 0.05 }),
  ufo: () => tone({ f: 620, f2: 920, d: 0.12, type: 'sine', v: 0.05 }),
  march: (i) => tone({ f: [98, 87, 82, 73][i % 4], d: 0.09, v: 0.09 }),
  select: () => {
    tone({ f: 660, d: 0.06, v: 0.1 });
    tone({ f: 990, d: 0.08, v: 0.1, delay: 0.06 });
  },
  warning: () =>
    [0, 0.35, 0.7].forEach((delay) =>
      tone({ f: 440, f2: 220, d: 0.3, type: 'sawtooth', v: 0.12, delay }),
    ),
  clear: () => seq([392, 523, 659, 784, 1047], 0.07, { d: 0.12, type: 'triangle', v: 0.16 }),
  over: () => seq([392, 330, 262, 196], 0.22, { d: 0.25, v: 0.12 }),
};
