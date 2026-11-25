/* =====================================================================
   INVADERS SPACE — v2
   Núcleo del juego (módulo ES). Sonido, almacenamiento y PWA viven
   en módulos aparte dentro de src/.
   - Loop con delta time (misma velocidad a 60, 120 o 144 Hz)
   - Estados: menú, jugando, pausa, game over
   - Oleadas con dificultad progresiva, 3 tipos de invasores, picados
   - Jefe cada 5 oleadas, OVNI misterioso, power-ups, búnkers destructibles
   - Combos, vidas extra, récords en localStorage
   - Sonido sintetizado (WebAudio), teclado, mando y controles táctiles
   ===================================================================== */
import { store } from './storage.js';
import { Sound } from './sound.js';
import {
  vibrate, setupPWA, promptInstall, toggleFullscreen, fullscreenSupported, needsIosInstallHint,
} from './platform.js';
import { online, api, league, deviceId } from './online.js';
import { ui } from './ui.js';
import { createStreams, randomSeed } from './rng.js';
import { settings } from './settings.js';
import {
  drawRock, drawJelly, drawTitan, drawVortex, drawPhoenix, rockPos, VORTEX_PULL_RADIUS,
} from './boss-art.js';
import { UPGRADES, emptyLevels, upgradeDue, offerUpgrades } from './upgrades.js';
import { createAchievements } from './achievements.js';
import { createMatch, newRoomCode, channelName, VS_CODE_RE } from './versus.js';
import { joinChannel } from './realtime.js';
import { todayUTC, dailySeed, dailyRecord, formatDay, gridText } from './daily.js';

// Modo test (?test=1): expone ganchos para los tests automáticos.
const TEST_MODE = new URLSearchParams(location.search).has('test');

// ------------------------------------------------------------------
// Constantes
// ------------------------------------------------------------------
const W = 1024, H = 576;
const TAU = Math.PI * 2;
const FONT = '"Press Start 2P", "Courier New", monospace';
const PLAYER_Y = H - 64;
const PLAYER_SPEED = 470;
const BULLET_SPEED = 760;
const CELL_W = 50, CELL_H = 44;
const INV_W = 31, INV_H = 39;
const MAX_LIVES = 6;
const EXTRA_LIFE_EVERY = 25000;

const INV_TYPES = [
  { color: '#5dffa0', points: 100, hp: 1, kind: 'basic' },
  { color: '#4fd8ff', points: 200, hp: 1, kind: 'basic' },
  { color: '#ff5fd2', points: 300, hp: 2, kind: 'basic' },
  { color: '#ff9f1c', points: 150, hp: 1, kind: 'splitter' }, // se parte en dos al morir (oleada 6+)
  { color: '#ff3b3b', points: 400, hp: 2, kind: 'laser' },    // dispara un rayo (oleada 8+)
  { color: '#ffe066', points: 50, hp: 1, kind: 'mini' },      // los que salen del divisor
  { color: '#ff8c1a', points: 80, hp: 2, kind: 'magmita' },   // crías de MAGMA (sector 2)
];
const T_SPLITTER = 3, T_LASER = 4, T_MINI = 5, T_MAGMITA = 6;
const MINI_W = 19, MINI_H = 24;

const POWERS = {
  T: { name: 'TRIPLE', color: '#ffd23f', weight: 0.32 },
  R: { name: 'RAPID', color: '#3fd0ff', weight: 0.32 },
  S: { name: 'SHIELD', color: '#7cff6b', weight: 0.26 },
  L: { name: '1UP', color: '#ff4fd8', weight: 0.10 },
};
const POWER_TIME = 10;

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Azar de la jugabilidad, con semilla (el desafío diario es igual para todos).
// Los efectos visuales siguen usando Math.random.
const STREAMS = ['fire', 'dive', 'ufo', 'drop', 'bunker', 'upgrade', 'hazard', 'boss'];

// ------------------------------------------------------------------
// Sectores: cada 5 oleadas cambia el escenario y aparece un peligro nuevo
// ------------------------------------------------------------------
const SECTORS = [
  { name: 'EARTH ORBIT', color: '#5dc1b9', bg: ['#05010f', '#0a0620', '#130a2e'] },
  { name: 'NEBULA', color: '#ff4fd8', bg: ['#0c0219', '#1b0631', '#2b0a3d'] },
  { name: 'ASTEROID BELT', color: '#d9a066', bg: ['#060407', '#120c10', '#1f140e'] },
  { name: 'BLACK HOLE', color: '#9b7bff', bg: ['#000000', '#04020a', '#0a0517'] },
  { name: 'SOLAR CORONA', color: '#ffb020', bg: ['#120302', '#260805', '#3f1206'] },
];
const SECTOR_LEN = 5;
const sectorOf = (w) => Math.min(Math.floor((w - 1) / SECTOR_LEN), SECTORS.length - 1);
const GRAVITY = 0.8; // agujero negro: tirón horizontal hacia el centro
let R = createStreams(randomSeed(), STREAMS);

// Logros (se guardan en este dispositivo)
const achievements = createAchievements({
  load: () => store.get('invaders.achievements', null),
  save: (d) => store.set('invaders.achievements', d),
  onUnlock: (a) => { ui.achievement(a); Sound.power(); },
});
window.addEventListener('pagehide', () => { achievements.flush(); leaveMatch(); });
const rr = (stream, a, b) => a + R[stream]() * (b - a);
const rpick = (stream, arr) => arr[Math.floor(R[stream]() * arr.length)];
const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function compact(arr) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
  arr.length = j;
}

// ------------------------------------------------------------------
// Canvas y escalado
// ------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------
// Sprites
// ------------------------------------------------------------------
const SPR = { ship: null, inv: [], invFlash: null, boss: null, bossFlash: null, ready: false };

function loadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function makeTinted(img, w, h, color, alpha) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (img) x.drawImage(img, 0, 0, w, h);
  else { x.fillStyle = '#fff'; x.fillRect(4, 4, w - 8, h - 8); }
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = alpha;
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  return c;
}

Promise.all([loadImage('img/spaceship.png'), loadImage('img/invader.png')]).then(([ship, inv]) => {
  SPR.ship = ship;
  SPR.inv = INV_TYPES.map((t) => makeTinted(inv, INV_W, INV_H, t.color, 0.55));
  SPR.invFlash = makeTinted(inv, INV_W, INV_H, '#ffffff', 1);
  SPR.boss = makeTinted(inv, INV_W * 3, INV_H * 3, '#ff3b5c', 0.5);
  SPR.bossFlash = makeTinted(inv, INV_W * 3, INV_H * 3, '#ffffff', 1);
  SPR.ready = true;
});

// Viñeta + scanlines pre-renderizadas (efecto CRT sutil)
const overlayCanvas = (() => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
  return c;
})();

// ------------------------------------------------------------------
// Input: teclado, mando, táctil
// ------------------------------------------------------------------
const input = {
  keys: new Set(),
  touch: { left: false, right: false, fire: false },
  padX: 0, padFire: false, padPrev: {}, padAxisPrev: 0,
  get left() { return this.keys.has('left') || this.touch.left; },
  get right() { return this.keys.has('right') || this.touch.right; },
  get fire() { return this.keys.has('fire') || this.touch.fire || this.padFire; },
  get axis() {
    const k = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    return clamp(k + this.padX, -1, 1);
  },
};

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'fire', KeyW: 'fire', ArrowUp: 'fire',
};

window.addEventListener('keydown', (e) => {
  Sound.unlock();
  const k = KEYMAP[e.code];
  if (k || e.code === 'Enter') e.preventDefault();
  if (k) input.keys.add(k);
  if (e.repeat) return;
  if (state === 'menu') {
    const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    const sel = clamp(menuSel + dir, 0, MENU_OPTS.length - 1);
    if (dir && sel !== menuSel) { menuSel = sel; Sound.march(sel); }
  }
  if (e.code === 'Enter' || e.code === 'Space') confirm();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') { Sound.toggle(); syncMute(); }
  if (e.code === 'KeyR') openRankingFromGame();
  if (e.code === 'KeyO') openOptionsFromGame();
  if (e.code === 'KeyL') openAchievementsFromGame();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) input.keys.delete(k);
});
window.addEventListener('blur', () => {
  input.keys.clear();
  if (state === 'playing') togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') togglePause();
});

// Controles táctiles
const touchUI = document.getElementById('touch');
function showTouch() { if (touchUI) touchUI.classList.add('on'); }
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) showTouch();
window.addEventListener('touchstart', showTouch, { once: true, passive: true });

