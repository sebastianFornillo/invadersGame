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
import { online, api, league } from './online.js';
import { ui } from './ui.js';

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
  { color: '#5dffa0', points: 100, hp: 1 },
  { color: '#4fd8ff', points: 200, hp: 1 },
  { color: '#ff5fd2', points: 300, hp: 2 },
];

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
  padX: 0, padFire: false, padPrev: {},
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
  if (e.code === 'Enter' || e.code === 'Space') confirm();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') { Sound.toggle(); syncMute(); }
  if (e.code === 'KeyR') openRankingFromGame();
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

const rankBtn = document.getElementById('rankBtn');
if (rankBtn) {
  rankBtn.hidden = !online.enabled;
  rankBtn.addEventListener('click', () => openRankingFromGame());
}
// Los botones del HUD no se quedan con el foco (si no, Espacio los "aprieta")
document.querySelectorAll('.hud-buttons button').forEach((b) => b.addEventListener('click', () => b.blur()));
ui.handleInvite();
canvas.addEventListener('pointerdown', () => { Sound.unlock(); if (state !== 'playing') confirm(); });

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
  const actions = !ui.isOpen();
  if (actions && (edge(0) || edge(9))) { Sound.unlock(); if (state !== 'playing') confirm(); }
  if (actions && edge(9) && state === 'playing') togglePause();
  input.padPrev = { 0: b(0), 9: b(9) };
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

function newGame() {
  score = 0; wave = 0; lives = 3; nextLife = EXTRA_LIFE_EVERY;
  combo = 0; comboTimer = 0; maxCombo = 0; newRecord = false;
  stats = { shots: 0, hits: 0, kills: 0 };
  player = {
    x: W / 2, y: PLAYER_Y, w: 90, h: 45, vx: 0, tilt: 0, cooldown: 0,
    invuln: 0, alive: true, shield: false, triple: 0, rapid: 0,
  };
  bullets = []; enemyBullets = []; invaders = []; powerups = [];
  particles = []; texts = [];
  boss = null; ufo = null; ufoTimer = rand(14, 22);
  deathTimer = 0; marchTimer = 0; marchStep = 0;
  state = 'playing'; stateTime = 0;
  if (ui.isOpen()) ui.close();
  registerRun();
  startWave(1);
}

// Avisa al servidor que empezó una partida (necesario para guardar el puntaje)
function registerRun() {
  runId = null;
  cheated = false;
  const token = ++runToken;
  if (!online.enabled) return;
  api.startRun('classic')
    .then((r) => { if (token === runToken && r) runId = r.run_id; })
    .catch(() => { /* sin ranking para esta partida */ });
}

