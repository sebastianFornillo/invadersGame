import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, newRoomCode, VS_CODE_RE } from '../../src/versus.js';

// Red falsa: entrega cada mensaje a los demás conectados a la sala
function makeRoom() {
  const peers = [];
  let clock = 0;
  const timers = [];
  return {
    now: () => clock,
    every: (fn, ms) => { const t = { fn, ms, next: clock + ms }; timers.push(t); return t; },
    stopEvery: (t) => { t.dead = true; },
    advance(ms) {
      const end = clock + ms;
      for (;;) {
        const due = timers.filter((t) => !t.dead && t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        clock = due.next;
        due.next += due.ms;
        due.fn();
      }
      clock = end;
    },
    cut(i) { peers[i].open = false; },
    connect(onMessage, onStatus) {
      const peer = { onMessage, open: true };
      peers.push(peer);
      queueMicrotask(() => onStatus('joined'));
      return {
        send: (event, payload) => {
          if (!peer.open) return false;
          for (const p of peers) if (p !== peer && p.open) p.onMessage(event, JSON.parse(JSON.stringify(payload)));
          return true;
        },
        close: () => { peer.open = false; },
      };
    },
  };
}

function player(room, id, name, seeds = [111, 222, 333]) {
  const events = [];
  const m = createMatch({
    code: 'ABCDE', id, name, connect: room.connect, now: room.now, every: room.every, stopEvery: room.stopEvery,
    randomSeed: () => seeds.shift(), onEvent: (type, data) => events.push({ type, ...data }),
  });
  return { m, events, last: (type) => events.filter((e) => e.type === type).pop() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('código de sala válido', () => {
  for (let i = 0; i < 50; i++) assert.match(newRoomCode(), VS_CODE_RE);
});

test('dos jugadores se encuentran y arrancan con la misma semilla', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  await tick();
  assert.equal(a.m.status, 'waiting');
  const b = player(room, 'b', 'Lea');
  await tick();
  assert.equal(a.m.rival.name, 'Lea');
  assert.equal(b.m.rival.name, 'Seba');
  assert.equal(a.m.status, 'countdown');
  assert.equal(b.m.status, 'countdown');
  assert.equal(a.last('start').seed, 111);
  assert.equal(b.last('start').seed, 111);
});

test('puntaje en vivo, ataques y resultado', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  const b = player(room, 'b', 'Lea');
  await tick();
  a.m.began(); b.m.began();
  a.m.report({ score: 1200, wave: 2, lives: 3, alive: true });
  assert.equal(b.m.rival.score, 1200);
  a.m.attack(3);
  assert.equal(b.last('attack').n, 3);
  a.m.attack(99);
  assert.equal(b.last('attack').n, 6, 'los ataques tienen tope');
  b.m.gameOver({ score: 900, wave: 2 });
  assert.equal(a.m.rival.over, true);
  assert.equal(a.last('result'), undefined, 'el que sigue vivo sigue jugando');
  a.m.gameOver({ score: 1500, wave: 3 });
  assert.equal(a.last('result').outcome, 'win');
  assert.equal(b.last('result').outcome, 'lose');
});

test('revancha: los dos la piden y arranca otra ronda con otra semilla', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  const b = player(room, 'b', 'Lea');
  await tick();
  a.m.began(); b.m.began();
  a.m.gameOver({ score: 10, wave: 1 });
  b.m.gameOver({ score: 10, wave: 1 });
  assert.equal(a.last('result').outcome, 'draw');
  a.m.rematch();
  assert.equal(a.m.status, 'finished');
  b.m.rematch();
  assert.equal(a.m.round, 2);
  assert.equal(b.m.round, 2);
  assert.equal(b.last('start').seed, 222);
});

test('si el rival se va en plena partida, ganás', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  const b = player(room, 'b', 'Lea');
  await tick();
  a.m.began(); b.m.began();
  b.m.leave();
  assert.equal(a.last('result').outcome, 'win');
  assert.equal(a.last('result').reason, 'disconnect');
});

test('si el rival deja de mandar señales, a los 10 s cuenta como que se fue', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  const b = player(room, 'b', 'Lea');
  await tick();
  a.m.began(); b.m.began();
  room.cut(1); // a b se le cortó internet: no manda ni "bye"
  room.advance(6000);
  assert.equal(a.last('result'), undefined);
  room.advance(6000);
  assert.equal(a.last('result').reason, 'disconnect');
  assert.equal(a.last('result').outcome, 'win');
});

test('un tercero no puede entrar a una sala llena', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  const b = player(room, 'b', 'Lea');
  await tick();
  const c = player(room, 'c', 'Colado');
  await tick();
  assert.equal(c.m.status, 'full');
  assert.equal(a.m.rival.id, 'b');
  assert.equal(b.m.rival.id, 'a');
});

test('nombres raros del rival se limpian', async () => {
  const room = makeRoom();
  const a = player(room, 'a', 'Seba');
  player(room, 'b', '<img src=x onerror=alert(1)>');
  await tick();
  assert.doesNotMatch(a.m.rival.name, /[<>=()]/);
});
