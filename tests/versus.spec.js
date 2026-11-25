import { test, expect } from './fixtures.js';
import { openGame, game, waitForState, useConfig } from './helpers.js';
import { createRelay } from './support/realtime-relay.js';

const URL = 'https://api.invaders.test';
const KEY = 'sb_publishable_test';

async function player(browser, relay, query = '') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await useConfig(page, URL, KEY);
  await relay.attach(page);
  await openGame(page, query);
  return page;
}

const vs = (page) => game(page, 'vs');

async function createRoom(page, name) {
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await game(page, 'menuSel')).toBe(2);
  await page.keyboard.press('Enter');
  await page.locator('#vsName').fill(name);
  await page.getByRole('button', { name: 'CREAR SALA' }).click();
  const code = await page.locator('[data-code]').getAttribute('data-code');
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  return code;
}

async function joinByLink(browser, relay, code, name) {
  const page = await player(browser, relay, `&vs=${code}`);
  await expect(page.locator('#vsCode')).toHaveValue(code);
  await page.locator('#vsName').fill(name);
  await page.getByRole('button', { name: 'ENTRAR' }).click();
  return page;
}

test('dos jugadores se enfrentan en vivo: misma semilla, ataques, resultado y revancha', async ({ browser }) => {
  test.setTimeout(90_000);
  const relay = createRelay();
  const a = await player(browser, relay);
  const code = await createRoom(a, 'Seba');
  await expect(a.locator('.vsstatus')).toHaveText('Esperando rival…');
  const b = await joinByLink(browser, relay, code, 'Lea');

  // Cuenta regresiva y arranque a la vez, con las mismas oleadas
  for (const p of [a, b]) await expect.poll(async () => (await vs(p)).status, { timeout: 8000 }).toBe('playing');
  expect((await vs(a)).seed).toBe((await vs(b)).seed);
  expect((await vs(a)).rival.name).toBe('Lea');
  expect((await vs(b)).rival.name).toBe('Seba');
  // Conectó con la clave pública al endpoint de Realtime
  expect(relay.log[0].url).toContain('/realtime/v1/websocket?apikey=sb_publishable_test&vsn=1.0.0');

  // Seba limpia la oleada: le manda invasores a Lea
  await game(a, 'killAll()');
  await expect.poll(async () => (await vs(b)).incoming, { timeout: 8000 }).toBeGreaterThan(0);
  expect(await game(b, 'bannerText')).toContain('INCOMING');

  // El puntaje de cada uno se ve en vivo del otro lado
  const scoreA = await game(a, 'score');
  await expect.poll(async () => (await vs(b)).rival.score, { timeout: 5000 }).toBe(scoreA);

  // Lea pierde primero: Seba sigue jugando y ve que su rival cayó
  await game(b, 'die()');
  await waitForState(b, 'gameover');
  await expect.poll(async () => (await vs(a)).rival.over, { timeout: 5000 }).toBe(true);
  expect(await game(a, 'state')).toBe('playing');

  // Seba pierde después con más puntos: gana el duelo
  await game(a, 'die()');
  await waitForState(a, 'gameover');
  await expect(a.locator('.vsresult')).toHaveText('¡GANASTE!', { timeout: 8000 });
  await expect(b.locator('.vsresult')).toHaveText('PERDISTE', { timeout: 8000 });
  expect(await game(a, 'achievements')).toContain('duelist');

  // Revancha: los dos la piden y arranca otra ronda con otra semilla
  const seed1 = (await vs(a)).seed;
  await a.getByRole('button', { name: 'REVANCHA' }).click();
  await expect(b.locator('.panel.versus')).toContainText('Seba quiere la revancha');
  await b.getByRole('button', { name: 'REVANCHA' }).click();
  for (const p of [a, b]) await expect.poll(async () => (await vs(p)).status, { timeout: 8000 }).toBe('playing');
  expect((await vs(a)).round).toBe(2);
  expect((await vs(a)).seed).toBe((await vs(b)).seed);
  expect((await vs(a)).seed).not.toBe(seed1);
});

test('si el rival cierra el juego, ganás por abandono', async ({ browser }) => {
  const relay = createRelay();
  const a = await player(browser, relay);
  const code = await createRoom(a, 'Seba');
  const b = await joinByLink(browser, relay, code, 'Lea');
  for (const p of [a, b]) await expect.poll(async () => (await vs(p)).status, { timeout: 8000 }).toBe('playing');
  await b.context().close();
  await expect(a.locator('.vsresult')).toHaveText('¡GANASTE!', { timeout: 8000 });
  await expect(a.locator('.panel.versus')).toContainText('se desconectó');
  await expect(a.getByRole('button', { name: 'REVANCHA' })).toBeDisabled();
});

test('un tercero no puede entrar a una sala llena', async ({ browser }) => {
  const relay = createRelay();
  const a = await player(browser, relay);
  const code = await createRoom(a, 'Seba');
  const b = await joinByLink(browser, relay, code, 'Lea');
  for (const p of [a, b]) await expect.poll(async () => (await vs(p)).status, { timeout: 8000 }).toBe('playing');
  const c = await joinByLink(browser, relay, code, 'Colado');
  await expect(c.locator('.vsstatus')).toHaveText('Esa sala ya tiene dos jugadores.', { timeout: 8000 });
  expect((await vs(a)).rival.name).toBe('Lea');
});

test('en versus no hay pausa (el rival sigue jugando)', async ({ browser }) => {
  const relay = createRelay();
  const a = await player(browser, relay);
  const code = await createRoom(a, 'Seba');
  const b = await joinByLink(browser, relay, code, 'Lea');
  for (const p of [a, b]) await expect.poll(async () => (await vs(p)).status, { timeout: 8000 }).toBe('playing');
  await a.keyboard.press('KeyP');
  expect(await game(a, 'state')).toBe('playing');
});

test('sin servidor online el versus avisa y no abre nada', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toContainText('servidor online');
  await expect(page.locator('.overlay .panel')).toHaveCount(0);
});

test('nombre y código inválidos se avisan antes de conectar', async ({ browser }) => {
  const relay = createRelay();
  const a = await player(browser, relay);
  await a.keyboard.press('ArrowRight');
  await a.keyboard.press('ArrowRight');
  await a.keyboard.press('Enter');
  await a.locator('#vsName').fill('x');
  await a.getByRole('button', { name: 'CREAR SALA' }).click();
  await expect(a.locator('.panel .error')).toContainText('de 2 a 12');
  await a.locator('#vsName').fill('Seba');
  await a.locator('#vsCode').fill('AB');
  await a.getByRole('button', { name: 'ENTRAR' }).click();
  await expect(a.locator('.panel .error')).toContainText('5 letras');
  expect(relay.log).toHaveLength(0);
});
