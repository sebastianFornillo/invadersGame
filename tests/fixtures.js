// Fixture común: cualquier error de JavaScript no atrapado en la página hace
// fallar el test, aunque el test no lo esté buscando.
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'La página tiró errores de JavaScript').toEqual([]);
  },
});

export { expect };
