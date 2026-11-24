// Utilidades compartidas por los tests.

// Abre el juego en modo test y junta errores de JavaScript.
export async function openGame(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(`/index.html?test=1${query}`);
  await page.waitForFunction(() => window.__invaders && window.__invaders.ready);
  return errors;
}

// Lee una propiedad o llama a un gancho de test: game(page, 'state'), game(page, 'killAll()')
export const game = (page, expr) => page.evaluate(`window.__invaders.${expr}`);

export async function waitForState(page, state, timeout = 8000) {
  await page.waitForFunction((s) => window.__invaders.state === s, state, { timeout });
}

export async function waitForWave(page, wave, timeout = 8000) {
  await page.waitForFunction((w) => window.__invaders.wave === w, wave, { timeout });
}
