import { test, expect } from './fixtures.js';
import { openGame, game, waitForState } from './helpers.js';

async function start(page) {
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
}

test.describe('sectores espaciales', () => {
  test('cada 5 oleadas cambia el sector y aparece su cartel', async ({ page }) => {
    await openGame(page);
    await start(page);
    expect(await game(page, 'sector')).toBe(0);
    expect(await game(page, 'bannerText')).toContain('SECTOR 1|EARTH ORBIT');
    const cases = [[6, 1, 'NEBULA'], [11, 2, 'ASTEROID BELT'], [16, 3, 'BLACK HOLE'], [21, 4, 'SOLAR CORONA'], [27, 4, 'WAVE 27']];
    for (const [wave, sector, text] of cases) {
      await game(page, `skipTo(${wave})`);
      expect(await game(page, 'sector')).toBe(sector);
      expect(await game(page, 'bannerText')).toContain(text);
    }
  });

  test('cinturón de asteroides: aparecen, frenan disparos y romperlos da puntos', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(11)');
    await page.waitForTimeout(2300);
    await game(page, 'hazardNow()');
    await expect.poll(() => game(page, 'asteroidCount'), { timeout: 3000 }).toBeGreaterThan(0);
    // Un asteroide quieto justo arriba de la nave
    await game(page, 'freeze()');
    const before = await game(page, 'asteroidCount');
    await game(page, 'spawnAsteroidAt(300, 300)');
    await game(page, 'setPlayerX(300)');
    const score = await game(page, 'score');
    await page.keyboard.down('Space');
    await expect.poll(() => game(page, 'asteroidCount'), { timeout: 4000 }).toBeLessThanOrEqual(before);
    await page.keyboard.up('Space');
    expect(await game(page, 'score')).toBeGreaterThanOrEqual(score + 50);
  });

  test('agujero negro: la gravedad curva los disparos hacia el centro', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(16)');
    await page.waitForTimeout(2300);
    await game(page, 'freeze()');
    await game(page, 'setPlayerX(150)');
    await page.keyboard.down('Space');
    await page.waitForTimeout(80);
    await page.keyboard.up('Space');
    await page.waitForTimeout(400);
    const xs = await game(page, 'bulletXs');
    expect(xs.length).toBeGreaterThan(0);
    // Salió en x ≈ 148 y la gravedad lo corrió hacia el centro (x = 512)
    expect(Math.min(...xs)).toBeGreaterThan(165);
  });

  test('corona solar: hay erupciones con aviso', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(21)');
    await page.waitForTimeout(2300);
    await game(page, 'hazardNow()');
    await expect.poll(async () => (await game(page, 'lasers')).length, { timeout: 3000 }).toBeGreaterThan(0);
    expect((await game(page, 'lasers'))[0].firing).toBe(false);
  });
});

test.describe('MAGMA', () => {
  test('es la jefa de la oleada 10 y ataca con lava, crías y teletransporte', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(10)');
    expect(await game(page, 'bossInfo')).toEqual({ level: 2, name: 'MAGMA' });
    expect(await game(page, 'bannerText')).toContain('MAGMA APPROACHING');
    // Lluvia de lava
    await expect.poll(() => game(page, 'lavaCount'), { timeout: 10_000 }).toBeGreaterThan(0);
    // Crías
    await expect.poll(async () => (await game(page, 'kinds')).magmita || 0, { timeout: 10_000 }).toBeGreaterThan(0);
    // Teletransporte: en algún momento se vuelve intangible
    await expect.poll(async () => (await game(page, 'bossState')).intangible, { timeout: 12_000, intervals: [100] }).toBe(true);
  });

  test('en la nebulosa bajan magmitas antes de la jefa', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(6)');
    await page.waitForTimeout(2300);
    await game(page, 'hazardNow()');
    await expect.poll(async () => (await game(page, 'kinds')).magmita || 0, { timeout: 3000 }).toBeGreaterThan(0);
  });

  test('derrotar a MAGMA lleva al sector 3', async ({ page }) => {
    await openGame(page);
    await start(page);
    await game(page, 'skipTo(10)');
    await page.waitForTimeout(3600); // que termine de entrar
    await game(page, 'killAll()');
    await waitForState(page, 'upgrade', 10_000);
    await page.locator('.card').first().click();
    await expect.poll(() => game(page, 'wave'), { timeout: 5000 }).toBe(11);
    expect(await game(page, 'sector')).toBe(2);
  });
});
