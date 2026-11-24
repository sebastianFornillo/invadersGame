import { defineConfig, devices } from '@playwright/test';

// Para usar un Chrome ya instalado: PW_CHROMIUM_PATH=/usr/bin/google-chrome npm test
const executablePath = process.env.PW_CHROMIUM_PATH;
const PORT = 4173;

export default defineConfig({
  testDir: 'tests',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // El service worker se prueba aparte; en el resto molesta a los mocks de red.
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stderr: 'ignore',
  },
  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.js/,
    },
    {
      name: 'celular',
      use: { ...devices['Pixel 7 landscape'] },
      testMatch: /mobile\.spec\.js/,
    },
  ],
});
