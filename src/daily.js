// Desafío diario: mismas oleadas para todos, un intento oficial por día (UTC).
import { store } from './storage.js';

const KEY = 'invaders.daily';
const MAX_GRID = 15;

// El día cambia a la misma hora en todo el mundo (00:00 UTC = 21:00 en Argentina)
export const todayUTC = () => new Date().toISOString().slice(0, 10);
export const dailySeed = (day) => `daily-${day}`;

export function formatDay(day) {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

// Estado local del intento de hoy: null | { status: 'started' } | { status: 'done', ... }
export const dailyRecord = {
  get(day = todayUTC()) {
    const r = store.get(KEY, null);
    return r && r.day === day ? r : null;
  },
  start(day) {
    store.set(KEY, { day, status: 'started' });
  },
  finish(day, data) {
    store.set(KEY, { day, status: 'done', ...data });
  },
  update(day, data) {
    const r = this.get(day);
    if (r) store.set(KEY, { ...r, ...data });
  },
};

// Grilla de emojis por oleada: 🟩 sin recibir golpes, 🟨 con golpes, 👑 jefe derrotado, 💀 última
export function gridText(grid) {
  if (grid.length <= MAX_GRID) return grid.join('');
  return grid.slice(0, MAX_GRID - 1).join('') + `…${grid[grid.length - 1]} (+${grid.length - (MAX_GRID - 1)})`;
}

export function shareText({ day, score, wave, grid, url }) {
  return [
    `👾 Invaders Space · Desafío ${formatDay(day)}`,
    `🌊 Oleada ${wave} · ${Number(score).toLocaleString('es-AR')} pts`,
    gridText(grid),
    url,
  ].join('\n');
}

export function dailyLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('modo', 'diario');
  return u.toString();
}
