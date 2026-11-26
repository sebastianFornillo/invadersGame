import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAchievements, ACHIEVEMENTS, BOSS_KINDS } from '../../src/achievements.js';

function setup(initial = null) {
  let saved = initial;
  let saves = 0;
  const unlocked = [];
  const ach = createAchievements({
    load: () => saved,
    save: (d) => { saved = JSON.parse(JSON.stringify(d)); saves++; },
    onUnlock: (a) => unlocked.push(a.id),
    now: () => '2026-11-25T00:00:00.000Z',
  });
  return { ach, unlocked, get saved() { return saved; }, get saves() { return saves; } };
}

test('los ids son únicos', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('el primer invasor desbloquea PRIMER CONTACTO una sola vez', () => {
  const t = setup();
  t.ach.event('kill');
  t.ach.event('kill');
  assert.deepEqual(t.unlocked, ['first_blood']);
  assert.equal(t.saved.unlocked.first_blood, '2026-11-25T00:00:00.000Z');
});

test('los contadores se acumulan entre partidas y se guardan en tandas', () => {
  const t = setup({ unlocked: { first_blood: 'x' }, kills: 990, rocks: 0, bosses: [] });
  const before = t.saves;
  for (let i = 0; i < 5; i++) t.ach.event('kill');
  assert.equal(t.saves, before, 'no guarda en cada invasor');
  for (let i = 0; i < 5; i++) t.ach.event('kill');
  assert.ok(t.unlocked.includes('hunter'));
  assert.equal(t.saved.kills, 1000);
  assert.equal(t.ach.list().find((a) => a.id === 'hunter').progress, 1000);
});

test('combos, oleadas y puntajes', () => {
  const t = setup();
  t.ach.event('combo', { combo: 12 });
  t.ach.event('wave', { wave: 20 });
  t.ach.event('score', { score: 600000 });
  for (const id of ['combo10', 'wave10', 'wave20', 'score100k', 'score500k']) assert.ok(t.ach.isUnlocked(id), id);
  for (const id of ['combo25', 'wave30', 'score1m']) assert.ok(!t.ach.isUnlocked(id), id);
});

test('PANTEÓN pide los 5 jefes, aunque sean de partidas distintas', () => {
  const t = setup();
  for (const k of BOSS_KINDS.slice(0, 4)) t.ach.event('boss', { kind: k });
  t.ach.event('boss', { kind: 'titan' });
  assert.ok(!t.ach.isUnlocked('pantheon'));
  const again = setup(t.saved);
  again.ach.event('boss', { kind: 'phoenix' });
  assert.ok(again.ach.isUnlocked('pantheon'));
  assert.equal(again.ach.count, 6);
});

test('francotirador pide 100 disparos y 80% de precisión', () => {
  const t = setup();
  t.ach.event('gameOver', { shots: 50, hits: 50 });
  assert.ok(!t.ach.isUnlocked('sniper'));
  t.ach.event('gameOver', { shots: 120, hits: 96, daily: true });
  assert.ok(t.ach.isUnlocked('sniper'));
  assert.ok(t.ach.isUnlocked('daily'));
});

test('datos guardados rotos no rompen nada', () => {
  const t = setup('basura');
  t.ach.event('ufo');
  assert.ok(t.ach.isUnlocked('ufo'));
  const u = setup({ unlocked: null, bosses: 'x' });
  u.ach.event('boss', { kind: 'magma' });
  assert.ok(u.ach.isUnlocked('boss_magma'));
});
