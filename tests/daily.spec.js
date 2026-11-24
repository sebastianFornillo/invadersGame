import { test, expect } from '@playwright/test';
import { openGame, game, waitForState, mockOnline, playUntilScore } from './helpers.js';

const panel = (page) => page.locator('.overlay .panel');
const todayUTC = () => new Date().toISOString().slice(0, 10);

// Captura lo que el juego comparte (en vez de abrir el menú del sistema)
async function captureShare(page) {
  await page.addInitScript(() => {
    window.__shared = null;
    navigator.share = (data) => {
      window.__shared = data;
      return Promise.resolve();
    };
  });
}

async function startDaily(page) {
  await page.keyboard.press('ArrowRight');
  expect(await game(page, 'menuSel')).toBe(1);
  await page.keyboard.press('Enter');
  await expect(panel(page)).toContainText('DESAFÍO DIARIO');
  await page.getByRole('button', { name: 'JUGAR', exact: true }).click();
  await waitForState(page, 'playing');
  expect(await game(page, 'mode')).toBe('daily');
}

test.describe('azar con semilla', () => {
  test('misma semilla, misma secuencia; distinta semilla, distinta secuencia', async ({ page }) => {
    await openGame(page);
    const [a, b, c] = await page.evaluate(async () => {
      const { createRng } = await import('/src/rng.js');
      const take = (r) => Array.from({ length: 5 }, () => r());
      return [take(createRng('daily-2026-11-24')), take(createRng('daily-2026-11-24')), take(createRng('daily-2026-11-25'))];
    });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  test('dos jugadores del mismo día arrancan con el mismo azar', async ({ browser }) => {
    const samples = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openGame(page);
      await startDaily(page);
      samples.push(await game(page, 'seedSample()'));
      await ctx.close();
    }
    expect(samples[0]).toEqual(samples[1]);
  });

  test('las partidas normales usan azar distinto cada vez', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    const first = await game(page, 'seedSample()');
    await game(page, 'die()');
    await waitForState(page, 'gameover');
    await page.waitForTimeout(1100);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await game(page, 'seedSample()')).not.toEqual(first);
  });
});

test.describe('desafío diario', () => {
  test('sin ranking: al perder muestra el resultado y se comparte con la grilla', async ({ page }) => {
    await captureShare(page);
    await openGame(page);
    await startDaily(page);
    await playUntilScore(page);
    await game(page, 'die()');
    await waitForState(page, 'gameover');
    await expect(panel(page)).toContainText('PTS', { timeout: 5000 });
    await expect(panel(page).locator('.grid')).toContainText('💀');
    await page.getByRole('button', { name: 'COMPARTIR' }).click();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared.text).toContain('Desafío');
    expect(shared.text).toContain('Oleada 1');
    expect(shared.text).toContain('💀');
    expect(shared.text).toContain('?modo=diario');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('invaders.daily')));
    expect(saved).toMatchObject({ day: todayUTC(), status: 'done', wave: 1 });
  });

  test('el intento oficial se gasta al empezar: recargar no da otro', async ({ page }) => {
    await openGame(page);
    await startDaily(page);
    await page.reload();
    await page.waitForFunction(() => window.__invaders && window.__invaders.ready);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toContainText('Ya usaste el intento de hoy');
    await expect(page.getByRole('button', { name: 'JUGAR', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'PRÁCTICA' }).click();
    await waitForState(page, 'playing');
    expect(await game(page, 'practice')).toBe(true);
  });

  test('con ranking: registra la partida diaria y la guarda en HOY', async ({ page }) => {
    await captureShare(page);
    const calls = await mockOnline(page, {
      start_run: (args) => [{ run_id: '00000000-0000-4000-8000-000000000009', day: args.p_mode === 'daily' ? '2026-11-24' : null }],
    });
    await openGame(page);
    await startDaily(page);
    await expect.poll(() => game(page, 'runId')).not.toBeNull();
    expect(calls.find((c) => c.fn === 'start_run').args.p_mode).toBe('daily');
    await playUntilScore(page);
    await game(page, 'die()');
    await waitForState(page, 'gameover');
    await expect(panel(page)).toContainText('DESAFÍO', { timeout: 5000 });
    await page.locator('#playerName').fill('Seba');
    await page.getByRole('button', { name: 'GUARDAR' }).click();
    await expect(panel(page)).toContainText('en el desafío de hoy');
    await page.getByRole('button', { name: 'COMPARTIR' }).click();
    expect((await page.evaluate(() => window.__shared)).text).toContain('Invaders Space');
    await page.getByRole('button', { name: 'VER RANKING' }).click();
    await expect(page.getByRole('tab', { name: 'HOY' })).toHaveAttribute('aria-selected', 'true');
    expect(calls.filter((c) => c.fn === 'get_leaderboard').pop().args.p_scope).toBe('daily');
  });

  test('la práctica no se registra en el servidor ni ofrece guardar', async ({ page }) => {
    const calls = await mockOnline(page);
    await page.addInitScript((day) => {
      localStorage.setItem('invaders.daily', JSON.stringify({ day, status: 'done', score: 900, wave: 2, grid: ['🟨', '💀'] }));
    }, todayUTC());
    await openGame(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toContainText('900 PTS');
    await page.getByRole('button', { name: 'PRÁCTICA' }).click();
    await waitForState(page, 'playing');
    await playUntilScore(page);
    await game(page, 'die()');
    await waitForState(page, 'gameover');
    await page.waitForTimeout(1600);
    await expect(panel(page)).toHaveCount(0);
    expect(calls.some((c) => c.fn === 'start_run' || c.fn === 'submit_score')).toBe(false);
  });

  test('el link ?modo=diario abre el menú con el desafío elegido', async ({ page }) => {
    await openGame(page, '&modo=diario');
    expect(await game(page, 'menuSel')).toBe(1);
    expect(new URL(page.url()).searchParams.get('modo')).toBeNull();
  });

  test('tocar la opción del desafío en el canvas la elige', async ({ page }) => {
    await openGame(page);
    const box = await page.locator('#game').boundingBox();
    // Opción derecha del menú: x = W/2 + 150, y = 378 en coordenadas lógicas (1024 × 576)
    await page.mouse.click(box.x + ((512 + 150) / 1024) * box.width, box.y + (378 / 576) * box.height);
    await expect(panel(page)).toContainText('DESAFÍO DIARIO');
  });
});