document.querySelectorAll('[data-k]').forEach((btn) => {
  const k = btn.dataset.k;
  const on = (e) => { e.preventDefault(); Sound.unlock(); input.touch[k] = true; btn.classList.add('down'); if (k === 'fire') confirm(); };
  const off = (e) => { e.preventDefault(); input.touch[k] = false; btn.classList.remove('down'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
});
const pauseBtn = document.getElementById('pauseBtn');
if (pauseBtn) pauseBtn.addEventListener('click', () => { Sound.unlock(); togglePause(); });
const muteBtn = document.getElementById('muteBtn');
const syncMute = () => { if (muteBtn) muteBtn.textContent = Sound.muted ? '×' : '♪'; };
if (muteBtn) muteBtn.addEventListener('click', () => { Sound.unlock(); Sound.toggle(); syncMute(); });
syncMute();

// Pantalla completa (Android / escritorio) e instalación como app
const fsBtn = document.getElementById('fsBtn');
if (fsBtn) {
  if (fullscreenSupported()) fsBtn.addEventListener('click', () => toggleFullscreen());
  else fsBtn.hidden = true;
}
const installBtn = document.getElementById('installBtn');
setupPWA({ onInstallAvailable: (on) => { if (installBtn) installBtn.hidden = !on; } });
if (installBtn) installBtn.addEventListener('click', () => promptInstall());
const iosHint = needsIosInstallHint();

const optBtn = document.getElementById('optBtn');
if (optBtn) optBtn.addEventListener('click', () => openOptionsFromGame());
settings.onChange((s) => {
  if (!touchUI) return;
  touchUI.classList.toggle('big', s.bigTouch);
  touchUI.classList.toggle('left', s.leftHanded);
});

const achBtn = document.getElementById('achBtn');
if (achBtn) achBtn.addEventListener('click', () => openAchievementsFromGame());
ui.setAchievementsOpener(() => ({ list: achievements.list(), count: achievements.count, total: achievements.total }));
const rankBtn = document.getElementById('rankBtn');
if (rankBtn) {
  rankBtn.hidden = !online.enabled;
  rankBtn.addEventListener('click', () => openRankingFromGame());
}
// Los botones del HUD no se quedan con el foco (si no, Espacio los "aprieta")
document.querySelectorAll('.hud-buttons button').forEach((b) => b.addEventListener('click', () => b.blur()));
ui.handleInvite();
canvas.addEventListener('pointerdown', (e) => {
  Sound.unlock();
  if (state === 'menu') {
    const { x, y } = toCanvas(e);
    const hit = menuHit(x, y);
    if (hit >= 0) menuSel = hit;
  }
  if (state !== 'playing') confirm();
});

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  for (const p of pads) if (p) { pad = p; break; }
  if (!pad) { input.padX = 0; input.padFire = false; return; }
  const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
  const ax = pad.axes[0] || 0;
  input.padX = Math.abs(ax) > 0.25 ? ax : 0;
  if (b(14)) input.padX = -1;
  if (b(15)) input.padX = 1;
  input.padFire = b(0) || b(7) || b(5);
  const edge = (i) => b(i) && !input.padPrev[i];
  if (ui.isOpen()) {
    // En las pantallas: cruz o stick para moverse, A para elegir, B para volver
    const ay = pad.axes[1] || 0;
    const dir = Math.abs(ax) > 0.6 ? Math.sign(ax) : Math.abs(ay) > 0.6 ? Math.sign(ay) : 0;
    const axisEdge = dir !== 0 && dir !== input.padAxisPrev;
    input.padAxisPrev = dir;
    ui.gamepad({
      prev: edge(14) || edge(12) || (axisEdge && dir < 0),
      next: edge(15) || edge(13) || (axisEdge && dir > 0),
      accept: edge(0),
      back: edge(1),
    });
  } else {
    if (edge(0) || edge(9)) { Sound.unlock(); if (state !== 'playing') confirm(); }
    if (edge(9) && state === 'playing') togglePause();
  }
  input.padPrev = { 0: b(0), 1: b(1), 9: b(9), 12: b(12), 13: b(13), 14: b(14), 15: b(15) };
}

// ------------------------------------------------------------------
// Estado del juego
// ------------------------------------------------------------------
let state = 'menu';          // menu | playing | paused | gameover
let stateTime = 0;
let time = 0;
let shake = 0, hitStop = 0, flashScreen = 0;
let highscores = store.get('invaders.highscores', []);
const best = () => (highscores[0] ? highscores[0].score : 0);

let score, wave, lives, nextLife, combo, comboTimer, maxCombo, stats, newRecord;
let player, bullets, enemyBullets, invaders, boss, ufo, ufoTimer, powerups, bunkers;
let particles = [], texts = [];
let F, cfg, banner, clearTimer, waveHits, deathTimer, marchTimer, marchStep;
// Ranking online: partida registrada en el servidor y si se usaron trucos de test
let runId = null, runToken = 0, cheated = false;
// Modo: 'classic' o 'daily' (desafío diario). La práctica del diario no se registra.
let mode = 'classic', practice = false, dailyDay = null, waveLog = [], menuSel = 0;
// Mejoras elegidas en esta partida y rayos láser activos
let upgrades = emptyLevels(), lasers = [];
// Sector actual, salto al hiperespacio y peligros del escenario
let sector = 0, warp = 0, asteroids = [], hazardTimer = 0;
// Versus: sala activa, cuenta regresiva y avisos sobre el rival
let match = null, vsCountdown = 0, vsStartAt = 0, vsRivalDown = false, vsLeadShown = false, vsResult = null, vsIncoming = 0;
let vsRoom = null, vsResultPanel = null;

// Link de un versus: ?vs=CODIGO abre la sala con el código puesto
{
  const params = new URLSearchParams(location.search);
  const vs = (params.get('vs') || '').trim().toUpperCase();
  if (vs) {
    params.delete('vs');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (VS_CODE_RE.test(vs)) { menuSel = 2; setTimeout(() => openVersusLobby(vs), 0); }
  }
}

// Link directo al desafío: ?modo=diario abre el menú con esa opción elegida
{
  const params = new URLSearchParams(location.search);
  if (params.get('modo') === 'diario') {
    menuSel = 1;
    params.delete('modo');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
}

const stars = [];
[[90, 1, 14], [50, 1.6, 38], [24, 2.4, 85]].forEach(([n, s, v], l) => {
  for (let i = 0; i < n; i++) stars.push({ x: rand(0, W), y: rand(0, H), l, s, v, tw: rand(0, TAU) });
});

function waveConfig(n) {
  return {
    rows: Math.min(3 + Math.floor((n - 1) / 2), 6),
    cols: Math.min(8 + Math.floor((n - 1) / 2), 11),
    speed: 34 + n * 7,
    fireInterval: Math.max(0.32, 1.25 - n * 0.08),
    bulletSpeed: Math.min(250 + n * 14, 470),
    dive: n >= 3,
    diveInterval: Math.max(1.6, 5 - n * 0.25),
    aimed: n >= 4 ? Math.min(0.15 + n * 0.04, 0.55) : 0,
    armored: n >= 4,
    boss: n % 5 === 0,
  };
}

function newGame({ mode: m = 'classic', day = null, practice: p = false, seed = null } = {}) {
  mode = m;
  practice = m === 'daily' && p;
  dailyDay = m === 'daily' ? day || todayUTC() : null;
  if (m !== 'versus') leaveMatch();
  vsCountdown = m === 'versus' ? 3 : 0;
  vsRivalDown = false; vsLeadShown = false; vsResult = null; vsIncoming = 0;
  R = createStreams(m === 'daily' ? dailySeed(dailyDay) : m === 'versus' ? seed : randomSeed(), STREAMS);
  waveLog = [];
  upgrades = emptyLevels();
  lasers = [];
  sector = 0; warp = 0; asteroids = []; hazardTimer = 0;
  score = 0; wave = 0; lives = 3; nextLife = EXTRA_LIFE_EVERY;
  combo = 0; comboTimer = 0; maxCombo = 0; newRecord = false;
  stats = { shots: 0, hits: 0, kills: 0 };
  player = {
    x: W / 2, y: PLAYER_Y, w: 90, h: 45, vx: 0, tilt: 0, cooldown: 0,
    invuln: 0, alive: true, shield: false, triple: 0, rapid: 0,
  };
  bullets = []; enemyBullets = []; invaders = []; powerups = [];
  particles = []; texts = [];
  boss = null; ufo = null; ufoTimer = rr('ufo', 14, 22);
  deathTimer = 0; marchTimer = 0; marchStep = 0;
  state = 'playing'; stateTime = 0;
  if (ui.isOpen()) ui.close();
  if (mode === 'daily' && !practice) dailyRecord.start(dailyDay);
  registerRun();
  startWave(1);
}

// Avisa al servidor que empezó una partida (necesario para guardar el puntaje)
function registerRun() {
  runId = null;
  cheated = false;
  const token = ++runToken;
  if (!online.enabled || practice || mode === 'versus') return;
  api.startRun(mode)
    .then((r) => { if (token === runToken && r) runId = r.run_id; })
    .catch(() => { /* sin ranking para esta partida */ });
}

function startWave(n) {
  wave = n;
  achievements.event('wave', { wave: n });
  cfg = waveConfig(n);
  enemyBullets.length = 0;
  invaders = [];
  boss = null;
  waveHits = 0;
  clearTimer = 0;
  lasers.length = 0;
  asteroids.length = 0;
  hazardTimer = 3;
  buildBunkers();
  if (upgrades.regen && player.alive && !player.shield) {
    player.shield = true;
    floatText(player.x, player.y - 46, 'SHIELD', POWERS.S.color, 10);
  }
  // ¿Sector nuevo? Salto al hiperespacio y cartel con el nombre del escenario
  const next = sectorOf(n);
  const sectorStart = n === 1 || next !== sector;
  if (next !== sector) { warp = 1.8; Sound.warp(); }
  sector = next;
  const sc = SECTORS[sector];
  if (cfg.boss) {
    createBoss();
    banner = { text: 'WARNING', sub: boss.name + ' APPROACHING', t: 2.6, color: '#ff3b5c' };
    Sound.warning();
  } else {
    createFormation();
    banner = sectorStart
      ? { text: 'SECTOR ' + (sector + 1), sub: sc.name + ' · WAVE ' + n, t: 2.6, color: sc.color }
      : { text: 'WAVE ' + n, sub: '', t: 2.2, color: sc.color };
  }
}

// ------------------------------------------------------------------
// Formación de invasores
// ------------------------------------------------------------------
function createFormation() {
  const { rows, cols } = cfg;
  F = {
    x: (W - (cols - 1) * CELL_W - INV_W) / 2,
    y: -rows * CELL_H - 20,
    targetY: 64,
    entering: true,
    dir: 1, drop: 0, total: rows * cols,
    fireTimer: 1.5, diveTimer: cfg.diveInterval, laserTimer: 3, magmaTimer: 4,
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let type = r === 0 ? 2 : r < Math.ceil(rows / 2) ? 1 : 0;
      if (wave >= 6 && r === rows - 2) type = T_SPLITTER;
      if (wave >= 8 && r === 0 && c % 3 === 1) type = T_LASER;
      let hp = INV_TYPES[type].hp;
      if (type === 1 && cfg.armored) hp = 2;
      invaders.push({
        col: c, row: r, type, kind: INV_TYPES[type].kind, hp, x: 0, y: 0, w: INV_W, h: INV_H,
        state: 'formation', t: 0, flash: 0, dead: false, shot: false,
      });
    }
  }
}

function slotOf(inv) {
  return {
    x: F.x + inv.col * CELL_W,
    y: F.y + inv.row * CELL_H + Math.sin(time * 4 + inv.col * 0.6) * 3,
  };
}

function updateFormation(dt) {
  if (!invaders.length) return;
  // Los mini-invasores no son parte de la formación
  const members = invaders.filter((i) => i.col != null);
  const ratio = members.length / F.total;
  const speed = cfg.speed * (1 + (1 - ratio) * 2.6);

  if (F.entering) {
    F.y += (F.targetY - F.y) * Math.min(1, dt * 2.5);
    if (Math.abs(F.targetY - F.y) < 1) { F.y = F.targetY; F.entering = false; }
  } else {
    F.x += F.dir * speed * dt;
    let minC = Infinity, maxC = -Infinity;
    for (const inv of members) { if (inv.col < minC) minC = inv.col; if (inv.col > maxC) maxC = inv.col; }
    const left = F.x + minC * CELL_W, right = F.x + maxC * CELL_W + INV_W;
    if (right > W - 14 && F.dir > 0) { F.dir = -1; F.drop += 22; }
    else if (left < 14 && F.dir < 0) { F.dir = 1; F.drop += 22; }
    if (F.drop > 0) { const d = Math.min(F.drop, 140 * dt); F.y += d; F.drop -= d; }

    // Marcha clásica: el ritmo acelera cuando quedan menos invasores
    marchTimer -= dt;
    if (marchTimer <= 0) { Sound.march(marchStep++); marchTimer = lerp(0.12, 0.75, ratio); }
  }

  const canAttack = !F.entering && banner.t < 0.8 && player.alive;

  for (const inv of invaders) {
    if (moveInvader(inv, dt)) { invasion(); return; }
  }

  if (!canAttack) return;

  // Rayo láser (desde la oleada 8): uno por vez, con aviso previo
  if (wave >= 8 && !lasers.length) {
    F.laserTimer -= dt;
    if (F.laserTimer <= 0) {
      F.laserTimer = rr('fire', 3.5, 6.5);
      const shooters = invaders.filter((i) => i.kind === 'laser' && i.state === 'formation');
      if (shooters.length) startLaser({ owner: rpick('fire', shooters) });
    }
  }

  // Nebulosa: bajan magmitas flotando desde arriba
  if (sector === 1) {
    F.magmaTimer -= dt;
    if (F.magmaTimer <= 0) {
      F.magmaTimer = rr('hazard', 6, 10);
      spawnMagmitas(rr('hazard', 120, W - 120), -36, R.hazard() < 0.4 ? 2 : 1);
    }
  }

  // Disparo: sólo el invasor más bajo de cada columna puede disparar
  F.fireTimer -= dt;
  if (F.fireTimer <= 0) {
    F.fireTimer = cfg.fireInterval * rr('fire', 0.6, 1.4);
    const bottom = {};
    for (const inv of invaders) {
      if (inv.state !== 'formation') continue;
      if (!bottom[inv.col] || inv.row > bottom[inv.col].row) bottom[inv.col] = inv;
    }
    const shooters = Object.values(bottom);
    if (shooters.length) {
      const s = rpick('fire', shooters);
      enemyShot(s.x + s.w / 2, s.y + s.h, R.fire() < cfg.aimed);
    }
  }

  // Picados (desde la oleada 3)
  if (cfg.dive) {
    F.diveTimer -= dt;
    if (F.diveTimer <= 0) {
      F.diveTimer = cfg.diveInterval * rr('dive', 0.7, 1.3);
      const candidates = invaders.filter((i) => i.state === 'formation');
      if (candidates.length) {
        const d = rpick('dive', candidates);
        d.state = 'dive'; d.t = 0; d.shot = false;
        d.speed = Math.min(170 + wave * 9, 320);
        d.wob = R.dive() < 0.5 ? -1 : 1;
        Sound.ufo();
      }
    }
  }
}

// Mueve un invasor según su estado. Devuelve true si la formación llegó abajo.
function moveInvader(inv, dt) {
  inv.flash = Math.max(0, inv.flash - dt);
  if (inv.kind === 'magmita') return moveMagmita(inv, dt);
  if (inv.state === 'formation') {
    const s = slotOf(inv);
    inv.x = s.x; inv.y = s.y;
    if (inv.y + inv.h >= PLAYER_Y - 18) return true;
  } else if (inv.state === 'dive') {
    inv.t += dt;
    inv.y += inv.speed * dt;
    inv.x += ((player.x - (inv.x + inv.w / 2)) * 0.9 + Math.cos(inv.t * 4) * 140 * inv.wob) * dt;
    inv.x = clamp(inv.x, 4, W - inv.w - 4);
    if (!inv.shot && inv.t > 0.45 && inv.y < PLAYER_Y - 120) {
      inv.shot = true;
      enemyShot(inv.x + inv.w / 2, inv.y + inv.h, true);
    }
    if (inv.y > H + 20) {
      // Los mini-invasores se van; los de la formación vuelven desde arriba
      if (inv.col == null) inv.dead = true;
      else { inv.state = 'return'; inv.y = -60; }
    }
  } else if (inv.state === 'return') {
    const s = slotOf(inv);
    const dx = s.x - inv.x, dy = s.y - inv.y;
    const dist = Math.hypot(dx, dy);
    const step = 320 * dt;
    if (dist <= step) { inv.state = 'formation'; inv.x = s.x; inv.y = s.y; }
    else { inv.x += (dx / dist) * step; inv.y += (dy / dist) * step; }
  }
  if (inv.state !== 'return') carveBunkers(inv);
  return false;
}

// Mini-invasores que salen del divisor o que suelta el jefe
function spawnMinis(x, y, n = 2) {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    invaders.push({
      type: T_MINI, kind: 'mini', hp: 1, x: clamp(x - MINI_W / 2 + side * 14, 4, W - MINI_W - 4), y,
      w: MINI_W, h: MINI_H, state: 'dive', t: i * 0.2, flash: 0, dead: false, shot: true,
      speed: Math.min(220 + wave * 6, 340), wob: side,
    });
  }
}

// Magmitas: crías de MAGMA que bajan flotando, sueltan una gota de lava y derriten búnkers
function spawnMagmitas(x, y, n = 2) {
  for (let i = 0; i < n; i++) {
    invaders.push({
      type: T_MAGMITA, kind: 'magmita', hp: INV_TYPES[T_MAGMITA].hp,
      x: clamp(x - 14 + (i - (n - 1) / 2) * 42, 4, W - 32), y,
      w: 28, h: 30, state: 'dive', t: i * 0.4, flash: 0, dead: false, shot: false,
      speed: 70 + Math.min(wave, 30) * 2, wob: i % 2 ? 1 : -1,
    });
  }
}

function moveMagmita(inv, dt) {
  inv.t += dt;
  inv.y += inv.speed * dt;
  inv.x += (Math.cos(inv.t * 2) * 80 * inv.wob + (player.x - inv.x - inv.w / 2) * 0.3) * dt;
  inv.x = clamp(inv.x, 4, W - inv.w - 4);
  if (!inv.shot && inv.t > 1.1 && inv.y > 40 && inv.y < PLAYER_Y - 140) {
    inv.shot = true;
    dropLava(inv.x + inv.w / 2, inv.y + inv.h, 0, 200);
  }
  if (inv.y > H + 20) inv.dead = true;
  carveBunkers(inv);
  return false;
}

// Gota de lava: no se puede anular a tiros y derrite más búnker
function dropLava(x, y, vx, vy) {
  enemyBullets.push({ x: x - 5, y: y - 5, w: 10, h: 10, vx, vy, kind: 'lava', dead: false });
}

// ------------------------------------------------------------------
// Rayos: invasor láser, jefe nivel 3+ y erupciones solares
// ------------------------------------------------------------------
const LASER_KINDS = {
  laser: { w: 16, charge: 0.85, fire: 0.45, glow: 'rgba(255,59,59,0.25)', mid: 'rgba(255,80,80,0.75)', core: '#ffffff', warn: 'rgba(255,59,59,0.55)', spark: '#ff6b6b' },
  flare: { w: 26, charge: 1.1, fire: 0.6, glow: 'rgba(255,176,32,0.25)', mid: 'rgba(255,140,26,0.8)', core: '#fff6d0', warn: 'rgba(255,176,32,0.6)', spark: '#ffb020' },
};

function startLaser({ owner, x, y, kind = 'laser' }) {
  const k = LASER_KINDS[kind];
  const follow = !!owner && owner !== boss;
  lasers.push({
    owner, follow, kind, x: follow ? owner.x + owner.w / 2 : x, y: follow ? owner.y + owner.h : y,
    w: k.w, charge: k.charge, maxCharge: k.charge, fire: k.fire, firing: false, end: H, erode: 0, dead: false,
  });
  Sound.laserCharge();
}

