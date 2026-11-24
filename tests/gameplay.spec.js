import { test, expect } from './fixtures.js';
import { openGame, game, waitForState, waitForWave } from './helpers.js';

const panel = (page) => page.locator('.overlay .panel');

async function start(page) {
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
}

// Limpia la oleada actual (con trucos de test) y espera la elección de mejora
async function clearToUpgrade(page, waveN) {
  await game(page, `skipTo(${waveN})`);
  await page.waitForTimeout(300);
  await game(page, 'killAll()');
  await waitForState(page, 'upgrade', 10_000);
}

test.describe('mejoras entre oleadas', () => {
  test('después de la oleada 2 se elige 1 de 3 mejoras y se aplica', async ({ page }) => {
    const errors = await openGame(page);
    await start(page);
    await clearToUpgrade(page, 2);
    await expect(panel(page)).toContainText('OLEADA 2 SUPERADA');
    const cards = page.locator('.card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toBeEnabled({ timeout: 2000 });
    const name = (await cards.nth(1).locator('b').textContent()).trim();
    await page.keyboard.press('Digit2');
    await waitForWave(page, 3);
    const levels = await game(page, 'upgrades');
    const total = Object.values(levels).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
    expect(errors).toEqual([]);
    expect(name.length).toBeGreaterThan(2);
  });

  test('si venías apretando Espacio no se elige sola', async ({ page }) => {
    await openGame(page);
    await start(page);
    await page.keyboard.down('Space');
    await clearToUpgrade(page, 2);
    await page.waitForTimeout(1200); // repetición automática de la tecla
    await page.keyboard.up('Space');
    await page.waitForTimeout(200);
    expect(await game(page, 'state')).toBe('upgrade');
    await expect(page.locator('.card')).toHaveCount(3);
  });

  test('no se puede cerrar sin elegir (Escape no la saltea)', async ({ page }) => {
    await openGame(page);
    await start(page);
    await clearToUpgrade(page, 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.card')).toHaveCount(3);
    expect(await game(page, 'state')).toBe('upgrade');
  });

  test('en el desafío diario las ofertas son iguales para todos', async ({ browser }) => {
    const offers = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openGame(page);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'JUGAR', exact: true }).click();
      await waitForState(page, 'playing');
      await clearToUpgrade(page, 2);
      offers.push(await page.locator('.card b').allTextContents());
      await ctx.close();
    }
    expect(offers[0]).toEqual(offers[1]);
  });
});

test.describe('enemigos nuevos', () => {
  test('desde la oleada 6 hay divisores que se parten en dos al morir', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(6)');
    await page.waitForTimeout(200);
    const before = await game(page, 'kinds');
    expect(before.splitter).toBeGreaterThan(0);
    expect(await game(page, "killKind('splitter')")).toBe(true);
    const after = await game(page, 'kinds');
    expect(after.mini).toBe(2);
  });

  test('desde la oleada 8 hay invasores láser', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(8)');
    await page.waitForTimeout(200);
    expect((await game(page, 'kinds')).laser).toBeGreaterThan(0);
  });

  test('el rayo avisa antes de disparar y si te agarra perdés una vida', async ({ page }) => {
    await openGame(page);
    await start(page);
    await page.waitForTimeout(2300);
    await game(page, 'freeze()');
    const lives = await game(page, 'lives');
    await game(page, 'laserAt(150)'); // x = 150: entre búnkers, sin protección
    const lasers = await game(page, 'lasers');
    expect(lasers[0].firing).toBe(false); // primero el aviso
    await expect.poll(() => game(page, 'lives'), { timeout: 3000 }).toBe(lives - 1);
  });

  test('los búnkers frenan el rayo y se van gastando', async ({ page }) => {
    await openGame(page);
    await start(page);
    await page.waitForTimeout(2300);
    await game(page, 'freeze()');
    const lives = await game(page, 'lives');
    const cells = await game(page, 'bunkerCells');
    // Primer búnker: centro en x = 1024 / 5 = 204.8
    await game(page, 'laserAt(205)');
    await page.waitForTimeout(1600);
    expect(await game(page, 'lives')).toBe(lives);
    expect(await game(page, 'bunkerCells')).toBeLessThan(cells);
  });

  test('el jefe de la oleada 10 es nivel 2 y suelta escoltas', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(10)');
    expect(await game(page, 'bossInfo')).toEqual({ level: 2, name: 'MOTHERSHIP MK II' });
    await expect.poll(async () => (await game(page, 'kinds')).mini || 0, { timeout: 12_000 }).toBeGreaterThan(0);
  });
});

test.describe('opciones', () => {
  test('O abre las opciones y los cambios se guardan', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('KeyO');
    await expect(panel(page)).toContainText('OPCIONES');
    await page.getByText('TEMBLOR DE PANTALLA').click();
    await page.getByText('MODO ZURDO').click();
    await page.locator('#optVolume').fill('30');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('invaders.settings')));
    expect(saved).toMatchObject({ leftHanded: true, volume: 30 });
    expect(saved.shake).toBe(false);
    await expect(page.locator('#touch')).toHaveClass(/left/);
    await page.getByRole('button', { name: 'RESTABLECER' }).click();
    await expect(page.locator('#touch')).not.toHaveClass(/left/);
    await page.getByRole('button', { name: 'LISTO' }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('abrir opciones en plena partida la pausa', async ({ page }) => {
    await openGame(page);
    await start(page);
    await page.locator('#optBtn').click();
    expect(await game(page, 'state')).toBe('paused');
    await expect(panel(page)).toContainText('OPCIONES');
  });
});
