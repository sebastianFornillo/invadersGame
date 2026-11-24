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

// Juega de verdad hasta sumar puntos (sin trucos, para poder guardar en el ranking)
export async function playUntilScore(page, timeout = 20_000) {
  await page.waitForTimeout(2300); // cartel de la oleada
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__invaders.score > 0, null, { timeout });
  await page.keyboard.up('Space');
}

// Reemplaza src/config.js para apuntar a un servidor de prueba
export async function useConfig(page, supabaseUrl, supabaseKey) {
  await page.route('**/src/config.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const CONFIG = ${JSON.stringify({ supabaseUrl, supabaseKey })};`,
    }),
  );
}

// API de Supabase simulada: responde según la función y guarda las llamadas
export async function mockOnline(page, handlers = {}) {
  const calls = [];
  const base = 'https://api.invaders.test';
  await useConfig(page, base, 'sb_publishable_test');
  const defaults = {
    start_run: () => [{ run_id: '00000000-0000-4000-8000-000000000001', day: null }],
    submit_score: () => [{ world_rank: 3, players: 120, league_rank: null, personal_best: true }],
    get_leaderboard: (args) => [
      { pos: 1, player: 'Lea', score: 98000, wave: 9, created_at: '2026-11-24T10:00:00Z', is_me: false },
      { pos: 2, player: 'Fede', score: 51000, wave: 6, created_at: '2026-11-24T10:00:00Z', is_me: false },
      { pos: 7, player: args.p_scope === 'week' ? 'Semanal' : 'Yo', score: 1200, wave: 2, created_at: '2026-11-24T10:00:00Z', is_me: true },
    ],
    create_league: (args) => [{ code: 'BARR78', name: args.p_name }],
    get_league: (args) => (args.p_code === 'ABC234' ? [{ code: 'ABC234', name: 'Los Pibes', players: 4 }] : []),
  };
  await page.route(`${base}/rest/v1/rpc/*`, async (route) => {
    const fn = route.request().url().split('/').pop();
    const args = route.request().postDataJSON() || {};
    const headers = route.request().headers();
    calls.push({ fn, args, apikey: headers.apikey });
    const handler = handlers[fn] || defaults[fn];
    const out = handler ? await handler(args) : { status: 404 };
    if (out && out.status) {
      await route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body || {}) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
  });
  return calls;
}