// Hasta dónde llega el rayo: lo frena la primera celda de búnker que encuentra
function laserEnd(L) {
  let end = H, hit = null;
  for (const b of bunkers) {
    if (L.x + L.w / 2 < b.x || L.x - L.w / 2 > b.x + b.w) continue;
    const { c0, c1 } = cellRange(b, { x: L.x - L.w / 2, y: b.y, w: L.w, h: 1 });
    for (let r = 0; r < BK_ROWS; r++) {
      let col = -1;
      for (let c = c0; c <= c1; c++) if (b.cells[r * BK_COLS + c]) { col = c; break; }
      if (col >= 0) {
        const yy = b.y + r * BK_CELL;
        if (yy > L.y && yy < end) { end = yy; hit = { b, c: col, r }; }
        break;
      }
    }
  }
  return { end, hit };
}

function updateLasers(dt) {
  for (const L of lasers) {
    const ownerGone = L.owner && (L.owner.dead || (L.owner === boss && boss.dying > 0));
    if (ownerGone && !L.firing) { L.dead = true; continue; }
    if (L.follow && !L.owner.dead) { L.x = L.owner.x + L.owner.w / 2; L.y = L.owner.y + L.owner.h; }
    if (!L.firing) {
      L.charge -= dt;
      if (L.charge <= 0) { L.firing = true; Sound.laserFire(); addShake(3); }
      continue;
    }
    L.fire -= dt;
    const { end, hit } = laserEnd(L);
    L.end = end;
    if (hit) {
      L.erode -= dt;
      if (L.erode <= 0) { L.erode = 0.05; erode(hit.b, hit.c, hit.r, 1.6); }
    }
    const beam = { x: L.x - L.w / 2, y: L.y, w: L.w, h: end - L.y };
    if (player.alive && overlap(beam, playerBox())) hitPlayer();
    if (L.fire <= 0) L.dead = true;
  }
  compact(lasers);
}

function drawLasers() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lasers) {
    const c = LASER_KINDS[L.kind];
    if (!L.firing) {
      // Aviso: línea fina que parpadea y un brillo que crece
      const k = 1 - L.charge / L.maxCharge;
      if (Math.floor(time * 18) % 2 === 0) {
        ctx.fillStyle = c.warn;
        ctx.fillRect(L.x - 1, L.y, 2, laserEnd(L).end - L.y);
      }
      ctx.fillStyle = c.mid;
      ctx.beginPath(); ctx.arc(L.x, L.y, 3 + k * 7, 0, TAU); ctx.fill();
    } else {
      const h = L.end - L.y;
      ctx.fillStyle = c.glow;
      ctx.fillRect(L.x - L.w, L.y, L.w * 2, h);
      ctx.fillStyle = c.mid;
      ctx.fillRect(L.x - L.w / 2, L.y, L.w, h);
      ctx.fillStyle = c.core;
      ctx.fillRect(L.x - 2, L.y, 4, h);
      spawn({ x: L.x + rand(-6, 6), y: L.end, vx: rand(-90, 90), vy: rand(-140, -40), life: 0.2, size: 2, color: c.spark, type: 'spark' });
    }
  }
  ctx.restore();
}

function enemyShot(x, y, aimed) {
  const sp = cfg.bulletSpeed;
  let vx = 0, vy = sp;
  if (aimed) {
    const dx = player.x - x, dy = player.y - y;
    const d = Math.hypot(dx, dy) || 1;
    vx = (dx / d) * sp; vy = (dy / d) * sp;
    if (vy < sp * 0.5) { vy = sp * 0.5; }
  }
  enemyBullets.push({ x: x - 2, y, w: 4, h: 12, vx, vy, kind: aimed ? 'aimed' : 'bolt', dead: false });
  Sound.enemyShoot();
}

function invasion() {
  // Los invasores llegaron a tu línea: fin del juego
  if (!player.alive) return;
  banner = { text: 'INVADED!', sub: '', t: 2, color: '#ff3b5c' };
  lives = 0;
  hitPlayer(true);
}

// ------------------------------------------------------------------
// Jefe
// ------------------------------------------------------------------
const BOSS_NAMES = ['MOTHERSHIP', 'MOTHERSHIP MK II', 'MOTHERSHIP MK III'];
// Un jefe por sector; después de los 5 vuelven, más rápidos (+1, +2…)
const BOSS_ROTATION = ['mothership', 'magma', 'titan', 'vortex', 'phoenix'];
const BOSS_COLORS = {
  mothership: { glow: '255,59,92', bar: '#ff3b5c', label: '#ff8aa0', boom: ['#ff3b5c', '#ffd23f', '#fff'] },
  magma: { glow: '255,140,26', bar: '#ff8c1a', label: '#ffb070', boom: ['#ff8c1a', '#ffd23f', '#ff3b3b'] },
  titan: { glow: '217,160,102', bar: '#d9a066', label: '#e8c49a', boom: ['#d9a066', '#5dc1b9', '#fff'] },
  vortex: { glow: '155,123,255', bar: '#9b7bff', label: '#c3b0ff', boom: ['#9b7bff', '#ff4fd8', '#fff'] },
  phoenix: { glow: '255,176,32', bar: '#ffb020', label: '#ffd27a', boom: ['#ffb020', '#ff3b1f', '#fff2a8'] },
};

function createBoss() {
  const hp = 70 + wave * 10;
  const k = Math.floor(wave / SECTOR_LEN) - 1; // 0: oleada 5 · 1: oleada 10 · 2: oleada 15…
  const tier = Math.floor(k / BOSS_ROTATION.length);
  const kind = BOSS_ROTATION[k % BOSS_ROTATION.length];
  const suffix = tier > 0 ? ' +' + tier : '';
  const base = {
    x: W / 2, y: -140, targetY: 120, hp, maxHp: hp, t: 0, atk: 2.4, pattern: 0, flash: 0,
    entering: true, dying: 0, burst: 0, burstTimer: 0, boomTimer: 0, dead: false,
    kind, tier, level: k + 1, speedUp: Math.pow(0.88, tier), intangible: false,
  };
  if (kind === 'magma') {
    // MAGMA: medusa gigante de lava, jefa de la nebulosa
    boss = {
      ...base, name: 'MAGMA' + suffix, w: 136, h: 80, targetY: 132,
      tx: W / 2, wander: 2.5, blink: 0, moved: false, alpha: 1,
    };
  } else if (kind === 'titan') {
    // TITÁN: núcleo de roca protegido por rocas que orbitan
    boss = {
      ...base, name: 'TITAN' + suffix, w: 92, h: 84, targetY: 140, mt: 0,
      rocks: Array.from({ length: 8 }, (_, i) => newRock((i / 8) * TAU)), regrow: 7, spinBoost: 0, broken: 0,
    };
  } else if (kind === 'vortex') {
    // VÓRTICE: se traga tus disparos y te los devuelve
    boss = {
      ...base, name: 'VORTEX' + suffix, w: 84, h: 84, targetY: 130, mt: 0,
      absorbing: 0, absorbed: 0, totalAbsorbed: 0, spiral: 0, spiralTimer: 0, spiralAng: 0,
    };
  } else if (kind === 'phoenix') {
    // FÉNIX SOLAR: pica hacia la nave y revive una vez a mitad de vida
    boss = {
      ...base, name: 'SOLAR PHOENIX' + suffix, w: 100, h: 80, targetY: 120, mt: 0,
      mode: 'hover', modeT: 0, reborn: false, target: null, from: null, hitDone: false,
    };
  } else {
    // Nave nodriza: nivel 2 suelta escoltas · nivel 3+ además dispara el rayo
    const level = 1 + tier;
    boss = {
      ...base, w: INV_W * 3, h: INV_H * 3, level, escort: 4,
      name: BOSS_NAMES[Math.min(level, 3) - 1] + (level > 3 ? ' +' + (level - 3) : ''),
    };
  }
}

function newRock(ang) {
  return {
    ang, r: rr('boss', 15, 21), verts: Array.from({ length: 8 }, () => rr('boss', 0.75, 1.15)),
    rot: 0, hp: 3, flash: 0, dead: false,
  };
}

function updateBoss(dt) {
  const b = boss;
  b.flash = Math.max(0, b.flash - dt);
  if (b.dying > 0) {
    b.dying -= dt;
    b.boomTimer -= dt;
    b.x += rand(-1, 1) * 2;
    if (b.boomTimer <= 0) {
      b.boomTimer = 0.07;
      const colors = BOSS_COLORS[b.kind].boom;
      explode(b.x + rand(-b.w / 2, b.w / 2), b.y + rand(-b.h / 2, b.h / 2), pick(colors), 14, 200);
      Sound.explode();
      addShake(4);
    }
    if (b.dying <= 0) {
      b.dead = true;
      explode(b.x, b.y, BOSS_COLORS[b.kind].boom[0], 90, 480);
      explode(b.x, b.y, '#ffd23f', 50, 300);
      Sound.big(); addShake(16); flash(0.35);
      vibrate([200, 80, 200]);
      const pts = 5000 * Math.ceil(wave / 5);
      addScore(pts);
      floatText(b.x, b.y, '+' + pts, '#ffd23f', 22);
      dropPower(b.x - 40, b.y, true);
      dropPower(b.x + 40, b.y, true);
      boss = null;
    }
    return;
  }
  if (b.entering) {
    b.y += (b.targetY - b.y) * Math.min(1, dt * 1.6);
    if (Math.abs(b.targetY - b.y) < 1.5) b.entering = false;
    return;
  }
  const enraged = b.hp < b.maxHp * 0.5;
  if (b.kind === 'magma') { updateMagma(b, dt, enraged); return; }
  if (b.kind === 'titan') { updateTitan(b, dt, enraged); return; }
  if (b.kind === 'vortex') { updateVortex(b, dt, enraged); return; }
  if (b.kind === 'phoenix') { updatePhoenix(b, dt, enraged || b.reborn); return; }
  b.t += dt * (enraged ? 1.4 : 1);
  b.x = W / 2 + Math.sin(b.t * 0.7) * (W / 2 - 110);
  b.y = b.targetY + Math.sin(b.t * 1.3) * 18;
  if (!player.alive) return;

  if (b.level >= 2) {
    b.escort -= dt;
    if (b.escort <= 0) {
      b.escort = enraged ? 4 : 5.5;
      spawnMinis(b.x, b.y + b.h / 2 - 10, 2);
      Sound.ufo();
    }
  }

  if (b.burst > 0) {
    b.burstTimer -= dt;
    if (b.burstTimer <= 0) { b.burst--; b.burstTimer = 0.09; bossShot(b.x, b.y + b.h / 2, Math.atan2(player.y - b.y, player.x - b.x), 360); }
  }

  b.atk -= dt;
  if (b.atk <= 0) {
    b.atk = Math.max(0.9, 2.1 - wave * 0.04) * (enraged ? 0.7 : 1);
    const p = b.pattern++ % (b.level >= 3 ? 4 : 3);
    if (p === 3) {
      // Rayo con aviso, apuntado a donde está el jugador ahora
      startLaser({ owner: b, x: player.x, y: b.y + b.h / 2 });
    } else if (p === 0) {
      const n = enraged ? 20 : 14;
      for (let i = 0; i < n; i++) bossShot(b.x, b.y, (i / n) * TAU + b.t, 190);
    } else if (p === 1) {
      b.burst = enraged ? 8 : 5; b.burstTimer = 0;
    } else {
      const n = enraged ? 9 : 7;
      for (let i = 0; i < n; i++) bossShot(b.x, b.y + b.h / 2, lerp(Math.PI * 0.25, Math.PI * 0.75, i / (n - 1)), 260);
    }
    Sound.enemyShoot();
  }
}

// MAGMA: deriva por la pantalla y alterna lluvia de lava, crías y teletransporte
function updateMagma(b, dt, enraged) {
  b.t += dt * (enraged ? 1.3 : 1);
  if (b.blink > 0) {
    // Se desvanece, cambia de lugar y reaparece con un anillo de lava
    b.blink -= dt;
    if (b.blink <= 0.5 && !b.moved) {
      b.moved = true;
      b.x = b.tx = rr('boss', 150, W - 150);
    }
    b.alpha = b.blink > 0.5 ? (b.blink - 0.5) / 0.5 : 1 - Math.max(b.blink, 0) / 0.5;
    b.intangible = b.alpha < 0.5;
    if (b.blink <= 0) {
      b.alpha = 1; b.intangible = false; b.moved = false;
      const n = enraged ? 14 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + b.t;
        dropLava(b.x, b.y + 10, Math.cos(a) * 170, Math.sin(a) * 170);
      }
      Sound.lava();
    }
  } else {
    b.wander -= dt;
    if (b.wander <= 0) { b.wander = 2.5; b.tx = rr('boss', 150, W - 150); }
    b.x += (b.tx - b.x) * Math.min(1, dt * 0.8);
  }
  b.y = b.targetY + Math.sin(b.t * 1.1) * 22;
  if (!player.alive) return;

  b.atk -= dt;
  if (b.atk <= 0 && b.blink <= 0) {
    b.atk = (enraged ? 1.5 : 2.2) * b.speedUp;
    const p = b.pattern++ % 3;
    if (p === 0) {
      // Lluvia de lava
      const n = enraged ? 10 : 7;
      for (let i = 0; i < n; i++) {
        dropLava(b.x + rr('boss', -b.w * 0.45, b.w * 0.45), b.y + b.h * 0.3, rr('boss', -35, 35), rr('boss', 140, 220));
      }
      Sound.lava();
    } else if (p === 1) {
      spawnMagmitas(b.x, b.y + b.h / 2, enraged ? 3 : 2);
    } else {
      b.blink = 1;
      b.moved = false;
      Sound.warp();
    }
  }
}

// Ráfaga apuntada (la usan varios jefes)
function updateBurst(b, dt) {
  if (b.burst <= 0) return;
  b.burstTimer -= dt;
  if (b.burstTimer <= 0) {
    b.burst--;
    b.burstTimer = 0.09;
    bossShot(b.x, b.y + b.h / 2, Math.atan2(player.y - b.y, player.x - b.x), 360);
  }
}

