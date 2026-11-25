// Prueba de punta a punta contra Postgres real (con supabase/schema.sql cargado).
// Se ejecuta sólo si existe DATABASE_URL (en CI siempre).
import { test, expect } from './fixtures.js';
import { openGame, game, waitForState, useConfig, playUntilScore } from './helpers.js';
import { startRestServer, TEST_KEY } from './support/rest-server.js';

test.skip(!process.env.DATABASE_URL, 'Necesita DATABASE_URL con el esquema de supabase/schema.sql');
test.describe.configure({ mode: 'serial' });

let api;
test.beforeAll(async () => {
  api = await startRestServer(process.env.DATABASE_URL);
});
test.afterAll(async () => {
  await api?.close();
});

async function loseWithScore(page) {
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await expect.poll(() => game(page, 'runId')).not.toBeNull();
  await playUntilScore(page);
  await game(page, 'die()');
  await waitForState(page, 'gameover');
}

test('partida real: se guarda en la base y aparece en el ranking', async ({ page }) => {
  await useConfig(page, api.url, TEST_KEY);
  const errors = await openGame(page);
  await loseWithScore(page);
  const score = await game(page, 'score');
  const name = `Int${Date.now().toString(36).slice(-6)}`; // único: el test se puede repetir
  await page.locator('#playerName').fill(name);
  await page.getByRole('button', { name: 'GUARDAR' }).click();
  await expect(page.locator('.overlay .panel')).toContainText('PUNTAJE GUARDADO');

  const { rows } = await api.query('select player, score, wave, mode from public.scores where player = $1', [name]);
  expect(rows).toEqual([{ player: name, score, wave: 1, mode: 'classic' }]);

  await page.getByRole('button', { name: 'VER RANKING' }).click();
  await expect(page.locator('.rankbody .me')).toContainText(name);
  expect(errors).toEqual([]);
});

test('liga real: uno la crea, otro entra por el link y comparten ranking', async ({ browser }) => {
  // Jugador 1 crea la liga
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await useConfig(a, api.url, TEST_KEY);
  await openGame(a);
  await a.keyboard.press('KeyR');
  await a.getByRole('button', { name: 'LIGAS PRIVADAS' }).click();
  await a.getByLabel('Nombre de la liga nueva').fill('Integración');
  await a.getByRole('button', { name: 'CREAR' }).click();
  const code = (await a.locator('.panel .code').textContent()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await a.keyboard.press('Escape');
  await loseWithScore(a);
  await a.locator('#playerName').fill('Creador');
  await a.getByRole('button', { name: 'GUARDAR' }).click();
  await expect(a.locator('.overlay .panel')).toContainText(`en la liga Integración`);

  // Jugador 2 entra con el link de invitación (otro dispositivo)
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await useConfig(b, api.url, TEST_KEY);
  await openGame(b, `&liga=${code}`);
  await expect(b.locator('.toast')).toContainText('Integración');
  await loseWithScore(b);
  await b.locator('#playerName').fill('Invitado');
  await b.getByRole('button', { name: 'GUARDAR' }).click();
  await expect(b.locator('.overlay .panel')).toContainText('en la liga Integración');
  await b.getByRole('button', { name: 'VER RANKING' }).click();
  await b.getByRole('tab', { name: 'INTEGRACIÓN' }).click();
  await expect(b.locator('.rankbody [data-pos]')).toHaveCount(2);
  await expect(b.locator('.rankbody')).toContainText('Creador');
  await expect(b.locator('.rankbody .me')).toContainText('Invitado');

  await ctxA.close();
  await ctxB.close();
});
