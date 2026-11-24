import { test, expect } from './fixtures.js';
import { openGame, game, waitForState } from './helpers.js';

test('celular: se ven los controles táctiles y FIRE inicia la partida', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.locator('#touch')).toHaveClass(/on/);
  await page.locator('.tfire').tap();
  await waitForState(page, 'playing');
  expect(errors).toEqual([]);
});

test('celular: mantener ◀ mueve la nave a la izquierda', async ({ page }) => {
  await openGame(page);
  await page.locator('.tfire').tap();
  await waitForState(page, 'playing');
  const x0 = await game(page, 'playerX');
  const left = page.locator('[data-k="left"]');
  await left.dispatchEvent('pointerdown');
  await page.waitForTimeout(400);
  await left.dispatchEvent('pointerup');
  expect(await game(page, 'playerX')).toBeLessThan(x0 - 50);
});

test('celular: el canvas entra completo en la pantalla', async ({ page }) => {
  await openGame(page);
  const box = await page.locator('#game').boundingBox();
  const vp = page.viewportSize();
  expect(box.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box.height).toBeLessThanOrEqual(vp.height + 1);
});
