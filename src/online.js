// Cliente del ranking online (Supabase/PostgREST) con fetch, sin librerías.
import { CONFIG } from './config.js';
import { store } from './storage.js';

const url = String(CONFIG.supabaseUrl || '').trim().replace(/\/+$/, '');
const key = String(CONFIG.supabaseKey || '').trim();

function isSecretKey(k) {
  if (k.startsWith('sb_secret_')) return true;
  if (k.startsWith('eyJ')) {
    try {
      const part = k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(part)).role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

const unsafeKey = isSecretKey(key);
if (unsafeKey) {
  console.error(
    'Invaders Space: src/config.js tiene una clave SECRETA de Supabase. ' +
      'Reemplazala por la publishable (sb_publishable_...) y rotá la secreta. Ranking desactivado.',
  );
}

export const online = { enabled: Boolean(url && key) && !unsafeKey };

export const NAME_RE = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ _.-]{2,12}$/;
export const LEAGUE_NAME_RE = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ _.!-]{3,24}$/;
export const LEAGUE_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');

function randomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Identificador anónimo de este dispositivo (no es una cuenta).
export function deviceId() {
  let id = store.get('invaders.device', null);
  if (!id) {
    id = randomUuid();
    store.set('invaders.device', id);
  }
  return id;
}

export const playerName = {
  get: () => store.get('invaders.name', ''),
  set: (n) => store.set('invaders.name', n),
};

export const league = {
  get: () => store.get('invaders.league', null),
  set: (l) => store.set('invaders.league', l ? { code: l.code, name: l.name } : null),
  clear: () => store.set('invaders.league', null),
};

export function inviteLink(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('liga', code);
  return u.toString();
}

async function rpc(fn, args, timeoutMs = 8000) {
  if (!online.enabled) throw new Error('El ranking online no está configurado');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body && (body.message || body.hint);
      throw new Error(msg || `El servidor respondió ${res.status}`);
    }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servidor tardó demasiado');
    if (e instanceof TypeError) throw new Error('Sin conexión con el ranking');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const first = (rows) => (Array.isArray(rows) ? rows[0] || null : rows);

export const api = {
  startRun: (mode = 'classic') => rpc('start_run', { p_device: deviceId(), p_mode: mode }).then(first),
  submitScore: ({ run, name, score, wave, kills, leagueCode }) =>
    rpc('submit_score', {
      p_run: run,
      p_device: deviceId(),
      p_player: name,
      p_score: score,
      p_wave: wave,
      p_kills: kills,
      p_league: leagueCode || null,
    }).then(first),
  leaderboard: (scope, leagueCode) =>
    rpc('get_leaderboard', {
      p_scope: scope,
      p_league: leagueCode || null,
      p_device: deviceId(),
      p_limit: 20,
    }),
  createLeague: (name) => rpc('create_league', { p_device: deviceId(), p_name: name }).then(first),
  getLeague: (code) => rpc('get_league', { p_code: code }).then(first),
};