// TITÁN: las rocas giran a su alrededor, se regeneran y las arroja
function updateTitan(b, dt, enraged) {
  b.t += dt;
  b.mt += dt;
  b.x = W / 2 + Math.sin(b.mt * 0.45) * (W / 2 - 170);
  b.y = b.targetY + Math.sin(b.mt * 0.9) * 10;
  b.spinBoost = Math.max(0, b.spinBoost - dt);
  const spin = b.spinBoost > 0 ? 2.6 : enraged ? 1.4 : 0.9;
  for (const r of b.rocks) {
    r.ang += spin * dt;
    r.rot += dt;
    r.flash = Math.max(0, r.flash - dt);
  }
  b.regrow -= dt;
  if (b.regrow <= 0) {
    b.regrow = 7 * b.speedUp;
    if (b.rocks.length < 8) b.rocks.push(newRock(rr('boss', 0, TAU)));
  }
  if (!player.alive) return;
  b.atk -= dt;
  if (b.atk <= 0) {
    b.atk = (enraged ? 1.6 : 2.3) * b.speedUp;
    const p = b.pattern++ % 3;
    if (p === 0 && b.rocks.length) {
      // Arroja rocas del escudo hacia la nave
      for (let i = 0; i < (enraged ? 2 : 1) && b.rocks.length; i++) {
        const rock = b.rocks.reduce((top, r) => (Math.sin(r.ang) > Math.sin(top.ang) ? r : top));
        b.rocks = b.rocks.filter((r) => r !== rock);
        const pos = rockPos(b, rock);
        const a = Math.atan2(player.y - pos.y, player.x - pos.x);
        enemyBullets.push({
          x: pos.x - 13, y: pos.y - 13, w: 26, h: 26, vx: Math.cos(a) * 240, vy: Math.max(120, Math.sin(a) * 240),
          kind: 'rock', hp: 3, r: rock.r, verts: rock.verts, rot: 0, flash: 0, dead: false,
        });
      }
      Sound.rock();
    } else if (p === 1) {
      // Temblor: caen escombros desde arriba
      const n = enraged ? 7 : 5;
      for (let i = 0; i < n; i++) {
        enemyBullets.push({
          x: rr('boss', 40, W - 54), y: -20 - i * 30, w: 14, h: 14, vx: 0, vy: rr('boss', 220, 300),
          kind: 'debris', r: 8, verts: [1, 0.8, 1.1, 0.9, 1, 0.85], rot: 0, flash: 0, dead: false,
        });
      }
      addShake(4);
      Sound.rock();
    } else {
      b.spinBoost = 3;
    }
  }
}

// VÓRTICE: absorbe (y te atrae), espiral de orbes y ráfagas
function updateVortex(b, dt, enraged) {
  b.mt += dt;
  b.t += dt * (b.absorbing > 0 ? 3 : 1);
  b.x = W / 2 + Math.sin(b.mt * 0.5) * (W / 2 - 190);
  b.y = b.targetY + Math.sin(b.mt * 1.2) * 14;
  b.intangible = b.absorbing > 0;
  if (b.absorbing > 0) {
    b.absorbing -= dt;
    if (player.alive) {
      const dx = b.x - player.x;
      player.x = clamp(player.x + Math.sign(dx) * Math.min(Math.abs(dx), 70 * dt), player.w / 2 + 6, W - player.w / 2 - 6);
    }
    if (b.absorbing <= 0) {
      // Devuelve lo que se tragó, en abanico hacia la nave
      const n = clamp(b.absorbed + 4, 6, enraged ? 20 : 16);
      const aim = Math.atan2(player.y - b.y, player.x - b.x);
      for (let i = 0; i < n; i++) bossShot(b.x, b.y, aim - 0.6 + (1.2 * i) / (n - 1), 230);
      b.absorbed = 0;
      Sound.laserFire();
    }
  }
  if (b.spiral > 0) {
    b.spiral -= dt;
    b.spiralTimer -= dt;
    if (b.spiralTimer <= 0) {
      b.spiralTimer = 0.07;
      b.spiralAng += 0.5;
      bossShot(b.x, b.y, b.spiralAng, 170);
      if (enraged) bossShot(b.x, b.y, b.spiralAng + Math.PI, 170);
    }
  }
  updateBurst(b, dt);
  if (!player.alive) return;
  b.atk -= dt;
  if (b.atk <= 0 && b.absorbing <= 0 && b.spiral <= 0) {
    b.atk = (enraged ? 1.8 : 2.6) * b.speedUp;
    const p = b.pattern++ % 3;
    if (p === 0) { b.absorbing = 2.6; b.absorbed = 0; Sound.warp(); }
    else if (p === 1) { b.spiral = enraged ? 2.4 : 1.8; b.spiralTimer = 0; }
    else { b.burst = enraged ? 8 : 5; b.burstTimer = 0; }
  }
}

// Los disparos que pasan cerca del VÓRTICE cuando absorbe se curvan hacia él y desaparecen
function vortexSuction(dt) {
  if (!boss || boss.kind !== 'vortex' || boss.absorbing <= 0 || boss.entering || boss.dying > 0) return;
  for (const b of bullets) {
    const dx = boss.x - b.x, dy = boss.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < VORTEX_PULL_RADIUS) { b.vx += (dx / d) * 2400 * dt; b.vy += (dy / d) * 2400 * dt; }
    if (d < 34) {
      b.dead = true;
      boss.absorbed++;
      boss.totalAbsorbed++;
      spawn({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.15, size: 16, color: '#9b7bff', type: 'flash', drag: 1 });
    }
  }
}

// FÉNIX SOLAR: vuela arriba, avisa con una mira y pica hacia la nave
const PHOENIX_DIVE = 0.55, PHOENIX_RISE = 0.8, PHOENIX_EGG = 2.6;

function updatePhoenix(b, dt, enraged) {
  b.t += dt;
  const hoverX = () => W / 2 + Math.sin(b.mt * 0.6) * (W / 2 - 150);
  const hoverY = () => b.targetY + Math.sin(b.mt * 1.7) * 16;
  if (b.mode === 'egg') {
    b.modeT -= dt;
    b.hp = Math.round(b.maxHp * 0.5 * (1 - Math.max(b.modeT, 0) / PHOENIX_EGG));
    if (b.modeT <= 0) { b.mode = 'hover'; b.intangible = false; b.atk = 1; }
    return;
  }
  if (b.mode === 'hover') {
    b.mt += dt;
    b.x = hoverX();
    b.y = hoverY();
  } else if (b.mode === 'telegraph') {
    b.modeT -= dt;
    if (b.modeT <= 0) { b.mode = 'dive'; b.modeT = PHOENIX_DIVE; b.from = { x: b.x, y: b.y }; b.hitDone = false; Sound.laserFire(); }
  } else if (b.mode === 'dive' || b.mode === 'rise') {
    b.modeT -= dt;
    const dur = b.mode === 'dive' ? PHOENIX_DIVE : PHOENIX_RISE;
    const p = 1 - Math.max(b.modeT, 0) / dur;
    const e = b.mode === 'dive' ? p * p : 1 - (1 - p) * (1 - p);
    const to = b.mode === 'dive' ? b.target : { x: hoverX(), y: hoverY() };
    b.x = lerp(b.from.x, to.x, e);
    b.y = lerp(b.from.y, to.y, e);
    carveBunkers({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h });
    spawn({ x: b.x + rand(-20, 20), y: b.y - 30, vx: rand(-40, 40), vy: rand(-120, -40), life: 0.4, size: 3, color: pick(['#ffb020', '#ff3b1f', '#fff2a8']), type: 'square' });
    if (b.modeT <= 0) {
      if (b.mode === 'dive') {
        // Abajo de todo suelta un anillo de llamas y vuelve a subir
        for (let i = 0; i < 8; i++) bossShot(b.x, b.y, Math.PI + (i / 7) * Math.PI, 200);
        b.mode = 'rise'; b.modeT = PHOENIX_RISE; b.from = { x: b.x, y: b.y };
      } else {
        b.mode = 'hover';
      }
    }
  }
  updateBurst(b, dt);
  if (!player.alive || b.mode !== 'hover') return;
  b.atk -= dt;
  if (b.atk <= 0) {
    b.atk = (enraged ? 1.4 : 2.1) * b.speedUp;
    const p = b.pattern++ % 3;
    if (p === 0) {
      b.mode = 'telegraph';
      b.modeT = enraged ? 0.55 : 0.75;
      b.target = { x: clamp(player.x, 60, W - 60), y: PLAYER_Y - 30 };
      Sound.warning();
    } else if (p === 1) {
      // Plumas de fuego en abanico
      const n = enraged ? 9 : 7;
      const aim = Math.atan2(player.y - b.y, player.x - b.x);
      for (let i = 0; i < n; i++) {
        const a = aim - 0.5 + (1 / (n - 1)) * i;
        enemyBullets.push({ x: b.x - 3, y: b.y + 30, w: 6, h: 14, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, kind: 'feather', dead: false });
      }
      Sound.enemyShoot();
    } else {
      updateBurstStart(b, enraged);
    }
  }
}

function updateBurstStart(b, enraged) {
  b.burst = enraged ? 7 : 4;
  b.burstTimer = 0;
}

// Daño a un jefe (disparos y ganchos de test). El fénix revive la primera vez.
function damageBoss(n) {
  boss.hp -= n;
  boss.flash = 0.05;
  if (boss.hp > 0) return;
  if (boss.kind === 'phoenix' && !boss.reborn) {
    boss.reborn = true;
    boss.mode = 'egg';
    boss.modeT = PHOENIX_EGG;
    boss.intangible = true;
    boss.hp = 0;
    boss.name = boss.name.replace('SOLAR PHOENIX', 'PHOENIX REBORN');
    enemyBullets.length = 0;
    explode(boss.x, boss.y, '#ffb020', 70, 380);
    flash(0.25);
    Sound.big();
    banner = { text: 'REBORN!', sub: 'THE PHOENIX RISES AGAIN', t: 1.8, color: '#ffb020' };
    return;
  }
  boss.dying = 1.5;
  boss.boomTimer = 0;
  registerKill();
  enemyBullets.length = 0;
  achievements.event('boss', { kind: boss.kind });
  sendAttack(4);
}

function bossShot(x, y, a, sp) {
  enemyBullets.push({ x: x - 5, y: y - 5, w: 10, h: 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, kind: 'orb', dead: false });
}

// ------------------------------------------------------------------
// Peligros de cada sector: asteroides (3) y erupciones solares (5)
// ------------------------------------------------------------------
function updateHazards(dt) {
  for (const a of asteroids) {
    a.x += a.vx * dt;
    a.rot += a.vr * dt;
    a.flash = Math.max(0, a.flash - dt);
    if (a.x < -80 || a.x > W + 80) a.dead = true;
  }
  if (banner.t > 0.8 || !player.alive) return;
  hazardTimer -= dt;
  if (hazardTimer > 0) return;
  if (sector === 2) {
    hazardTimer = rr('hazard', 2.2, 4.2);
    const dir = R.hazard() < 0.5 ? 1 : -1;
    spawnAsteroid(dir > 0 ? -50 : W + 50, rr('hazard', 200, 350), dir);
  } else if (sector >= 4) {
    hazardTimer = rr('hazard', 5, 8);
    if (!lasers.some((L) => L.kind === 'flare')) {
      startLaser({ x: rr('hazard', 60, W - 60), y: 24, kind: 'flare' });
    }
  } else {
    hazardTimer = 3;
  }
}

function spawnAsteroid(x, y, dir) {
  const r = rr('hazard', 16, 30);
  const verts = Array.from({ length: 9 }, () => rr('hazard', 0.75, 1.15));
  asteroids.push({
    x, y, r, verts, vx: dir * rr('hazard', 55, 115), rot: 0, vr: rr('hazard', -1.5, 1.5),
    hp: r > 24 ? 4 : 3, flash: 0, dead: false,
  });
}

// Los asteroides frenan disparos de los dos lados; romperlos da puntos
function hitAsteroid(rect, byPlayer) {
  for (const a of asteroids) {
    if (a.dead) continue;
    const box = { x: a.x - a.r * 0.8, y: a.y - a.r * 0.8, w: a.r * 1.6, h: a.r * 1.6 };
    if (!overlap(rect, box)) continue;
    a.hp--;
    a.flash = 0.08;
    if (a.hp <= 0) {
      a.dead = true;
      explode(a.x, a.y, '#d9a066', 18, 170);
      Sound.rock();
      if (byPlayer) { addScore(50); floatText(a.x, a.y, '50', '#d9a066', 10); achievements.event('rock'); }
    }
    return true;
  }
  return false;
}

function drawAsteroids() {
  for (const a of asteroids) drawRock(ctx, a.x, a.y, a.r, a.verts, a.rot, a.flash > 0);
}

// ------------------------------------------------------------------
// OVNI misterioso
// ------------------------------------------------------------------
function updateUfo(dt) {
  if (!ufo) {
    if (cfg.boss || F.entering || !player.alive) return;
    ufoTimer -= dt;
    if (ufoTimer <= 0) {
      const dir = R.ufo() < 0.5 ? 1 : -1;
      ufo = { x: dir > 0 ? -70 : W + 10, y: 26, w: 60, h: 24, vx: dir * 170, beep: 0, dead: false };
      ufoTimer = rr('ufo', 16, 26);
    }
    return;
  }
  ufo.x += ufo.vx * dt;
  ufo.beep -= dt;
  if (ufo.beep <= 0) { ufo.beep = 0.22; Sound.ufo(); }
  if (ufo.x < -90 || ufo.x > W + 30) ufo = null;
}

// ------------------------------------------------------------------
// Búnkers destructibles
// ------------------------------------------------------------------
const BK_CELL = 4, BK_COLS = 18, BK_ROWS = 12;

function buildBunkers() {
  bunkers = [];
  for (let i = 0; i < 4; i++) {
    const cells = new Uint8Array(BK_COLS * BK_ROWS);
    for (let r = 0; r < BK_ROWS; r++) {
      for (let c = 0; c < BK_COLS; c++) {
        const corner = r < 3 && (c < 3 - r || c > BK_COLS - 1 - (3 - r));
        const arch = r >= BK_ROWS - 4 && c >= 6 && c < 12;
        cells[r * BK_COLS + c] = corner || arch ? 0 : 1;
      }
    }
    const cv = document.createElement('canvas');
    cv.width = BK_COLS * BK_CELL; cv.height = BK_ROWS * BK_CELL;
    bunkers.push({
      x: Math.round((W * (i + 1)) / 5 - (BK_COLS * BK_CELL) / 2),
      y: PLAYER_Y - 110, w: BK_COLS * BK_CELL, h: BK_ROWS * BK_CELL,
      cells, cv, dirty: true,
    });
  }
}