function startWave(n) {
  wave = n;
  cfg = waveConfig(n);
  enemyBullets.length = 0;
  invaders = [];
  boss = null;
  waveHits = 0;
  clearTimer = 0;
  buildBunkers();
  if (cfg.boss) {
    createBoss();
    banner = { text: 'WARNING', sub: 'MOTHERSHIP APPROACHING', t: 2.6, color: '#ff3b5c' };
    Sound.warning();
  } else {
    createFormation();
    banner = { text: 'WAVE ' + n, sub: n === 1 ? 'DEFEND THE EARTH' : '', t: 2.2, color: '#5dc1b9' };
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
    fireTimer: 1.5, diveTimer: cfg.diveInterval,
  };
  for (let r = 0; r < rows; r++) {
    const type = r === 0 ? 2 : r < Math.ceil(rows / 2) ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      let hp = INV_TYPES[type].hp;
      if (type === 1 && cfg.armored) hp = 2;
      invaders.push({
        col: c, row: r, type, hp, x: 0, y: 0, w: INV_W, h: INV_H,
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
  const ratio = invaders.length / F.total;
  const speed = cfg.speed * (1 + (1 - ratio) * 2.6);

  if (F.entering) {
    F.y += (F.targetY - F.y) * Math.min(1, dt * 2.5);
    if (Math.abs(F.targetY - F.y) < 1) { F.y = F.targetY; F.entering = false; }
  } else {
    F.x += F.dir * speed * dt;
    let minC = Infinity, maxC = -Infinity;
    for (const inv of invaders) { if (inv.col < minC) minC = inv.col; if (inv.col > maxC) maxC = inv.col; }
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
    inv.flash = Math.max(0, inv.flash - dt);
    if (inv.state === 'formation') {
      const s = slotOf(inv);
      inv.x = s.x; inv.y = s.y;
      if (inv.y + inv.h >= PLAYER_Y - 18) { invasion(); return; }
    } else if (inv.state === 'dive') {
      inv.t += dt;
      inv.y += inv.speed * dt;
      inv.x += ((player.x - (inv.x + inv.w / 2)) * 0.9 + Math.cos(inv.t * 4) * 140 * inv.wob) * dt;
      inv.x = clamp(inv.x, 4, W - inv.w - 4);
      if (!inv.shot && inv.t > 0.45 && inv.y < PLAYER_Y - 120) {
        inv.shot = true;
        enemyShot(inv.x + inv.w / 2, inv.y + inv.h, true);
      }
      if (inv.y > H + 20) { inv.state = 'return'; inv.y = -60; }
    } else if (inv.state === 'return') {
      const s = slotOf(inv);
      const dx = s.x - inv.x, dy = s.y - inv.y;
      const dist = Math.hypot(dx, dy);
      const step = 320 * dt;
      if (dist <= step) { inv.state = 'formation'; inv.x = s.x; inv.y = s.y; }
      else { inv.x += (dx / dist) * step; inv.y += (dy / dist) * step; }
    }
    if (inv.state !== 'return') carveBunkers(inv);
  }

  if (!canAttack) return;

  // Disparo: sólo el invasor más bajo de cada columna puede disparar
  F.fireTimer -= dt;
  if (F.fireTimer <= 0) {
    F.fireTimer = cfg.fireInterval * rand(0.6, 1.4);
    const bottom = {};
    for (const inv of invaders) {
      if (inv.state !== 'formation') continue;
      if (!bottom[inv.col] || inv.row > bottom[inv.col].row) bottom[inv.col] = inv;
    }
    const shooters = Object.values(bottom);
    if (shooters.length) {
      const s = pick(shooters);
      enemyShot(s.x + s.w / 2, s.y + s.h, Math.random() < cfg.aimed);
    }
  }

  // Picados (desde la oleada 3)
  if (cfg.dive) {
    F.diveTimer -= dt;
    if (F.diveTimer <= 0) {
      F.diveTimer = cfg.diveInterval * rand(0.7, 1.3);
      const candidates = invaders.filter((i) => i.state === 'formation');
      if (candidates.length) {
        const d = pick(candidates);
        d.state = 'dive'; d.t = 0; d.shot = false;
        d.speed = Math.min(170 + wave * 9, 320);
        d.wob = Math.random() < 0.5 ? -1 : 1;
        Sound.ufo();
      }
    }
  }
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
function createBoss() {
  const hp = 70 + wave * 10;
  boss = {
    x: W / 2, y: -140, targetY: 120, w: INV_W * 3, h: INV_H * 3,
    hp, maxHp: hp, t: 0, atk: 2.4, pattern: 0, flash: 0,
    entering: true, dying: 0, burst: 0, burstTimer: 0, boomTimer: 0, dead: false,
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
      explode(b.x + rand(-b.w / 2, b.w / 2), b.y + rand(-b.h / 2, b.h / 2), pick(['#ff3b5c', '#ffd23f', '#fff']), 14, 200);
      Sound.explode();
      addShake(4);
    }
    if (b.dying <= 0) {
      explode(b.x, b.y, '#ff3b5c', 90, 480);
      explode(b.x, b.y, '#ffd23f', 50, 300);
      Sound.big(); addShake(16); flashScreen = 0.35;
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
  b.t += dt * (enraged ? 1.4 : 1);
  b.x = W / 2 + Math.sin(b.t * 0.7) * (W / 2 - 110);
  b.y = b.targetY + Math.sin(b.t * 1.3) * 18;
  if (!player.alive) return;

  if (b.burst > 0) {
    b.burstTimer -= dt;
    if (b.burstTimer <= 0) { b.burst--; b.burstTimer = 0.09; bossShot(b.x, b.y + b.h / 2, Math.atan2(player.y - b.y, player.x - b.x), 360); }
  }

  b.atk -= dt;
  if (b.atk <= 0) {
    b.atk = Math.max(0.9, 2.1 - wave * 0.04) * (enraged ? 0.7 : 1);
    const p = b.pattern++ % 3;
    if (p === 0) {
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

function bossShot(x, y, a, sp) {
  enemyBullets.push({ x: x - 5, y: y - 5, w: 10, h: 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, kind: 'orb', dead: false });
}

// ------------------------------------------------------------------
// OVNI misterioso
// ------------------------------------------------------------------
function updateUfo(dt) {
  if (!ufo) {
    if (cfg.boss || F.entering || !player.alive) return;
    ufoTimer -= dt;
    if (ufoTimer <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      ufo = { x: dir > 0 ? -70 : W + 10, y: 26, w: 60, h: 24, vx: dir * 170, beep: 0, dead: false };
      ufoTimer = rand(16, 26);
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
function hitBunkers(rect, down) {
  for (const b of bunkers) {
    if (!overlap(rect, b)) continue;
    const { c0, c1, r0, r1 } = cellRange(b, rect);
    // Recorre en la dirección de la bala para impactar la primera celda
    for (let k = 0; k <= r1 - r0; k++) {
      const r = down ? r0 + k : r1 - k;
      for (let c = c0; c <= c1; c++) {
        if (b.cells[r * BK_COLS + c]) { erode(b, c, r, 2.6); return true; }
      }
    }
  }
  return false;
}

function erode(b, cc, cr, radius) {
  const R = Math.ceil(radius);
  for (let r = cr - R; r <= cr + R; r++) {
    for (let c = cc - R; c <= cc + R; c++) {
      if (r < 0 || c < 0 || r >= BK_ROWS || c >= BK_COLS) continue;
      const d = Math.hypot(c - cc, r - cr);
      if (d <= radius && (d < 1.2 || Math.random() < 0.65)) b.cells[r * BK_COLS + c] = 0;
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

function addShake(n) { shake = Math.min(shake + n, 22); }

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
  const target = input.axis * PLAYER_SPEED;
  player.vx = lerp(player.vx, target, 1 - Math.pow(0.00002, dt));
  player.x = clamp(player.x + player.vx * dt, player.w / 2 + 6, W - player.w / 2 - 6);
  player.tilt = lerp(player.tilt, (player.vx / PLAYER_SPEED) * 0.28, Math.min(1, dt * 12));
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
  player.cooldown = player.rapid > 0 ? 0.09 : 0.24;
  const angles = player.triple > 0 ? [-0.17, 0, 0.17] : [0];
  for (const a of angles) {
    bullets.push({
      x: player.x - 2, y: player.y - player.h / 2, w: 4, h: 16,
      vx: Math.sin(a) * BULLET_SPEED, vy: -Math.cos(a) * BULLET_SPEED, dead: false,
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
  addShake(14); hitStop = 0.08; flashScreen = 0.25;
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
  const prevBest = best();
  newRecord = score > 0 && score > prevBest;
  if (score > 0) {
    highscores.push({ score, wave, date: new Date().toISOString().slice(0, 10) });
    highscores.sort((a, b) => b.score - a.score);
    highscores = highscores.slice(0, 5);
    store.set('invaders.highscores', highscores);
  }
  Sound.over();
  offerSubmit();
}

function offerSubmit() {
  if (!online.enabled || score <= 0 || cheated || !runId) return;
  const run = { run: runId, score, wave, kills: stats.kills, token: runToken };
  setTimeout(() => {
    if (state !== 'gameover' || run.token !== runToken || ui.isOpen()) return;
    input.keys.clear();
    ui.openSubmit({
      score: run.score,
      wave: run.wave,
      title: newRecord ? '¡NUEVO RÉCORD!' : 'GUARDAR PUNTAJE',
      submit: (name) => {
        const lg = league.get();
        return api.submitScore({ ...run, name, leagueCode: lg && lg.code });
      },
      onPlayAgain: () => newGame(),
    });
  }, 1100);
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
  if (combo > 0 && combo % 5 === 0 && multiplier() <= 5) {
    floatText(player.x, player.y - 50, 'COMBO x' + multiplier(), '#ffd23f', 12);
  }
}

function addScore(n) {
  score += n;
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
  if (!forced && Math.random() > 0.075) return;
  let r = Math.random(), type = 'T';
  for (const [k, v] of Object.entries(POWERS)) { if (r < v.weight) { type = k; break; } r -= v.weight; }
  if (type === 'L' && lives >= MAX_LIVES) type = 'S';
  powerups.push({ x: x - 13, y, w: 26, h: 26, vy: 110, type, t: 0, dead: false });
}

function collectPower(p) {
  const info = POWERS[p.type];
  if (p.type === 'T') player.triple = POWER_TIME;
  if (p.type === 'R') player.rapid = POWER_TIME;
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
  const cx = inv.x + inv.w / 2, cy = inv.y + inv.h / 2;
  floatText(cx, cy, (diving ? '2X ' : '') + pts, t.color, 10);
  explode(cx, cy, t.color, 26, 230);
  Sound.explode();
  addShake(2.5);
  dropPower(cx, cy);
}

// ------------------------------------------------------------------
// Colisiones
// ------------------------------------------------------------------
function collisions() {
  // Balas del jugador vs balas enemigas (se anulan)
  for (const b of bullets) {
    for (const e of enemyBullets) {
      if (!e.dead && e.kind !== 'orb' && overlap(b, e)) {
        b.dead = true; e.dead = true;
        explode(b.x, b.y, '#ffffff', 8, 120);
        break;
      }
    }
  }

  for (const b of bullets) {
    if (b.dead) continue;
    if (hitBunkers(b, false)) { b.dead = true; continue; }

    for (const inv of invaders) {
      if (inv.dead || !overlap(b, inv)) continue;
      b.dead = true; stats.hits++;
      inv.hp--;
      if (inv.hp <= 0) killInvader(inv);
      else { inv.flash = 0.08; Sound.bossHit(); spawn({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.1, size: 18, color: '#fff', type: 'flash', drag: 1 }); }
      break;
    }
    if (b.dead) continue;

    if (boss && boss.dying <= 0 && !boss.entering) {
      const bb = { x: boss.x - boss.w / 2, y: boss.y - boss.h / 2, w: boss.w, h: boss.h };
      if (overlap(b, bb)) {
        b.dead = true; stats.hits++;
        boss.hp--; boss.flash = 0.05;
        addScore(10);
        Sound.bossHit();
        for (let i = 0; i < 4; i++) spawn({ x: b.x, y: b.y, vx: rand(-160, 160), vy: rand(-60, 160), life: 0.3, size: 2, color: '#ff3b5c', type: 'spark' });
        if (boss.hp <= 0) { boss.dying = 1.5; boss.boomTimer = 0; registerKill(); enemyBullets.length = 0; }
        continue;
      }
    }

    if (ufo && overlap(b, ufo)) {
      b.dead = true; stats.hits++;
      const pts = pick([300, 500, 800, 1000, 1500]);
      addScore(pts);
      registerKill();
      floatText(ufo.x + 30, ufo.y + 12, '' + pts, '#ff4fd8', 14);
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
    if (hitBunkers(e, true)) { e.dead = true; continue; }
    if (player.alive && overlap(e, pb)) { e.dead = true; hitPlayer(); }
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

  compact(bullets); compact(enemyBullets); compact(invaders); compact(powerups);
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

  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y + b.h < 0 || b.x < -20 || b.x > W + 20) b.dead = true;
  }
  for (const e of enemyBullets) {
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.y > H + 20 || e.y < -40 || e.x < -40 || e.x > W + 40) e.dead = true;
  }
  for (const p of powerups) {
    p.t += dt; p.y += p.vy * dt;
    if (p.y > H) p.dead = true;
  }

  if (boss) updateBoss(dt);
  else updateFormation(dt);
  if (state !== 'playing') return;
  updateUfo(dt);
  collisions();

  // ¿Oleada superada?
  if (!boss && invaders.length === 0 && clearTimer <= 0 && player.alive) {
    const bonus = 250 * wave;
    const perfect = waveHits === 0 ? 1000 * wave : 0;
    addScore(bonus + perfect);
    banner = { text: 'WAVE CLEAR', sub: perfect ? 'PERFECT! +' + (bonus + perfect) : 'BONUS +' + bonus, t: 2.2, color: '#ffd23f' };
    Sound.clear();
    clearTimer = 2.4;
    enemyBullets.length = 0;
  }
  if (clearTimer > 0) {
    clearTimer -= dt;
    if (clearTimer <= 0) startWave(wave + 1);
  }
}

function updateAmbient(dt) {
  const boost = state === 'playing' && banner && banner.t > 0 && !cfg.boss ? 3 : 1;
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
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#05010f');
  g.addColorStop(0.6, '#0a0620');
  g.addColorStop(1, '#130a2e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    const a = s.l === 0 ? 0.35 + 0.35 * Math.sin(time * 2 + s.tw) : s.l === 1 ? 0.7 : 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = s.l === 2 ? '#cfe9ff' : '#ffffff';
    ctx.fillRect(s.x, s.y, s.s, s.s * (s.l === 2 ? 3 : 1));
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
    const spr = inv.flash > 0 ? SPR.invFlash : SPR.inv[inv.type];
    if (!spr) continue;
    // Pequeño "squash" alternado para simular animación de 2 frames
    const sq = 1 + (Math.floor(time * 3 + inv.col) % 2 ? 0.06 : -0.04);
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
  const spr = b.flash > 0 ? SPR.bossFlash : SPR.boss;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, b.w);
  g.addColorStop(0, 'rgba(255,59,92,0.35)');
  g.addColorStop(1, 'rgba(255,59,92,0)');
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.w, b.y - b.w, b.w * 2, b.w * 2);
  ctx.restore();
  if (spr) ctx.drawImage(spr, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);

  // Barra de vida
  const bw = 420, bx = (W - bw) / 2, by = 62;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw, 8);
  ctx.fillStyle = b.hp < b.maxHp * 0.5 ? '#ffd23f' : '#ff3b5c';
  ctx.fillRect(bx, by, (bw * Math.max(0, b.hp)) / b.maxHp, 8);
  drawText('MOTHERSHIP', W / 2, by - 10, { size: 8, color: '#ff8aa0' });
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
    if (e.kind === 'orb') {
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
  drawText('HI ' + String(Math.max(best(), score)).padStart(7, '0'), W / 2, 20, { size: 10, color: '#ff4fd8' });
  drawText('WAVE ' + wave, W / 2, 38, { size: 9, color: '#5dc1b9' });

  for (let i = 0; i < lives; i++) drawShipIcon(16 + i * 34, H - 26, 0.32);

  let px = W - 20;
  const bars = [];
  if (player.triple > 0) bars.push(['TRIPLE', player.triple / POWER_TIME, POWERS.T.color]);
  if (player.rapid > 0) bars.push(['RAPID', player.rapid / POWER_TIME, POWERS.R.color]);
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
  drawInvaders();
  drawBoss();
  drawUfo();
  drawPowerups();
  drawBullets();
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
  INV_TYPES.forEach((t, i) => {
    const cx = W / 2 - 330 + i * 190;
    if (SPR.inv[i]) ctx.drawImage(SPR.inv[i], cx - 50, ty - 20);
    drawText('= ' + t.points, cx - 10, ty, { size: 11, color: t.color, align: 'left' });
  });
  drawText('UFO = ???', W / 2 + 240, ty, { size: 11, color: '#ff4fd8', align: 'left' });

  if (Math.floor(time * 2) % 2 === 0) {
    drawText(isTouch() ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, 380, { size: 16, color: '#ffffff', glow: '#ffffff', blur: 10 });
  }
  drawText('HI-SCORE ' + String(best()).padStart(7, '0'), W / 2, 430, { size: 11, color: '#ff4fd8' });
  if (online.enabled) {
    const lg = league.get();
    const label = (isTouch() ? '🏆' : 'R') + ' = RANKING ONLINE' + (lg ? '  ·  LIGA ' + lg.name.toUpperCase() : '');
    drawText(label, W / 2, 458, { size: 9, color: '#ffd23f' });
  }
  drawText('MOVE < > / A D     FIRE SPACE     PAUSE P     MUTE M', W / 2, 500, { size: 9, color: '#8a86b8' });
  drawText('GAMEPAD SUPPORTED', W / 2, 522, { size: 8, color: '#5a5688' });
  if (iosHint) {
    drawText('IPHONE: SHARE > ADD TO HOME SCREEN TO INSTALL', W / 2, 548, { size: 7, color: '#5dc1b9' });
  }
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
    ['KILLS', String(stats.kills)],
    ['ACCURACY', acc + '%'],
    ['MAX COMBO', String(maxCombo)],
  ];
  rows.forEach(([k, v], i) => {
    drawText(k, W / 2 - 240, 190 + i * 26, { size: 11, color: '#8a86b8', align: 'left' });
    drawText(v, W / 2 - 40, 190 + i * 26, { size: 11, align: 'right' });
  });
  drawText('TOP 5', W / 2 + 150, 190, { size: 11, color: '#ff4fd8' });
  highscores.forEach((h, i) => {
    const mine = h.score === score && newRecord && i === 0;
    drawText(`${i + 1}. ${String(h.score).padStart(7, '0')}  W${h.wave}`, W / 2 + 150, 218 + i * 22, { size: 10, color: mine ? '#ffd23f' : '#ffffff' });
  });
  if (stateTime > 1 && !ui.isOpen() && Math.floor(time * 2) % 2 === 0) {
    drawText(isTouch() ? 'TAP TO PLAY AGAIN' : 'PRESS ENTER TO PLAY AGAIN', W / 2, 470, { size: 14, glow: '#ffffff', blur: 8 });
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
    drawBanner();
    if (state === 'paused') drawPause();
    if (state === 'gameover') drawGameOver();
  }
  if (flashScreen > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashScreen})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.drawImage(overlayCanvas, 0, 0);
}

// ------------------------------------------------------------------
// Transiciones
// ------------------------------------------------------------------
function isTouch() { return touchUI && touchUI.classList.contains('on'); }

function confirm() {
  if (state === 'menu') { Sound.select(); newGame(); }
  else if (state === 'gameover' && stateTime > 1) { Sound.select(); newGame(); }
  else if (state === 'paused') togglePause();
}

function togglePause() {
  if (state === 'playing') { state = 'paused'; input.keys.clear(); }
  else if (state === 'paused') { state = 'playing'; }
}

// ------------------------------------------------------------------
// Loop
// ------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  pollGamepad();
  if (state !== 'paused') {
    if (state === 'playing') {
      if (hitStop > 0) { hitStop -= dt; dt *= 0.15; }
      update(dt);
    }
    updateAmbient(dt);
    time += dt;
    stateTime += dt;
  }
  render();
  requestAnimationFrame(frame);
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
    get cheated() { return cheated; },
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
