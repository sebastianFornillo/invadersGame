import { test, expect } from './fixtures.js';
import { openGame, game, waitForState, playUntilScore, mockOnline } from './helpers.js';

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('invaders.achievements') || 'null'));

test('el primer invasor desbloquea un logro, avisa y queda guardado', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await playUntilScore(page);
  const toast = page.locator('.achtoast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('PRIMER CONTACTO');
  expect(await game(page, 'achievements')).toContain('first_blood');
  expect((await saved(page)).unlocked.first_blood).toBeTruthy();

  // L abre la pantalla de logros (y pausa)
  await page.keyboard.press('KeyL');
  const pnl = page.locator('.overlay .panel.achievements');
  await expect(pnl).toBeVisible();
  expect(await game(page, 'state')).toBe('paused');
  await expect(pnl.locator('.ach.on[data-id="first_blood"]')).toBeVisible();
  await expect(pnl.locator('.ach:not(.on)[data-id="hunter"] .bar')).toBeVisible();
  await expect(pnl.locator('.achhead')).toContainText('1 /');

  // Sigue ahí después de recargar
  await page.reload();
  await page.waitForFunction(() => window.__invaders && window.__invaders.ready);
  expect(await game(page, 'achievements')).toContain('first_blood');
});

test('derrotar al quinto jefe distinto da PANTEÓN', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('invaders.achievements', JSON.stringify({
      unlocked: {}, kills: 0, rocks: 0, bosses: ['mothership', 'titan', 'vortex', 'phoenix'],
    }));
  });
  await openGame(page);
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await game(page, 'skipTo(10)');
  await expect.poll(async () => (await game(page, 'bossState')).entering, { timeout: 8000 }).toBe(false);
  await expect.poll(async () => {
    await game(page, 'damageBoss(100000)');
    return game(page, 'achievements');
  }, { timeout: 8000 }).toContain('pantheon');
  expect(await game(page, 'achievements')).toContain('boss_magma');
});

test('desde el ranking se llega a los logros', async ({ page }) => {
  await mockOnline(page);
  await openGame(page);
  await page.keyboard.press('KeyR');
  await page.getByRole('button', { name: '🏅 LOGROS' }).click();
  await expect(page.locator('.overlay .panel.achievements')).toContainText('LOGROS');
});