function cellRange(b, r) {
  return {
    c0: clamp(Math.floor((r.x - b.x) / BK_CELL), 0, BK_COLS - 1),
    c1: clamp(Math.floor((r.x + r.w - b.x) / BK_CELL), 0, BK_COLS - 1),
    r0: clamp(Math.floor((r.y - b.y) / BK_CELL), 0, BK_ROWS - 1),
    r1: clamp(Math.floor((r.y + r.h - b.y) / BK_CELL), 0, BK_ROWS - 1),
  };
}

// Devuelve true si la bala chocó contra un búnker (y lo erosiona)
function hitBunkers(rect, down, radius = 2.6) {
  for (const b of bunkers) {
    if (!overlap(rect, b)) continue;
    const { c0, c1, r0, r1 } = cellRange(b, rect);
    // Recorre en la dirección de la bala para impactar la primera celda
    for (let k = 0; k <= r1 - r0; k++) {
      const r = down ? r0 + k : r1 - k;
      for (let c = c0; c <= c1; c++) {
        if (b.cells[r * BK_COLS + c]) { erode(b, c, r, radius); return true; }
      }
    }
  }
  return false;
}

function erode(b, cc, cr, radius) {
  const span = Math.ceil(radius);
  for (let r = cr - span; r <= cr + span; r++) {
    for (let c = cc - span; c <= cc + span; c++) {
      if (r < 0 || c < 0 || r >= BK_ROWS || c >= BK_COLS) continue;
      const d = Math.hypot(c - cc, r - cr);
      if (d <= radius && (d < 1.2 || R.bunker() < 0.65)) b.cells[r * BK_COLS + c] = 0;
    }
  }
  b.dirty = true;
  for (let i = 0; i < 5; i++) {
    spawn({ x: b.x + cc * BK_CELL, y: b.y + cr * BK_CELL, vx: rand(-80, 80), vy: rand(-80, 80), life: rand(0.2, 0.5), size: 3, color: '#4dff88', type: 'square' });
  }
}

function carveBunkers(inv) {
  for (const b of bunkers) {
    if (!overlap(inv, b)) continue;
    const { c0, c1, r0, r1 } = cellRange(b, inv);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) b.cells[r * BK_COLS + c] = 0;
    b.dirty = true;
  }
}

function drawBunkers() {
  for (const b of bunkers) {
    if (b.dirty) {
      const x = b.cv.getContext('2d');
      x.clearRect(0, 0, b.w, b.h);
      x.fillStyle = '#4dff88';
      for (let r = 0; r < BK_ROWS; r++) for (let c = 0; c < BK_COLS; c++) {
        if (b.cells[r * BK_COLS + c]) x.fillRect(c * BK_CELL, r * BK_CELL, BK_CELL, BK_CELL);
      }
      b.dirty = false;
    }
    ctx.drawImage(b.cv, b.x, b.y);
  }
}

// ------------------------------------------------------------------
// Partículas, textos y efectos
// ------------------------------------------------------------------
function spawn(p) {
  p.dead = false;
  p.max = p.life;
  if (p.drag == null) p.drag = 0.94;
  particles.push(p);
}

function explode(x, y, color, count = 24, power = 220) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU), sp = rand(0.25, 1) * power;
    spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.85),
      size: rand(1.5, 3.5), color: Math.random() < 0.25 ? '#ffffff' : color,
      type: Math.random() < 0.6 ? 'spark' : 'square',
    });
  }
  spawn({ x, y, vx: 0, vy: 0, life: 0.35, size: power * 0.28, color, type: 'ring', drag: 1 });
  spawn({ x, y, vx: 0, vy: 0, life: 0.14, size: power * 0.22, color, type: 'flash', drag: 1 });
}

function floatText(x, y, str, color = '#fff', size = 12) {
  texts.push({ x, y, str, color, size, life: 1.1, max: 1.1, dead: false });
}

function addShake(n) { if (settings.get('shake')) shake = Math.min(shake + n, 22); }
function flash(v) { if (settings.get('flashes')) flashScreen = Math.max(flashScreen, v); }

function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    if (p.life <= 0) { p.dead = true; continue; }
    const k = Math.pow(p.drag, dt * 60);
    p.vx *= k; p.vy *= k;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  compact(particles);
  for (const t of texts) {
    t.life -= dt; t.y -= 38 * dt;
    if (t.life <= 0) t.dead = true;
  }
  compact(texts);
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const a = p.life / p.max;
    ctx.globalAlpha = a;
    if (p.type === 'spark') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    } else if (p.type === 'square') {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else if (p.type === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lerp(p.size, 4, a), 0, TAU);
      ctx.stroke();
    } else if (p.type === 'flash') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
  }
  ctx.restore();
  for (const t of texts) {
    drawText(t.str, t.x, t.y, { size: t.size, color: t.color, alpha: Math.min(1, t.life / t.max * 2) });
  }
}

