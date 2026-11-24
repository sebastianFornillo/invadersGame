import { test, expect } from '@playwright/test';
import { openGame, game, waitForState, waitForWave } from './helpers.js';

test.describe('juego', () => {
  test('el menú carga sin errores y con la fuente del juego', async ({ page }) => {
    const errors = await openGame(page);
    expect(await game(page, 'state')).toBe('menu');
    await page.evaluate(() => document.fonts.load('16px "Press Start 2P"'));
    expect(await page.evaluate(() => document.fonts.check('16px "Press Start 2P"'))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Enter inicia la partida y Espacio dispara', async ({ page }) => {
    const errors = await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await game(page, 'wave')).toBe(1);
    await page.waitForTimeout(2500); // termina el cartel de la oleada
    await page.keyboard.down('Space');
    await page.waitForTimeout(700);
    await page.keyboard.up('Space');
    expect(await game(page, 'shots')).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('las flechas mueven la nave', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    const x0 = await game(page, 'playerX');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowLeft');
    expect(await game(page, 'playerX')).toBeLessThan(x0 - 50);
  });

  test('al limpiar la oleada pasa a la siguiente', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await game(page, 'killAll()');
    await waitForWave(page, 2);
  });

  test('P pausa y reanuda', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await page.keyboard.press('KeyP');
    expect(await game(page, 'state')).toBe('paused');
    await page.keyboard.press('KeyP');
    expect(await game(page, 'state')).toBe('playing');
  });

  test('el jefe aparece en la oleada 5 y al derrotarlo sigue la 6', async ({ page }) => {
    const errors = await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await game(page, 'skipTo(5)');
    const boss = await game(page, 'boss');
    expect(boss.hp).toBeGreaterThan(50);
    await page.waitForTimeout(500);
    await game(page, 'killAll()');
    await waitForWave(page, 6, 10_000);
    expect(errors).toEqual([]);
  });

  test('game over guarda el récord y Enter reinicia', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await game(page, 'addScore(1230)');
    await game(page, 'die()');
    await waitForState(page, 'gameover');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('invaders.highscores')));
    expect(saved[0].score).toBe(1230);
    await page.waitForTimeout(1100);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    expect(await game(page, 'score')).toBe(0);
  });

  test('sin ?test=1 no hay ganchos de trampa expuestos', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => typeof window.__invaders)).toBe('undefined');
  });
});
