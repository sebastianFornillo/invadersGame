import { test, expect } from './fixtures.js';
import { openGame, game, waitForState } from './helpers.js';

async function start(page) {
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
}

async function bossArrives(page, wave) {
  await game(page, `skipTo(${wave})`);
  await expect.poll(async () => (await game(page, 'bossState')).entering, { timeout: 8000 }).toBe(false);
}

const state = (page) => game(page, 'bossState');

test('un jefe por sector y después vuelven más fuertes', async ({ page }) => {
  await openGame(page);
  await start(page);
  const lineup = [[5, 'MOTHERSHIP'], [10, 'MAGMA'], [15, 'TITAN'], [20, 'VORTEX'], [25, 'SOLAR PHOENIX'], [30, 'MOTHERSHIP MK II'], [35, 'MAGMA +1']];
  for (const [wave, name] of lineup) {
    await game(page, `skipTo(${wave})`);
    expect((await game(page, 'bossInfo')).name).toBe(name);
  }
});

test.describe('TITAN', () => {
  test('las rocas que orbitan frenan los disparos y se pueden romper', async ({ page }) => {
    await openGame(page);
    await start(page);
    await bossArrives(page, 15);
    expect((await state(page)).rocks).toBe(8);
    await page.keyboard.down('Space');
    for (let i = 0; i < 40 && (await state(page)).broken === 0; i++) {
      await game(page, `setPlayerX(${(await state(page)).x})`);
      await page.waitForTimeout(150);
    }
    await page.keyboard.up('Space');
    expect((await state(page)).broken).toBeGreaterThan(0);
  });

  test('arroja rocas y hace caer escombros', async ({ page }) => {
    await openGame(page);
    await start(page);
    await bossArrives(page, 15);
    await expect.poll(async () => (await game(page, 'bulletKinds')).rock || 0, { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await game(page, 'bulletKinds')).debris || 0, { timeout: 8000 }).toBeGreaterThan(0);
  });
});

test.describe('VORTEX', () => {
  test('se traga los disparos, te atrae y después te los devuelve', async ({ page }) => {
    await openGame(page);
    await start(page);
    await bossArrives(page, 20);
    await expect.poll(async () => (await state(page)).absorbing, { timeout: 10_000, intervals: [100] }).toBeGreaterThan(0);
    expect((await state(page)).intangible).toBe(true);
    // Te atrae: sin tocar nada, la nave se acerca al vórtice
    await game(page, 'setPlayerX(60)');
    const bx = (await state(page)).x;
    const d0 = Math.abs(bx - 60);
    await page.waitForTimeout(400);
    const d1 = Math.abs((await state(page)).x - (await game(page, 'playerX')));
    expect(d1).toBeLessThan(d0);
    // Disparos debajo del vórtice mientras absorbe: se los traga
    await page.keyboard.down('Space');
    for (let i = 0; i < 40 && (await state(page)).absorbing > 0; i++) {
      await game(page, `setPlayerX(${(await state(page)).x})`);
      await page.waitForTimeout(80);
    }
    await page.keyboard.up('Space');
    expect((await state(page)).absorbed).toBeGreaterThan(0);
    // Y cuando termina de absorber, los devuelve como orbes
    await expect.poll(async () => (await game(page, 'bulletKinds')).orb || 0, { timeout: 5000 }).toBeGreaterThan(5);
  });
});

test.describe('SOLAR PHOENIX', () => {
  test('avisa con una mira y pica hacia la nave', async ({ page }) => {
    await openGame(page);
    await start(page);
    await bossArrives(page, 25);
    await expect.poll(async () => (await state(page)).mode, { timeout: 8000, intervals: [50] }).toBe('telegraph');
    await expect.poll(async () => (await state(page)).mode, { timeout: 3000, intervals: [50] }).toBe('dive');
  });

  test('revive una vez con la mitad de la vida y a la segunda muere', async ({ page }) => {
    await openGame(page);
    await start(page);
    await bossArrives(page, 25);
    await game(page, 'damageBoss(100000)');
    let s = await state(page);
    expect(s.mode).toBe('egg');
    expect(s.reborn).toBe(true);
    expect(s.intangible).toBe(true);
    expect(await game(page, 'bannerText')).toContain('REBORN!');
    await expect.poll(async () => (await state(page)).mode, { timeout: 5000 }).not.toBe('egg');
    s = await state(page);
    expect(s.hp).toBeGreaterThanOrEqual(Math.floor(s.maxHp * 0.45));
    await game(page, 'damageBoss(100000)');
    expect((await state(page)).dying).toBeGreaterThan(0);
    await waitForState(page, 'upgrade', 10_000);
  });
});