function drawText(str, x, y, o = {}) {
  ctx.save();
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  ctx.font = `${o.size || 14}px ${FONT}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur || 14; }
  ctx.fillStyle = o.color || '#fff';
  ctx.fillText(str, x, y);
  ctx.restore();
}

// ------------------------------------------------------------------
// Jugador
// ------------------------------------------------------------------
function playerBox() {
  return { x: player.x - player.w * 0.3, y: player.y - player.h * 0.35, w: player.w * 0.6, h: player.h * 0.75 };
}

function updatePlayer(dt) {
  if (!player.alive) return;
  const speedMax = PLAYER_SPEED * (1 + 0.12 * upgrades.speed);
  const target = input.axis * speedMax;
  player.vx = lerp(player.vx, target, 1 - Math.pow(0.00002, dt));
  player.x = clamp(player.x + player.vx * dt, player.w / 2 + 6, W - player.w / 2 - 6);
  player.tilt = lerp(player.tilt, (player.vx / speedMax) * 0.28, Math.min(1, dt * 12));
  player.cooldown -= dt;
  player.invuln = Math.max(0, player.invuln - dt);
  player.triple = Math.max(0, player.triple - dt);
  player.rapid = Math.max(0, player.rapid - dt);
  if (input.fire && player.cooldown <= 0) fire();

  // Estela del motor
  if (Math.random() < 0.9) {
    spawn({
      x: player.x + rand(-6, 6), y: player.y + player.h * 0.42, vx: rand(-20, 20), vy: rand(120, 220),
      life: rand(0.12, 0.25), size: rand(2, 3.5), color: pick(['#ff7b2e', '#ffd23f', '#5dc1b9']), type: 'square',
    });
  }
}

function fire() {
  player.cooldown = (player.rapid > 0 ? 0.09 : 0.24) * Math.pow(0.85, upgrades.rate);
  const shots = [];
  // Cañón doble: dos disparos paralelos en el centro
  if (upgrades.twin) shots.push([0, -7], [0, 7]);
  else shots.push([0, 0]);
  if (player.triple > 0) shots.push([-0.17, 0], [0.17, 0]);
  for (const [a, dx] of shots) {
    bullets.push({
      x: player.x - 2 + dx, y: player.y - player.h / 2, w: 4, h: 16,
      vx: Math.sin(a) * BULLET_SPEED, vy: -Math.cos(a) * BULLET_SPEED,
      pierce: upgrades.pierce, hits: [], dead: false,
    });
    stats.shots++;
  }
  spawn({ x: player.x, y: player.y - player.h / 2, vx: 0, vy: 0, life: 0.06, size: 14, color: '#fff', type: 'flash', drag: 1 });
  Sound.shoot();
}

function hitPlayer(force = false) {
  if (!player.alive) return;
  if (!force && player.invuln > 0) return;
  if (!force && player.shield) {
    player.shield = false;
    player.invuln = 1;
    explode(player.x, player.y, '#7cff6b', 30, 200);
    Sound.shield();
    vibrate(40);
    addShake(5);
    return;
  }
  waveHits++;
  combo = 0; comboTimer = 0;
  player.triple = 0; player.rapid = 0;
  explode(player.x, player.y, '#ffffff', 50, 320);
  explode(player.x, player.y, '#ff7b2e', 40, 240);
  Sound.hurt();
  vibrate([90, 40, 140]);
  addShake(14); hitStop = 0.08; flash(0.25);
  if (!force) lives--;
  player.alive = false;
  deathTimer = 1.6;
  enemyBullets.length = 0;
}

function updateDeath(dt) {
  if (player.alive || deathTimer <= 0) return;
  deathTimer -= dt;
  if (deathTimer <= 0) {
    if (lives > 0) {
      player.alive = true;
      player.x = W / 2; player.vx = 0;
      player.invuln = 2.2;
    } else {
      gameOver();
    }
  }
}

function gameOver() {
  state = 'gameover'; stateTime = 0;
  waveLog.push('💀');
  const prevBest = best();
  newRecord = mode === 'classic' && score > 0 && score > prevBest;
  if (mode === 'daily' && !practice) {
    dailyRecord.finish(dailyDay, { score, wave, grid: waveLog.slice(), submitted: false });
  }
  if (mode === 'classic' && score > 0) {
    highscores.push({ score, wave, date: new Date().toISOString().slice(0, 10) });
    highscores.sort((a, b) => b.score - a.score);
    highscores = highscores.slice(0, 5);
    store.set('invaders.highscores', highscores);
  }
  achievements.event('gameOver', { shots: stats.shots, hits: stats.hits, daily: mode === 'daily' && !practice });
  achievements.flush();
  Sound.over();
  offerSubmit();
}

function offerSubmit() {
  if (mode === 'versus') {
    if (match) match.gameOver({ score, wave });
    return;
  }
  const daily = mode === 'daily';
  const day = dailyDay;
  const token = runToken;
  const later = (fn) => setTimeout(() => {
    if (state === 'gameover' && token === runToken && !ui.isOpen()) { input.keys.clear(); fn(); }
  }, 1100);

  if (!online.enabled || score <= 0 || cheated || practice || !runId) {
    // Sin ranking: el diario igual muestra el resultado para compartir
    if (daily && !practice) later(() => openDailyPanel(day));
    return;
  }
  const run = { run: runId, score, wave, kills: stats.kills };
  const result = { day, score, wave, grid: waveLog.slice() };
  later(() => ui.openSubmit({
    score: run.score,
    wave: run.wave,
    title: daily ? `DESAFÍO ${formatDay(day)}` : newRecord ? '¡NUEVO RÉCORD!' : 'GUARDAR PUNTAJE',
    scope: daily ? 'daily' : 'global',
    submit: async (name) => {
      const lg = league.get();
      const res = await api.submitScore({ ...run, name, leagueCode: lg && lg.code });
      if (daily) dailyRecord.update(day, { submitted: true, rank: res.world_rank, players: res.players });
      return res;
    },
    onPlayAgain: daily ? null : () => newGame(),
    extraActions: daily ? [{ label: 'COMPARTIR', onClick: () => ui.shareDaily(result) }] : [],
  }));
}

function openDailyPanel(day = todayUTC()) {
  input.keys.clear();
  ui.openDaily({
    day,
    record: dailyRecord.get(day),
    onPlay: () => newGame({ mode: 'daily', day }),
    onPractice: () => newGame({ mode: 'daily', day, practice: true }),
  });
}

function openUpgradeChoice() {
  const options = offerUpgrades(upgrades, R.upgrade, { canAddLife: lives < MAX_LIVES });
  if (!options.length) { startWave(wave + 1); return; }
  state = 'upgrade';
  input.keys.clear();
  ui.openUpgrade({
    wave,
    options,
    levels: upgrades,
    onPick: (id) => {
      applyUpgrade(id);
      state = 'playing';
      startWave(wave + 1);
    },
  });
}

function applyUpgrade(id) {
  upgrades[id]++;
  achievements.event('upgrades', { total: Object.values(upgrades).reduce((a, b) => a + b, 0) });
  if (id === 'life') lives = Math.min(lives + 1, MAX_LIVES);
  const u = UPGRADES.find((x) => x.id === id);
  floatText(player.x, player.y - 50, u.name, '#ffd23f', 11);
  Sound.power();
}

function openOptionsFromGame() {
  if (ui.isOpen()) return;
  if (state === 'playing') togglePause();
  input.keys.clear();
  ui.openOptions();
}

// ------------------------------------------------------------------
// Versus 1 contra 1
// ------------------------------------------------------------------
function openVersusLobby(code = '') {
  if (!online.enabled) { ui.toast('El versus necesita el servidor online'); return; }
  if (ui.isOpen()) return;
  input.keys.clear();
  ui.openVersus({
    code,
    onCreate: (name) => startMatch(newRoomCode(), name),
    onJoin: (c, name) => startMatch(c, name),
  });
}

function startMatch(code, name) {
  leaveMatch();
  vsRoom = ui.versusRoom({ code, onCancel: () => { if (match && match.status !== 'countdown') leaveMatch(); } });
  const id = `${deviceId().slice(0, 8)}-${Math.random().toString(36).slice(2, 10)}`;
  match = createMatch({
    code, name, id,
    connect: (onMessage, onStatus) => joinChannel(channelName(code), { onMessage, onStatus }),
    onEvent: onVersusEvent,
  });
}

function leaveMatch() {
  if (match) { const m = match; match = null; m.leave(); }
  vsRoom = null;
  vsResultPanel = null;
}

function onVersusEvent(type, data) {
  const m = match;
  if (!m) return;
  if (type === 'status' || type === 'rival' || type === 'error') {
    if (vsRoom) vsRoom.update({ status: m.status, rival: m.rival, error: data.reason });
    if (type === 'rival' && vsResultPanel) {
      if (data.rival.gone) vsResultPanel.rivalLeft();
      else if (data.rival.again) vsResultPanel.rivalWantsRematch();
    }
    if (type === 'status' && data.status === 'full') ui.toast('Esa sala ya tiene dos jugadores');
    return;
  }
  if (type === 'start') {
    vsRoom = null;
    vsResultPanel = null;
    if (ui.isOpen()) ui.close();
    newGame({ mode: 'versus', seed: data.seed });
    vsStartAt = performance.now() + data.delay;
    vsCountdown = data.delay / 1000;
    return;
  }
  if (type === 'attack') { receiveAttack(data.n); return; }
  if (type === 'result') {
    vsResult = data;
    if (data.outcome === 'win') achievements.event('versusWin');
    // El rival se fue mientras jugabas: la partida termina acá
    if (state === 'playing' && player.alive) {
      banner = { text: 'YOU WIN', sub: (m.rival ? m.rival.name : 'RIVAL') + ' DISCONNECTED', t: 2, color: '#ffd23f' };
      gameOver();
    }
    setTimeout(() => showVersusResult(), state === 'gameover' && stateTime < 1 ? 1100 : 0);
  }
}

function showVersusResult() {
  if (!match || !vsResult || mode !== 'versus') return;
  if (ui.isOpen()) ui.close();
  input.keys.clear();
  vsResultPanel = ui.versusResult({
    ...vsResult,
    onRematch: () => (match ? match.rematch() : false),
    onMenu: () => { leaveMatch(); ui.close(); backToMenu(2); },
  });
}

function versusTick() {
  if (!match) return;
  match.report({ score, wave, lives, alive: player.alive });
  const r = match.rival;
  if (!r) return;
  if (r.over && !vsRivalDown && player.alive) {
    vsRivalDown = true;
    banner = { text: 'RIVAL DOWN', sub: score > r.score ? 'YOU ARE AHEAD · KEEP GOING' : 'BEAT ' + r.score + ' TO WIN', t: 2.4, color: '#ff4fd8' };
  }
  if (vsRivalDown && !vsLeadShown && score > r.score) {
    vsLeadShown = true;
    banner = { text: 'YOU LEAD!', sub: 'NOW SURVIVE TO SCORE MORE', t: 2, color: '#ffd23f' };
    Sound.life();
  }
}

function sendAttack(n) {
  if (mode !== 'versus' || !match || match.status !== 'playing') return;
  match.attack(n);
  floatText(player.x, player.y - 64, 'ATTACK SENT x' + n, '#ff4fd8', 11);
}

// Invasores extra que manda el rival: bajan en picada (no usan el azar compartido)
function receiveAttack(n) {
  if (state !== 'playing' || !player.alive) return;
  vsIncoming += n;
  const x = 80 + Math.random() * (W - 160);
  spawnMinis(x, -30, n);
  banner = { text: 'INCOMING!', sub: n + ' INVADERS FROM ' + (match && match.rival ? match.rival.name : 'RIVAL'), t: 1.2, color: '#ff4fd8' };
  Sound.warning();
}

function openAchievementsFromGame() {
  if (ui.isOpen()) return;
  if (state === 'playing') togglePause();
  input.keys.clear();
  ui.openAchievements({ list: achievements.list(), count: achievements.count, total: achievements.total });
}

function openRankingFromGame(scope) {
  if (!online.enabled || ui.isOpen()) return;
  if (state === 'playing') togglePause();
  input.keys.clear();
  ui.openRanking({ scope });
}

// ------------------------------------------------------------------
// Puntuación, combos, power-ups
// ------------------------------------------------------------------
function multiplier() { return Math.min(1 + Math.floor(combo / 5), 5); }

function registerKill() {
  combo = comboTimer > 0 ? combo + 1 : 1;
  comboTimer = 1.6;
  if (combo > maxCombo) maxCombo = combo;
  if (combo >= 10) achievements.event('combo', { combo });
  if (combo > 0 && combo % 10 === 0) sendAttack(1);
  if (combo > 0 && combo % 5 === 0 && multiplier() <= 5) {
    floatText(player.x, player.y - 50, 'COMBO x' + multiplier(), '#ffd23f', 12);
  }
}

function addScore(n) {
  score += n;
  if (score >= 100000) achievements.event('score', { score });
  while (score >= nextLife) {
    nextLife += EXTRA_LIFE_EVERY;
    if (lives < MAX_LIVES) {
      lives++;
      floatText(W / 2, H / 2 + 60, 'EXTRA LIFE!', '#ff4fd8', 16);
      Sound.life();
      vibrate([40, 40, 40]);
    }
  }
}

function dropPower(x, y, forced = false) {
  if (!forced && R.drop() > 0.075) return;
  let r = R.drop(), type = 'T';
  for (const [k, v] of Object.entries(POWERS)) { if (r < v.weight) { type = k; break; } r -= v.weight; }
  if (type === 'L' && lives >= MAX_LIVES) type = 'S';
  powerups.push({ x: x - 13, y, w: 26, h: 26, vy: 110, type, t: 0, dead: false });
}

const powerTime = () => POWER_TIME * (1 + 0.5 * upgrades.duration);

function collectPower(p) {
  const info = POWERS[p.type];
  if (p.type === 'T') player.triple = powerTime();
  if (p.type === 'R') player.rapid = powerTime();
  if (p.type === 'S') player.shield = true;
  if (p.type === 'L') lives = Math.min(lives + 1, MAX_LIVES);
  floatText(player.x, player.y - 46, info.name, info.color, 12);
  explode(p.x + 13, p.y + 13, info.color, 16, 140);
  Sound.power();
  vibrate(30);
}

function killInvader(inv) {
  inv.dead = true;
  registerKill();
  const t = INV_TYPES[inv.type];
  const diving = inv.state !== 'formation';
  const pts = t.points * multiplier() * (diving ? 2 : 1);
  addScore(pts);
  stats.kills++;
  achievements.event('kill');
  const cx = inv.x + inv.w / 2, cy = inv.y + inv.h / 2;
  floatText(cx, cy, (diving ? '2X ' : '') + pts, t.color, 10);
  explode(cx, cy, t.color, 26, 230);
  Sound.explode();
  addShake(2.5);
  dropPower(cx, cy);
  if (inv.kind === 'splitter') spawnMinis(cx, inv.y + 6, 2);
}

// ------------------------------------------------------------------
// Colisiones
// ------------------------------------------------------------------
function collisions() {
  // Balas del jugador vs balas enemigas (se anulan)
  for (const b of bullets) {
    for (const e of enemyBullets) {
      if (!e.dead && e.kind !== 'orb' && e.kind !== 'lava' && overlap(b, e)) {
        b.dead = true;
        if (e.hp > 1) { e.hp--; e.flash = 0.08; } else e.dead = true;
        explode(b.x, b.y, '#ffffff', 8, 120);
        break;
      }
    }
  }

  for (const b of bullets) {
    if (b.dead) continue;
    if (hitBunkers(b, false)) { b.dead = true; continue; }
    if (hitAsteroid(b, true)) { b.dead = true; continue; }

    for (const inv of invaders) {
      if (inv.dead || b.hits.includes(inv) || !overlap(b, inv)) continue;
      stats.hits++;
      inv.hp--;
      if (inv.hp <= 0) killInvader(inv);
      else { inv.flash = 0.08; Sound.bossHit(); spawn({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.1, size: 18, color: '#fff', type: 'flash', drag: 1 }); }
      // Perforante: el disparo sigue hasta agotar los enemigos que puede atravesar
      if (b.pierce > 0) { b.pierce--; b.hits.push(inv); continue; }
      b.dead = true;
      break;
    }
    if (b.dead) continue;

    // TITÁN: las rocas que orbitan frenan los disparos
    if (boss && boss.kind === 'titan' && boss.dying <= 0 && !boss.entering) {
      const rock = boss.rocks.find((r) => {
        const pos = rockPos(boss, r);
        return overlap(b, { x: pos.x - r.r * 0.8, y: pos.y - r.r * 0.8, w: r.r * 1.6, h: r.r * 1.6 });
      });
      if (rock) {
        b.dead = true; stats.hits++;
        rock.hp--; rock.flash = 0.08;
        if (rock.hp <= 0) {
          const pos = rockPos(boss, rock);
          boss.rocks = boss.rocks.filter((r) => r !== rock);
          boss.broken++;
          explode(pos.x, pos.y, '#d9a066', 16, 160);
          Sound.rock();
          addScore(100);
          floatText(pos.x, pos.y, '100', '#d9a066', 10);
          achievements.event('rock');
        }
        continue;
      }
    }

    if (boss && boss.dying <= 0 && !boss.entering && !boss.intangible) {
      const bb = { x: boss.x - boss.w / 2, y: boss.y - boss.h / 2, w: boss.w, h: boss.h };
      if (overlap(b, bb)) {
        b.dead = true; stats.hits++;
        addScore(10);
        Sound.bossHit();
        const spark = BOSS_COLORS[boss.kind].bar;
        for (let i = 0; i < 4; i++) spawn({ x: b.x, y: b.y, vx: rand(-160, 160), vy: rand(-60, 160), life: 0.3, size: 2, color: spark, type: 'spark' });
        damageBoss(1);
        continue;
      }
    }

    if (ufo && overlap(b, ufo)) {
      b.dead = true; stats.hits++;
      const pts = rpick('ufo', [300, 500, 800, 1000, 1500]);
      addScore(pts);
      registerKill();
      floatText(ufo.x + 30, ufo.y + 12, '' + pts, '#ff4fd8', 14);
      achievements.event('ufo');
      explode(ufo.x + 30, ufo.y + 12, '#ff4fd8', 40, 280);
      Sound.big(); addShake(6);
      dropPower(ufo.x + 30, ufo.y + 12, true);
      ufo = null;
    }
  }

  // Balas enemigas
  const pb = playerBox();
  for (const e of enemyBullets) {
    if (e.dead) continue;
    if (hitAsteroid(e, false)) { e.dead = true; continue; }
    if (hitBunkers(e, true, { lava: 3.6, rock: 4.2, debris: 3 }[e.kind] || 2.6)) { e.dead = true; continue; }
    if (player.alive && overlap(e, pb)) { e.dead = true; hitPlayer(); }
  }

  // FÉNIX en picada: chocarlo duele
  if (boss && boss.kind === 'phoenix' && (boss.mode === 'dive' || boss.mode === 'rise') && !boss.hitDone && player.alive) {
    if (overlap({ x: boss.x - boss.w * 0.35, y: boss.y - boss.h * 0.4, w: boss.w * 0.7, h: boss.h * 0.8 }, pb)) {
      boss.hitDone = true;
      hitPlayer();
    }
  }

  // Invasores en picada vs jugador
  if (player.alive) {
    for (const inv of invaders) {
      if (inv.dead || inv.state !== 'dive' || !overlap(inv, pb)) continue;
      if (player.invuln > 0 && !player.shield) continue;
      killInvader(inv);
      hitPlayer();
      break;
    }
    for (const p of powerups) {
      if (!p.dead && overlap(p, pb)) { p.dead = true; collectPower(p); }
    }
  }

  compact(bullets); compact(enemyBullets); compact(invaders); compact(powerups); compact(asteroids);
}

// ------------------------------------------------------------------
// Update principal
// ------------------------------------------------------------------
function update(dt) {
  banner.t -= dt;
  comboTimer = Math.max(0, comboTimer - dt);
  if (comboTimer === 0) combo = 0;

  updatePlayer(dt);
  updateDeath(dt);
  if (state !== 'playing') return;

  const pull = sector === 3 ? GRAVITY : 0; // agujero negro: curva todos los disparos hacia el centro
  for (const b of bullets) {
    if (pull) b.vx += (W / 2 - b.x) * pull * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y + b.h < 0 || b.x < -20 || b.x > W + 20) b.dead = true;
  }
  for (const e of enemyBullets) {
    if (pull) e.vx += (W / 2 - e.x) * pull * dt;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.verts) e.rot += dt * 3;
    if (e.flash) e.flash = Math.max(0, e.flash - dt);
    if (e.y > H + 20 || e.y < -40 || e.x < -40 || e.x > W + 40) e.dead = true;
  }
  for (const p of powerups) {
    p.t += dt; p.y += p.vy * dt;
    if (upgrades.magnet && player.alive) {
      const dx = player.x - (p.x + p.w / 2);
      p.x += Math.sign(dx) * Math.min(Math.abs(dx), 300 * dt);
      p.vy = 170;
    }
    if (p.y > H) p.dead = true;
  }

  if (boss) {
    updateBoss(dt);
    for (const inv of invaders) moveInvader(inv, dt); // escoltas del jefe
  } else {
    updateFormation(dt);
  }
  if (state !== 'playing') return;
  updateLasers(dt);
  updateHazards(dt);
  vortexSuction(dt);
  updateUfo(dt);
  collisions();

  // ¿Oleada superada?
  if (!boss && invaders.length === 0 && clearTimer <= 0 && player.alive) {
    const bonus = 250 * wave;
    const perfect = waveHits === 0 ? 1000 * wave : 0;
    addScore(bonus + perfect);
    achievements.event('waveClear', { wave, perfect: waveHits === 0 });
    sendAttack(waveHits === 0 ? 3 : 2);
    banner = { text: 'WAVE CLEAR', sub: perfect ? 'PERFECT! +' + (bonus + perfect) : 'BONUS +' + bonus, t: 2.2, color: '#ffd23f' };
    waveLog.push(cfg.boss ? '👑' : waveHits === 0 ? '🟩' : '🟨');
    Sound.clear();
    clearTimer = 2.4;
    enemyBullets.length = 0;
  }
  if (clearTimer > 0) {
    clearTimer -= dt;
    if (clearTimer <= 0) {
      if (upgradeDue(wave, cfg.boss)) openUpgradeChoice();
      else startWave(wave + 1);
    }
  }
}

function updateAmbient(dt) {
  warp = Math.max(0, warp - dt);
  const intro = state === 'playing' && banner && banner.t > 0 && !cfg.boss ? 3 : 1;
  const boost = intro + warp * 12;
  for (const s of stars) {
    s.y += s.v * dt * boost;
    if (s.y > H) { s.y -= H; s.x = rand(0, W); }
  }
  shake = Math.max(0, shake - dt * 40);
  flashScreen = Math.max(0, flashScreen - dt);
  updateParticles(dt);
}

// ------------------------------------------------------------------
// Render
// ------------------------------------------------------------------
// Nebulosa pre-dibujada (el doble de ancho para desplazarla sin cortes)
let nebulaCanvas = null;
function nebula() {
  if (nebulaCanvas) return nebulaCanvas;
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H;
  const x = c.getContext('2d');
  const blobs = [
    ['rgba(155,60,255,0.22)', 300, 180, 260], ['rgba(255,79,216,0.16)', 760, 330, 300],
    ['rgba(93,193,185,0.10)', 1220, 150, 240], ['rgba(255,79,216,0.14)', 1560, 390, 280],
    ['rgba(155,60,255,0.18)', 1820, 210, 220],
  ];
  for (const [col, bx, by, br] of blobs) {
    const g = x.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
  }
  nebulaCanvas = c;
  return c;
}

function drawSectorScenery() {
  if (sector === 0) {
    // La Tierra asoma abajo, con el brillo de la atmósfera
    const r = 1400, cy = H + r - 46;
    const g = ctx.createLinearGradient(0, H - 46, 0, H);
    g.addColorStop(0, 'rgba(40,110,190,0.55)');
    g.addColorStop(1, 'rgba(8,26,52,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(W / 2, cy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(93,193,185,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, cy, r, 0, TAU); ctx.stroke();
  } else if (sector === 1) {
    const off = (time * 10) % (W * 2);
    ctx.drawImage(nebula(), -off, 0);
    ctx.drawImage(nebula(), W * 2 - off, 0);
  } else if (sector === 2) {
    // Polvo del cinturón: una franja tenue
    ctx.fillStyle = 'rgba(217,160,102,0.07)';
    ctx.beginPath(); ctx.ellipse(W / 2, 280, W * 0.75, 90, -0.08, 0, TAU); ctx.fill();
  } else if (sector === 3) {
    // Agujero negro con disco de acreción
    const cx = W / 2, cy = 150;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = ['rgba(255,140,60,0.22)', 'rgba(155,123,255,0.20)', 'rgba(255,79,216,0.12)'][i];
      ctx.lineWidth = 10 - i * 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 120 + i * 26, 30 + i * 7, Math.sin(time * 0.3) * 0.08, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 70);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.6, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(155,123,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 70, 0, TAU); ctx.fill();
  } else {
    // Borde del sol arriba, latiendo
    const r = 900, cy = -r + 70 + Math.sin(time * 1.5) * 4;
    const g = ctx.createRadialGradient(W / 2, cy, r - 60, W / 2, cy, r + 90);
    g.addColorStop(0, 'rgba(255,230,140,0.9)');
    g.addColorStop(0.4, 'rgba(255,140,26,0.55)');
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 200);
  }
}

function drawBackground() {
  const [c0, c1, c2] = SECTORS[sector].bg;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, c0);
  g.addColorStop(0.6, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (state !== 'menu') drawSectorScenery();
  // En el salto al hiperespacio las estrellas se estiran
  const stretch = 1 + warp * 24;
  for (const s of stars) {
    const a = s.l === 0 ? 0.35 + 0.35 * Math.sin(time * 2 + s.tw) : s.l === 1 ? 0.7 : 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = s.l === 2 ? '#cfe9ff' : sector === 4 ? '#ffe2c4' : '#ffffff';
    ctx.fillRect(s.x, s.y, s.s, s.s * (s.l === 2 ? 3 : 1) * stretch);
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  if (!player.alive) return;
  if (player.invuln > 0 && Math.floor(time * 16) % 2 === 0) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.tilt);
  if (SPR.ship) ctx.drawImage(SPR.ship, -player.w / 2, -player.h / 2, player.w, player.h);
  else { ctx.fillStyle = '#5dc1b9'; ctx.fillRect(-player.w / 2, -player.h / 4, player.w, player.h / 2); }
  ctx.restore();
  if (player.shield) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#7cff6b';
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 8);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(player.x, player.y, player.w * 0.62, player.h * 0.85, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawInvaders() {
  for (const inv of invaders) {
    if (inv.kind === 'magmita') {
      drawJelly(ctx, inv.x + inv.w / 2, inv.y + inv.h * 0.45, 14, time * 1.5 + inv.wob, { flashOn: inv.flash > 0, tentacles: 3 });
      continue;
    }
    const spr = inv.flash > 0 ? SPR.invFlash : SPR.inv[inv.type];
    if (!spr) continue;
    // Pequeño "squash" alternado para simular animación de 2 frames
    const sq = 1 + (Math.floor(time * 3 + (inv.col ?? inv.wob)) % 2 ? 0.06 : -0.04);
    const w = inv.w * sq, h = inv.h / sq;
    ctx.drawImage(spr, inv.x + (inv.w - w) / 2, inv.y + (inv.h - h) / 2, w, h);
    if (inv.hp > 1 && inv.flash <= 0) {
      ctx.fillStyle = INV_TYPES[inv.type].color;
      ctx.fillRect(inv.x + 6, inv.y - 5, inv.w - 12, 2);
    }
  }
}

function drawBoss() {
  if (!boss) return;
  const b = boss;
  const c = BOSS_COLORS[b.kind];
  const enraged = b.hp < b.maxHp * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = b.kind === 'magma' ? b.alpha : 1;
  const g = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, b.w);
  g.addColorStop(0, `rgba(${c.glow},0.35)`);
  g.addColorStop(1, `rgba(${c.glow},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.w, b.y - b.w, b.w * 2, b.w * 2);
  ctx.restore();
  if (b.kind === 'magma') drawJelly(ctx, b.x, b.y + 22, 75, b.t, { alpha: b.alpha, flashOn: b.flash > 0, tentacles: 7 });
  else if (b.kind === 'titan') drawTitan(ctx, b, b.t, enraged);
  else if (b.kind === 'vortex') drawVortex(ctx, b, b.t);
  else if (b.kind === 'phoenix') drawPhoenix(ctx, b, b.t);
  else {
    const spr = b.flash > 0 ? SPR.bossFlash : SPR.boss;
    if (spr) ctx.drawImage(spr, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }
  if (state === 'gameover') return;

  // Barra de vida
  const bw = 420, bx = (W - bw) / 2, by = 62;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw, 8);
  ctx.fillStyle = enraged ? '#ffd23f' : c.bar;
  ctx.fillRect(bx, by, (bw * Math.max(0, b.hp)) / b.maxHp, 8);
  drawText(b.name, W / 2, by - 10, { size: 8, color: c.label });
}

