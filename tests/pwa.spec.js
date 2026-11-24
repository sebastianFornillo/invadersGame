import { test, expect } from '@playwright/test';

test.describe('app instalable (PWA)', () => {
  test('el manifest es válido y sus íconos existen', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe('Invaders Space');
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const r = await request.get('/' + icon.src);
      expect(r.ok(), icon.src).toBe(true);
    }
  });

  test('todos los archivos de CORE del service worker existen', async ({ request }) => {
    const sw = await (await request.get('/sw.js')).text();
    const core = [...sw.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
    expect(core.length).toBeGreaterThan(8);
    for (const file of core) {
      const r = await request.get(file.replace(/^\.\//, '/') || '/');
      expect(r.ok(), file).toBe(true);
    }
  });

  test('todos los módulos de src/ están en CORE (para jugar offline)', async ({ request, page }) => {
    const sw = await (await request.get('/sw.js')).text();
    await page.goto('/index.html?test=1');
    await page.waitForFunction(() => window.__invaders && window.__invaders.ready);
    const loaded = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => new URL(e.name))
        .filter((u) => u.origin === location.origin && u.pathname.startsWith('/src/'))
        .map((u) => '.' + u.pathname),
    );
    for (const mod of loaded) expect(sw, `${mod} falta en CORE`).toContain(`'${mod}'`);
  });

  test.describe('con service worker', () => {
    test.use({ serviceWorkers: 'allow' });

    test('se registra y el juego carga sin conexión', async ({ page, context }) => {
      await page.goto('/index.html');
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return reg.active.state;
      });
      // Esperar a que la página quede controlada por el service worker
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator('#game')).toBeVisible();
      await page.waitForTimeout(500);
      const painted = await page.evaluate(() => {
        const c = document.getElementById('game');
        const px = c.getContext('2d').getImageData(c.width / 2, 10, 1, 1).data;
        return px[3] > 0;
      });
      expect(painted).toBe(true);
      await context.setOffline(false);
    });
  });
});
