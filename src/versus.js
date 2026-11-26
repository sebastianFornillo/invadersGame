// Versus 1 contra 1: los dos juegan las mismas oleadas (misma semilla) al mismo
// tiempo, ven el puntaje del otro en vivo y se mandan "ataques".
// Este módulo maneja la sala y los mensajes; no toca el canvas ni el DOM.

export const VS_CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const START_DELAY_MS = 3000;
const HELLO_EVERY_MS = 1500;
const STATE_EVERY_MS = 250;
const GONE_AFTER_MS = 10_000;
const MAX_ATTACK = 6;

export function newRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

export const channelName = (code) => `invaders-vs-${code}`;

const num = (v, max = 1e9) => (Number.isFinite(v) ? Math.max(0, Math.min(Math.floor(v), max)) : 0);
const cleanStr = (v, n = 12) => String(v == null ? '' : v).replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, n) || 'RIVAL';

/**
 * connect(onMessage, onStatus) → { send(event, payload), close() }
 * onEvent(type, data):
 *   'status'  { status }          connecting | waiting | ready | countdown | playing | finished | full | error | closed
 *   'rival'   { rival }           cambió algo del rival (nombre, puntaje, vidas…)
 *   'start'   { seed, round, delay }
 *   'attack'  { n }
 *   'result'  { outcome, me, rival, reason }   outcome: win | lose | draw
 */