function drawUfo() {
  if (!ufo) return;
  const { x, y } = ufo;
  ctx.save();
  ctx.fillStyle = 'rgba(120,230,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(x + 30, y + 8, 13, 10, 0, Math.PI, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y + 6, 0, y + 22);
  g.addColorStop(0, '#ff9ae6'); g.addColorStop(1, '#8a1f6b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x + 30, y + 14, 30, 9, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = Math.floor(time * 8 + i) % 2 ? '#ffd23f' : '#ffffff';
    ctx.fillRect(x + 8 + i * 11, y + 13, 3, 3);
  }
  ctx.restore();
}

function drawRockBullets() {
  for (const e of enemyBullets) {
    if (e.kind === 'rock' || e.kind === 'debris') drawRock(ctx, e.x + e.w / 2, e.y + e.h / 2, e.r, e.verts, e.rot, e.flash > 0);
  }
}

function drawBullets() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bullets) {
    ctx.fillStyle = 'rgba(93,193,185,0.22)';
    ctx.fillRect(b.x - 2, b.y + 2, b.w + 4, b.h + 8);
    ctx.fillStyle = '#bffff8';
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  for (const e of enemyBullets) {
    if (e.kind === 'rock' || e.kind === 'debris') continue;
    if (e.kind === 'feather') {
      ctx.strokeStyle = '#ffb020';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.x + 3, e.y + 7);
      ctx.lineTo(e.x + 3 - e.vx * 0.04, e.y + 7 - e.vy * 0.04);
      ctx.stroke();
      continue;
    }
    if (e.kind === 'lava') {
      ctx.fillStyle = 'rgba(255,120,20,0.35)';
      ctx.beginPath(); ctx.arc(e.x + 5, e.y + 5, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,90,31,0.6)';
      ctx.fillRect(e.x + 3, e.y - 8, 4, 10);
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath(); ctx.arc(e.x + 5, e.y + 5, 4.5, 0, TAU); ctx.fill();
    } else if (e.kind === 'orb') {
      ctx.fillStyle = 'rgba(255,59,92,0.4)';
      ctx.beginPath(); ctx.arc(e.x + 5, e.y + 5, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd0d8';
      ctx.beginPath(); ctx.arc(e.x + 5, e.y + 5, 4, 0, TAU); ctx.fill();
    } else {
      const col = e.kind === 'aimed' ? '#ff7b2e' : '#ff4fd8';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const zig = Math.floor(time * 20) % 2 ? 2 : -2;
      ctx.moveTo(e.x + 2, e.y);
      ctx.lineTo(e.x + 2 + zig, e.y + 4);
      ctx.lineTo(e.x + 2 - zig, e.y + 8);
      ctx.lineTo(e.x + 2, e.y + 12);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPowerups() {
  for (const p of powerups) {
    const info = POWERS[p.type];
    const pulse = 1 + Math.sin(p.t * 8) * 0.08;
    const cx = p.x + 13, cy = p.y + 13;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = info.color; ctx.shadowBlur = 14;
    ctx.strokeStyle = info.color; ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(10,6,32,0.85)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-13, -13, 26, 26, 6); else ctx.rect(-13, -13, 26, 26);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    drawText(p.type, cx + 1, cy + 1, { size: 12, color: info.color });
  }
}

function drawShipIcon(x, y, s) {
  if (SPR.ship) ctx.drawImage(SPR.ship, x, y, 90 * s, 45 * s);
}

function drawHUD() {
  drawText('SCORE', 20, 20, { size: 9, color: '#8a86b8', align: 'left' });
  drawText(String(score).padStart(7, '0'), 20, 38, { size: 14, align: 'left', glow: '#5dc1b9', blur: 8 });
  if (multiplier() > 1) {
    drawText('x' + multiplier(), 150, 38, { size: 12, color: '#ffd23f', align: 'left', glow: '#ffd23f', blur: 8 });
  }
  if (combo > 1) {
    ctx.fillStyle = 'rgba(255,210,63,0.6)';
    ctx.fillRect(20, 50, 100 * (comboTimer / 1.6), 3);
  }
  const hi = mode === 'classic' ? Math.max(best(), score) : best(); // el récord local es del modo normal
  drawText('HI ' + String(hi).padStart(7, '0'), W / 2, 20, { size: 10, color: '#ff4fd8' });
  const modeTag = mode === 'daily' ? (practice ? 'PRACTICE · ' : 'DAILY · ') : mode === 'versus' ? 'VERSUS · ' : '';
  drawText(modeTag + 'S' + (sector + 1) + ' · WAVE ' + wave, W / 2, 38, { size: 9, color: mode === 'daily' ? '#ffd23f' : SECTORS[sector].color });

  for (let i = 0; i < lives; i++) drawShipIcon(16 + i * 34, H - 26, 0.32);
  const owned = UPGRADES.filter((u) => upgrades[u.id] > 0 && u.id !== 'life')
    .map((u) => u.icon + (upgrades[u.id] > 1 ? upgrades[u.id] : ''));
  if (owned.length) drawText(owned.join(' '), 16, H - 44, { size: 12, align: 'left', alpha: 0.85 });

  let px = W - 20;
  const bars = [];
  if (player.triple > 0) bars.push(['TRIPLE', player.triple / powerTime(), POWERS.T.color]);
  if (player.rapid > 0) bars.push(['RAPID', player.rapid / powerTime(), POWERS.R.color]);
  if (player.shield) bars.push(['SHIELD', 1, POWERS.S.color]);
  for (const [name, f, col] of bars) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(px - 80, H - 18, 80, 5);
    ctx.fillStyle = col;
    ctx.fillRect(px - 80, H - 18, 80 * f, 5);
    drawText(name, px - 40, H - 30, { size: 7, color: col });
    px -= 96;
  }
}

function drawRivalHUD() {
  if (mode !== 'versus' || !match) return;
  const r = match.rival;
  const x = W - 20, y = 70;
  ctx.save();
  ctx.fillStyle = 'rgba(5,1,15,0.6)';
  ctx.strokeStyle = 'rgba(255,79,216,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - 190, y - 14, 190, 64, 8); else ctx.rect(x - 190, y - 14, 190, 64);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (!r) { drawText('WAITING FOR RIVAL', x - 95, y + 18, { size: 8, color: '#8a86b8' }); return; }
  drawText('VS ' + r.name.toUpperCase(), x - 180, y, { size: 8, color: '#ff4fd8', align: 'left' });
  drawText(r.gone ? 'LEFT' : r.over ? 'OUT' : 'W' + r.wave, x - 10, y, { size: 8, color: r.over || r.gone ? '#ff6b81' : '#5dc1b9', align: 'right' });
  drawText(String(r.score).padStart(7, '0'), x - 180, y + 20, { size: 12, align: 'left' });
  for (let i = 0; i < Math.min(r.lives, 5) && !r.over; i++) drawShipIcon(x - 22 - i * 24, y + 20, 0.22);
  const diff = score - r.score;
  const lead = diff >= 0;
  drawText((lead ? '+' : '-') + Math.abs(diff), x - 180, y + 40, { size: 8, color: lead ? '#4ef08a' : '#ff6b81', align: 'left' });
  // Barra de quién va ganando
  const total = Math.max(score + r.score, 1);
  ctx.fillStyle = '#ff4fd8';
  ctx.fillRect(x - 100, y + 37, 90, 5);
  ctx.fillStyle = '#5dc1b9';
  ctx.fillRect(x - 100, y + 37, 90 * (score / total), 5);
}

function drawCountdown() {
  if (mode !== 'versus' || vsCountdown <= 0) return;
  const n = Math.ceil(vsCountdown);
  const f = vsCountdown - Math.floor(vsCountdown);
  drawText(String(n), W / 2, H / 2 - 10, { size: 60 + f * 30, color: '#ff4fd8', glow: '#ff4fd8', blur: 24, alpha: 0.4 + f * 0.6 });
  if (match && match.rival) drawText('VS ' + match.rival.name.toUpperCase(), W / 2, H / 2 + 50, { size: 12, color: '#ffffff' });
}

function drawBanner() {
  if (!banner || banner.t <= 0) return;
  const a = Math.min(1, banner.t * 2);
  const blink = banner.text === 'WARNING' ? (Math.floor(time * 6) % 2 ? 1 : 0.35) : 1;
  drawText(banner.text, W / 2, H / 2 - 30, { size: 34, color: banner.color, alpha: a * blink, glow: banner.color, blur: 20 });
  if (banner.sub) drawText(banner.sub, W / 2, H / 2 + 18, { size: 12, color: '#ffffff', alpha: a });
}

function drawWorld() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  drawBackground();
  drawBunkers();
  drawAsteroids();
  drawInvaders();
  drawBoss();
  drawUfo();
  drawPowerups();
  drawRockBullets();
  drawBullets();
  drawLasers();
  drawPlayer();
  drawParticles();
  ctx.restore();
}

