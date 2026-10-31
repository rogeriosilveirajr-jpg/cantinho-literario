// Testes ponta a ponta (E2E) do Cantinho Literário.
// Rodam contra os emuladores locais do Firebase, nunca contra o banco real:  npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

const PORT = 5055;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,          // os testes dividem o mesmo emulador
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block',     // o cache offline não pode servir arquivos antigos durante o teste
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
  },
  projects: [
    { name: 'computador', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testIgnore: /responsivo\.spec\.mjs/ },
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /responsivo\.spec\.mjs/ },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
  },
});