export function createMatch({
  code, name, id, connect, onEvent = () => {},
  now = () => Date.now(), every = (fn, ms) => setInterval(fn, ms), stopEvery = (t) => clearInterval(t),
  randomSeed = () => (Math.random() * 2 ** 32) >>> 0,
}) {
  const me = { id, name: cleanStr(name), score: 0, wave: 0, lives: 3, alive: true, over: false, again: false };
  let rival = null;
  let status = 'connecting';
  let round = 0;
  let seed = 0;
  let lastState = -Infinity;
  let finished = false;
  let channel = null;

  const emit = (type, data = {}) => onEvent(type, data);
  const setStatus = (s) => { if (status !== s) { status = s; emit('status', { status }); } };
  const send = (t, data = {}) => channel && channel.send('vs', { t, from: me.id, ...data });
  const isHost = () => rival && me.id < rival.id;

  function hello() {
    send('hello', { name: me.name, peer: rival ? rival.id : null, round });
  }

  function startRound(s, r) {
    if (r <= round && status !== 'ready') return;
    seed = s >>> 0;
    round = r;
    finished = false;
    Object.assign(me, { score: 0, wave: 0, lives: 3, alive: true, over: false, again: false });
    if (rival) Object.assign(rival, { score: 0, wave: 0, lives: 3, alive: true, over: false, again: false });
    setStatus('countdown');
    emit('start', { seed, round, delay: START_DELAY_MS });
  }

  function hostStartsIfReady() {
    if (!isHost()) return;
    const fresh = status === 'ready';
    const rematch = status === 'finished' && me.again && rival.again;
    if (!fresh && !rematch) return;
    const s = randomSeed();
    send('start', { seed: s, round: round + 1 });
    startRound(s, round + 1);
  }

  function finish(reason) {
    if (finished) return;
    finished = true;
    let outcome = 'draw';
    if (reason === 'disconnect') outcome = 'win';
    else if (me.score > rival.score) outcome = 'win';
    else if (me.score < rival.score) outcome = 'lose';
    setStatus('finished');
    emit('result', { outcome, reason, me: { ...me }, rival: { ...rival } });
  }

  function onMessage(event, p) {
    if (event !== 'vs' || !p || typeof p.from !== 'string' || p.from === me.id) return;
    // Sala de dos: un tercero que llega se ignora (y se entera de que está llena)
    if (rival && p.from !== rival.id) {
      if (p.t === 'hello' && !p.peer) send('full', { to: p.from });
      return;
    }
    if (p.t === 'full') {
      if (p.to === me.id && !rival) { setStatus('full'); leave(); }
      return;
    }
    if (p.t === 'hello' && p.peer && p.peer !== me.id) {
      // Ese jugador ya está emparejado con otro
      if (!rival) { setStatus('full'); leave(); }
      return;
    }
    if (!rival) {
      rival = { id: p.from, name: 'RIVAL', score: 0, wave: 0, lives: 3, alive: true, over: false, again: false, seen: now() };
      if (status === 'waiting') setStatus('ready');
      hello();
    }
    rival.seen = now();
    switch (p.t) {
      case 'hello':
        rival.name = cleanStr(p.name);
        emit('rival', { rival: { ...rival } });
        hostStartsIfReady();
        break;
      case 'start':
        if (!isHost()) startRound(num(p.seed, 2 ** 32), num(p.round, 1e6));
        break;
      case 'st':
        Object.assign(rival, { score: num(p.s), wave: num(p.w, 999), lives: num(p.l, 9), alive: Boolean(p.a) });
        emit('rival', { rival: { ...rival } });
        break;
      case 'atk':
        if (status === 'playing' && me.alive) emit('attack', { n: Math.max(1, num(p.n, MAX_ATTACK)) });
        break;
      case 'over':
        Object.assign(rival, { score: num(p.s), wave: num(p.w, 999), alive: false, over: true });
        emit('rival', { rival: { ...rival } });
        if (me.over) finish('score');
        break;
      case 'again':
        rival.again = true;
        emit('rival', { rival: { ...rival } });
        hostStartsIfReady();
        break;
      case 'bye':
        rival.gone = true;
        emit('rival', { rival: { ...rival } });
        if (status === 'playing' || status === 'countdown') {
          if (me.over) finish('score');
          else finish('disconnect');
        } else if (status !== 'finished') {
          rival = null;
          setStatus('waiting');
        }
        break;
      default:
    }
  }

  const timer = every(() => {
    if (status === 'waiting' || status === 'ready' || status === 'finished') hello();
    if (rival && !rival.gone && now() - rival.seen > GONE_AFTER_MS) onMessage('vs', { t: 'bye', from: rival.id });
  }, HELLO_EVERY_MS);

  channel = connect(onMessage, (s, detail) => {
    if (s === 'joined') {
      if (status === 'connecting') setStatus(rival ? 'ready' : 'waiting');
      hello();
      hostStartsIfReady();
    }
    else if (s === 'error') { emit('error', { reason: detail }); setStatus('error'); stopEvery(timer); }
    else if (s === 'closed' && status !== 'error' && status !== 'full') { setStatus('closed'); stopEvery(timer); }
  });

  function leave() {
    send('bye');
    stopEvery(timer);
    if (channel) channel.close();
  }

  return {
    code,
    get status() { return status; },
    get rival() { return rival ? { ...rival } : null; },
    get me() { return { ...me }; },
    get seed() { return seed; },
    get round() { return round; },
    // La cuenta regresiva terminó: arranca la partida
    began() { if (status === 'countdown') setStatus('playing'); },
    report({ score, wave, lives, alive }) {
      Object.assign(me, { score, wave, lives, alive });
      const t = now();
      if (status === 'playing' && t - lastState >= STATE_EVERY_MS) {
        lastState = t;
        send('st', { s: score, w: wave, l: lives, a: alive });
      }
    },
    attack(n) { if (status === 'playing') send('atk', { n: Math.min(n, MAX_ATTACK) }); },
    gameOver({ score, wave }) {
      Object.assign(me, { score, wave, alive: false, over: true });
      send('over', { s: score, w: wave });
      if (rival && (rival.over || rival.gone)) finish(rival.gone ? 'disconnect' : 'score');
    },
    rematch() {
      if (status !== 'finished' || !rival || rival.gone) return false;
      me.again = true;
      send('again');
      hostStartsIfReady();
      return true;
    },
    leave,
  };
}