function drawMenu() {
  drawBackground();
  drawParticles();
  // Invasores desfilando
  if (SPR.ready) {
    for (let i = 0; i < 9; i++) {
      const x = ((time * 60 + i * 120) % (W + 120)) - 60;
      const y = 70 + Math.sin(time * 2 + i) * 10;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(SPR.inv[i % 3], x, y);
    }
    ctx.globalAlpha = 1;
  }
  const pulse = 1 + Math.sin(time * 2) * 0.03;
  ctx.save();
  ctx.translate(W / 2, 170);
  ctx.scale(pulse, pulse);
  drawText('INVADERS', 0, -10, { size: 56, color: '#5dc1b9', glow: '#5dc1b9', blur: 26 });
  drawText('SPACE', 0, 52, { size: 30, color: '#ff4fd8', glow: '#ff4fd8', blur: 20 });
  ctx.restore();

  // Tabla de puntos
  const ty = 300;
  INV_TYPES.slice(0, 3).forEach((t, i) => {
    const cx = W / 2 - 330 + i * 190;
    if (SPR.inv[i]) ctx.drawImage(SPR.inv[i], cx - 50, ty - 20);
    drawText('= ' + t.points, cx - 10, ty, { size: 11, color: t.color, align: 'left' });
  });
  drawText('UFO = ???', W / 2 + 240, ty, { size: 11, color: '#ff4fd8', align: 'left' });

  drawMenuOptions();
  drawText('HI-SCORE ' + String(best()).padStart(7, '0'), W / 2, 446, { size: 11, color: '#ff4fd8' });
  if (online.enabled) {
    const lg = league.get();
    const label = (isTouch() ? '🏆' : 'R') + ' = RANKING ONLINE' + (lg ? '  ·  LIGA ' + lg.name.toUpperCase() : '');
    drawText(label, W / 2, 470, { size: 9, color: '#ffd23f' });
  }
  drawText('MOVE < > / A D    FIRE SPACE    PAUSE P    MUTE M    OPTIONS O    ACHIEVEMENTS L', W / 2, 500, { size: 9, color: '#8a86b8' });
  drawText(`GAMEPAD SUPPORTED   ·   ACHIEVEMENTS ${achievements.count}/${achievements.total}`, W / 2, 522, { size: 8, color: '#5a5688' });
  if (iosHint) {
    drawText('IPHONE: SHARE > ADD TO HOME SCREEN TO INSTALL', W / 2, 548, { size: 7, color: '#5dc1b9' });
  }
}

function drawMenuOptions() {
  MENU_OPTS.forEach((o, i) => {
    const sel = i === menuSel;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = sel ? '#ffffff' : 'rgba(93,193,185,0.45)';
    ctx.fillStyle = sel ? 'rgba(93,193,185,0.24)' : 'rgba(5,1,15,0.55)';
    if (sel) { ctx.shadowColor = '#5dc1b9'; ctx.shadowBlur = 18; }
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(o.x - MENU_HALF, MENU_Y - 23, MENU_HALF * 2, 46, 10);
    else ctx.rect(o.x - MENU_HALF, MENU_Y - 23, MENU_HALF * 2, 46);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    drawText(o.label, o.x, MENU_Y + 1, { size: 13, color: sel ? '#ffffff' : '#8a86b8' });
  });
  let hint;
  let color = '#ffffff';
  if (menuSel === 1) {
    const rec = dailyRecord.get();
    color = '#ffd23f';
    if (!rec) hint = 'SAME WAVES FOR EVERYONE  ·  1 TRY PER DAY';
    else if (rec.status === 'done') hint = `TODAY: ${rec.score} PTS  ·  WAVE ${rec.wave}  ·  ${isTouch() ? 'TAP' : 'ENTER'} TO SHARE`;
    else hint = "TODAY'S TRY IS USED  ·  PRACTICE AVAILABLE";
  } else if (menuSel === 2) {
    color = '#ff4fd8';
    hint = online.enabled ? 'PLAY LIVE AGAINST A FRIEND  ·  SAME WAVES FOR BOTH' : 'VERSUS NEEDS THE ONLINE SERVER';
  } else {
    hint = isTouch() ? 'TAP TO START' : 'PRESS ENTER TO START  ·  < > TO CHOOSE';
  }
  if (menuSel > 0 || Math.floor(time * 2) % 2 === 0) drawText(hint, W / 2, 418, { size: 9, color });
}

function drawPause() {
  ctx.fillStyle = 'rgba(5,1,15,0.65)';
  ctx.fillRect(0, 0, W, H);
  drawText('PAUSED', W / 2, H / 2 - 20, { size: 36, color: '#5dc1b9', glow: '#5dc1b9', blur: 20 });
  drawText(isTouch() ? 'TAP TO RESUME' : 'PRESS P TO RESUME', W / 2, H / 2 + 30, { size: 12 });
}

function drawGameOver() {
  ctx.fillStyle = `rgba(5,1,15,${Math.min(0.78, stateTime)})`;
  ctx.fillRect(0, 0, W, H);
  if (stateTime < 0.3) return;
  drawText('GAME OVER', W / 2, 90, { size: 44, color: '#ff3b5c', glow: '#ff3b5c', blur: 24 });
  if (newRecord && Math.floor(time * 3) % 2 === 0) {
    drawText('NEW HIGH SCORE!', W / 2, 140, { size: 16, color: '#ffd23f', glow: '#ffd23f', blur: 14 });
  }
  const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
  const rows = [
    ['SCORE', String(score)],
    ['WAVE', String(wave)],
    ['SECTOR', String(sector + 1)],
    ['KILLS', String(stats.kills)],
    ['ACCURACY', acc + '%'],
    ['MAX COMBO', String(maxCombo)],
  ];
  rows.forEach(([k, v], i) => {
    drawText(k, W / 2 - 240, 190 + i * 26, { size: 11, color: '#8a86b8', align: 'left' });
    drawText(v, W / 2 - 40, 190 + i * 26, { size: 11, align: 'right' });
  });
  if (mode === 'daily') {
    drawText(`DAILY ${formatDay(dailyDay)}${practice ? ' · PRACTICE' : ''}`, W / 2 + 150, 190, { size: 11, color: '#ffd23f' });
    drawText(gridText(waveLog), W / 2 + 150, 230, { size: 18 });
  } else {
    drawText('TOP 5', W / 2 + 150, 190, { size: 11, color: '#ff4fd8' });
  }
  if (mode === 'classic') highscores.forEach((h, i) => {
    const mine = h.score === score && newRecord && i === 0;
    drawText(`${i + 1}. ${String(h.score).padStart(7, '0')}  W${h.wave}`, W / 2 + 150, 218 + i * 22, { size: 10, color: mine ? '#ffd23f' : '#ffffff' });
  });
  if (mode === 'versus') {
    const r = match && match.rival;
    let msg = 'MATCH OVER';
    if (match && !vsResult && r && !r.over && !r.gone) msg = `${r.name.toUpperCase()} IS STILL PLAYING: ${r.score}`;
    drawText('VERSUS', W / 2 + 150, 190, { size: 11, color: '#ff4fd8' });
    if (!ui.isOpen()) drawText(msg, W / 2, 470, { size: 12, color: '#ff4fd8' });
    return;
  }
  if (stateTime > 1 && !ui.isOpen() && Math.floor(time * 2) % 2 === 0) {
    const again = mode === 'daily' ? 'FOR MENU' : 'TO PLAY AGAIN';
    drawText((isTouch() ? 'TAP ' : 'PRESS ENTER ') + again, W / 2, 470, { size: 14, glow: '#ffffff', blur: 8 });
  }
  if (online.enabled && stateTime > 1 && !ui.isOpen()) {
    drawText(isTouch() ? '🏆 = RANKING ONLINE' : 'R = RANKING ONLINE', W / 2, 505, { size: 9, color: '#ffd23f' });
  }
}

function render() {
  if (state === 'menu') drawMenu();
  else {
    drawWorld();
    drawHUD();
    drawRivalHUD();
    drawBanner();
    drawCountdown();
    if (state === 'paused') drawPause();
    if (state === 'gameover') drawGameOver();
  }
  if (flashScreen > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashScreen})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (settings.get('crt')) ctx.drawImage(overlayCanvas, 0, 0);
}

// ------------------------------------------------------------------
// Transiciones
// ------------------------------------------------------------------
function isTouch() { return touchUI && touchUI.classList.contains('on'); }

function confirm() {
  if (state === 'menu') { Sound.select(); startFromMenu(); }
  else if (state === 'gameover' && stateTime > 1) {
    if (mode === 'versus') {
      // Si el resultado ya está, el panel maneja la revancha; si no, se espera al rival
      if (!match || match.status === 'closed' || match.status === 'error') { Sound.select(); leaveMatch(); backToMenu(2); }
      else if (vsResult && !ui.isOpen()) showVersusResult();
      return;
    }
    Sound.select();
    if (mode === 'daily') backToMenu(1);
    else newGame();
  }
  else if (state === 'paused') togglePause();
}

function startFromMenu() {
  if (menuSel === 1) openDailyPanel();
  else if (menuSel === 2) openVersusLobby();
  else newGame();
}

function backToMenu(sel = 0) {
  state = 'menu'; stateTime = 0; menuSel = sel;
  particles = []; texts = [];
}

// Opciones del menú (coordenadas del canvas lógico)
const MENU_Y = 378;
const MENU_OPTS = [
  { label: 'PLAY', x: W / 2 - 290 },
  { label: 'DAILY CHALLENGE', x: W / 2 },
  { label: 'VERSUS 1V1', x: W / 2 + 290 },
];
const MENU_HALF = 130;

function menuHit(px, py) {
  return MENU_OPTS.findIndex((o) => Math.abs(px - o.x) <= MENU_HALF && Math.abs(py - MENU_Y) <= 23);
}

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
}

function togglePause() {
  if (mode === 'versus' && state === 'playing') return;
  if (state === 'playing') { state = 'paused'; input.keys.clear(); }
  else if (state === 'paused') { state = 'playing'; }
}

// ------------------------------------------------------------------
// Loop
// ------------------------------------------------------------------
let last = performance.now();
let frameCount = 0;
function frame(now) {
  // Se agenda el próximo cuadro antes que nada: si algo falla, el juego no se congela
  requestAnimationFrame(frame);
  frameCount++;
  let dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  pollGamepad();
  if (state !== 'paused') {
    if (state === 'playing' && vsCountdown > 0) {
      // En tiempo real (no del juego): los dos arrancan al mismo instante aunque uno vaya lento
      vsCountdown = Math.max(0, (vsStartAt - now) / 1000);
      if (vsCountdown === 0) { if (match) match.began(); Sound.select(); }
    } else if (state === 'playing') {
      if (hitStop > 0) { hitStop -= dt; dt *= 0.15; }
      update(dt);
      if (mode === 'versus') versusTick();
    }
    updateAmbient(dt);
    time += dt;
    stateTime += dt;
  }
  render();
}
requestAnimationFrame(frame);

// Ganchos para tests automáticos: sólo existen con ?test=1
if (TEST_MODE) {
  window.__invaders = {
    get ready() { return SPR.ready; },
    get state() { return state; },
    get wave() { return wave; },
    get score() { return score; },
    get lives() { return lives; },
    get shots() { return stats ? stats.shots : 0; },
    get playerX() { return player ? player.x : 0; },
    get boss() { return boss ? { hp: boss.hp, maxHp: boss.maxHp } : null; },
    start: () => newGame(),
    get runId() { return runId; },
    get mode() { return mode; },
    get practice() { return practice; },
    get menuSel() { return menuSel; },
    get waveLog() { return waveLog.slice(); },
    seedSample() { return [R.fire(), R.dive(), R.ufo(), R.drop(), R.bunker()]; },
    get frameCount() { return frameCount; },
    get bunkerCells() { return bunkers.reduce((n, b) => n + b.cells.reduce((a, c) => a + c, 0), 0); },
    setPlayerX(x) { if (player) { player.x = x; player.vx = 0; } },
    get upgrades() { return { ...upgrades }; },
    get kinds() { return invaders.reduce((acc, i) => ((acc[i.kind] = (acc[i.kind] || 0) + 1), acc), {}); },
    get lasers() { return lasers.map((L) => ({ firing: L.firing, x: L.x, end: L.end })); },
    get bossInfo() { return boss ? { level: boss.level, name: boss.name } : null; },
    get sector() { return sector; },
    get bannerText() { return banner ? `${banner.text}|${banner.sub}` : ''; },
    get asteroidCount() { return asteroids.filter((a) => !a.dead).length; },
    get lavaCount() { return enemyBullets.filter((e) => e.kind === 'lava').length; },
    get bulletXs() { return bullets.map((b) => Math.round(b.x)); },
    get bossState() {
      if (!boss) return null;
      return {
        x: boss.x, hp: boss.hp, maxHp: boss.maxHp, intangible: !!boss.intangible, blink: boss.blink || 0,
        rocks: boss.rocks ? boss.rocks.length : 0, broken: boss.broken || 0,
        absorbing: boss.absorbing || 0, absorbed: boss.totalAbsorbed || 0,
        mode: boss.mode || null, reborn: !!boss.reborn, entering: boss.entering, dying: boss.dying,
      };
    },
    get bulletKinds() { return enemyBullets.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] || 0) + 1), acc), {}); },
    damageBoss(n) { cheated = true; if (boss && !boss.intangible && boss.dying <= 0) damageBoss(n); },
    spawnAsteroidAt(x, y) { cheated = true; spawnAsteroid(x, y, 0); asteroids[asteroids.length - 1].vx = 0; },
    hazardNow() { hazardTimer = 0; if (F) F.magmaTimer = 0; },
    killKind(kind) {
      cheated = true;
      const inv = invaders.find((i) => i.kind === kind && !i.dead);
      if (inv) killInvader(inv);
      return !!inv;
    },
    laserAt(x, y = 120) {
      cheated = true;
      if (player) { player.x = x; player.vx = 0; player.invuln = 0; player.shield = false; }
      startLaser({ x, y });
    },
    freeze() { cheated = true; invaders.forEach((i) => (i.dead = true)); enemyBullets.length = 0; },
    get cheated() { return cheated; },
    get vs() {
      return match ? { status: match.status, rival: match.rival, round: match.round, seed: match.seed, countdown: vsCountdown, incoming: vsIncoming, result: vsResult && vsResult.outcome } : null;
    },
    get achievements() { return achievements.list().filter((a) => a.unlocked).map((a) => a.id); },
    skipTo(n) { if (state === 'playing') { cheated = true; startWave(n); } },
    killAll() {
      cheated = true;
      if (invaders) invaders.forEach((i) => (i.dead = true));
      if (boss && boss.dying <= 0) { boss.dying = 0.2; boss.boomTimer = 0; }
    },
    addScore(n) { cheated = true; addScore(n); },
    die() { if (player && player.alive) { lives = 1; player.invuln = 0; player.shield = false; hitPlayer(); } },
  };
}
