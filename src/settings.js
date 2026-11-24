// Opciones del jugador, guardadas en el navegador.
import { store } from './storage.js';

const KEY = 'invaders.settings';
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const DEFAULTS = Object.freeze({
  volume: 80,          // 0 a 100
  shake: !reducedMotion, // temblor de pantalla
  flashes: !reducedMotion, // destellos blancos (fotosensibilidad)
  crt: true,           // líneas y viñeta estilo tubo
  vibration: true,     // sólo Android
  bigTouch: false,     // botones táctiles grandes
  leftHanded: false,   // FIRE a la izquierda
});

// Migra la opción de vibración que existía antes en su propia clave
const legacyVibration = store.get('invaders.vibrate', null);
let current = { ...DEFAULTS, ...(legacyVibration === null ? {} : { vibration: legacyVibration }), ...store.get(KEY, {}) };
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn(current));

export const settings = {
  get: (key) => current[key],
  all: () => ({ ...current }),
  set(key, value) {
    if (!(key in DEFAULTS)) return;
    current = { ...current, [key]: value };
    store.set(KEY, current);
    emit();
  },
  reset() {
    current = { ...DEFAULTS };
    store.set(KEY, current);
    emit();
  },
  // Llama fn ahora y en cada cambio
  onChange(fn) {
    listeners.add(fn);
    fn(current);
    return () => listeners.delete(fn);
  },
};
