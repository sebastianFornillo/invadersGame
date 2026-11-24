import { test, expect } from './fixtures.js';
import { openGame, game, waitForState, mockOnline, useConfig, playUntilScore } from './helpers.js';

const panel = (page) => page.locator('.overlay .panel');

async function startAndLose(page) {
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await playUntilScore(page);
  await game(page, 'die()');
  await waitForState(page, 'gameover');
}

test.describe('ranking online', () => {
  test('sin configurar no hay botón de ranking ni llamadas al servidor', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await openGame(page);
    await expect(page.locator('#rankBtn')).toBeHidden();
    await page.keyboard.press('KeyR');
    await expect(panel(page)).toHaveCount(0);
    expect(requests.filter((u) => u.includes('/rest/v1/'))).toEqual([]);
  });

  test('una clave secreta en config.js desactiva el ranking', async ({ page }) => {
    const messages = [];
    page.on('console', (m) => messages.push(m.text()));
    await useConfig(page, 'https://api.invaders.test', 'sb_secret_no_deberia_estar_aca');
    await openGame(page);
    await expect(page.locator('#rankBtn')).toBeHidden();
    expect(messages.join(' ')).toContain('clave SECRETA');
  });

  test('R abre el ranking, marca mi fila y cambia de pestaña', async ({ page }) => {
    const calls = await mockOnline(page);
    await openGame(page);
    await expect(page.locator('#rankBtn')).toBeVisible();
    await page.keyboard.press('KeyR');
    await expect(panel(page)).toContainText('RANKING');
    await expect(page.locator('.board li')).toHaveCount(4); // 3 filas + "· · ·"
    await expect(page.locator('.board li.me')).toContainText('Yo');
    expect(calls.find((c) => c.fn === 'get_leaderboard').apikey).toBe('sb_publishable_test');
    await page.getByRole('tab', { name: 'SEMANA' }).click();
    await expect(page.locator('.board li.me')).toContainText('Semanal');
    expect(calls.filter((c) => c.fn === 'get_leaderboard').map((c) => c.args.p_scope)).toEqual(['global', 'week']);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await game(page, 'state')).toBe('menu');
  });

  test('al perder ofrece guardar el puntaje y muestra el puesto', async ({ page }) => {
    const calls = await mockOnline(page);
    await openGame(page);
    await startAndLose(page);
    await expect(panel(page)).toContainText('PTS', { timeout: 5000 });
    const score = await game(page, 'score');
    await page.locator('#playerName').fill('Seba');
    await page.getByRole('button', { name: 'GUARDAR' }).click();
    await expect(panel(page)).toContainText('#3');
    await expect(panel(page)).toContainText('RÉCORD PERSONAL');
    const sent = calls.find((c) => c.fn === 'submit_score').args;
    expect(sent).toMatchObject({ p_player: 'Seba', p_score: score, p_wave: 1, p_run: '00000000-0000-4000-8000-000000000001' });
    expect(sent.p_league).toBeNull();
    // Recuerda el nombre para la próxima
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('invaders.name')))).toBe('Seba');
    await page.getByRole('button', { name: 'JUGAR DE NUEVO' }).click();
    await waitForState(page, 'playing');
  });

  test('nombre inválido: avisa sin llamar al servidor', async ({ page }) => {
    const calls = await mockOnline(page);
    await openGame(page);
    await startAndLose(page);
    await page.locator('#playerName').fill('<b>');
    await page.getByRole('button', { name: 'GUARDAR' }).click();
    await expect(panel(page)).toContainText('de 2 a 12');
    expect(calls.some((c) => c.fn === 'submit_score')).toBe(false);
  });

  test('si el servidor rechaza el puntaje se muestra el motivo y se puede reintentar', async ({ page }) => {
    await mockOnline(page, {
      submit_score: () => ({ status: 400, body: { message: 'puntaje rechazado por el control antitrampas' } }),
    });
    await openGame(page);
    await startAndLose(page);
    await page.locator('#playerName').fill('Seba');
    await page.getByRole('button', { name: 'GUARDAR' }).click();
    await expect(panel(page)).toContainText('antitrampas');
    await expect(page.getByRole('button', { name: 'REINTENTAR' })).toBeEnabled();
  });

  test('una partida con trucos de test no se puede guardar', async ({ page }) => {
    await mockOnline(page);
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await game(page, 'addScore(5000)');
    await game(page, 'die()');
    await waitForState(page, 'gameover');
    await page.waitForTimeout(1600);
    await expect(panel(page)).toHaveCount(0);
  });

  test('mientras se escribe el nombre, las teclas no controlan el juego', async ({ page }) => {
    await mockOnline(page);
    await openGame(page);
    await startAndLose(page);
    const input = page.locator('#playerName');
    await input.fill('');
    await input.pressSequentially('pepe r m');
    await expect(input).toHaveValue('pepe r m');
    expect(await game(page, 'state')).toBe('gameover');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await game(page, 'state')).toBe('gameover');
  });
});

test.describe('ligas privadas', () => {
  test('el link de invitación une a la liga y la suma al ranking', async ({ page }) => {
    const calls = await mockOnline(page);
    await openGame(page, '&liga=abc234');
    await expect(page.locator('.toast')).toContainText('Los Pibes');
    expect(new URL(page.url()).searchParams.get('liga')).toBeNull();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('invaders.league')))).toEqual({ code: 'ABC234', name: 'Los Pibes' });
    await page.keyboard.press('KeyR');
    await expect(page.getByRole('tab', { name: 'LOS PIBES' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Los puntajes se guardan con la liga
    await startAndLose(page);
    await page.locator('#playerName').fill('Seba');
    await page.getByRole('button', { name: 'GUARDAR' }).click();
    await expect(panel(page)).toContainText('#3');
    expect(calls.find((c) => c.fn === 'submit_score').args.p_league).toBe('ABC234');
  });

  test('crear una liga muestra el código para invitar', async ({ page }) => {
    const calls = await mockOnline(page);
    await openGame(page);
    await page.keyboard.press('KeyR');
    await page.getByRole('button', { name: 'LIGAS PRIVADAS' }).click();
    await page.getByLabel('Nombre de la liga nueva').fill('Los del Barrio');
    await page.getByRole('button', { name: 'CREAR' }).click();
    await expect(panel(page)).toContainText('BARR78');
    await expect(page.getByRole('button', { name: 'INVITAR AMIGOS' })).toBeVisible();
    expect(calls.find((c) => c.fn === 'create_league').args.p_name).toBe('Los del Barrio');
    await page.getByRole('button', { name: 'SALIR' }).click();
    await expect(panel(page)).toContainText('LIGAS PRIVADAS');
  });

  test('unirse con un código inexistente avisa el error', async ({ page }) => {
    await mockOnline(page);
    await openGame(page);
    await page.keyboard.press('KeyR');
    await page.getByRole('button', { name: 'LIGAS PRIVADAS' }).click();
    await page.getByLabel('Código de una liga existente').fill('zzzz22');
    await page.getByRole('button', { name: 'UNIRME' }).click();
    await expect(panel(page)).toContainText('No existe');
  });
});
