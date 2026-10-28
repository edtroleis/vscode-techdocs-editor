import { defineConfig } from '@playwright/test';

/**
 * VS Code de verdade (Electron) controlado pelo Playwright: `npm run test:e2e` na raiz.
 * Sem janela na tela (ozone headless); HEADED=1 mostra o VS Code.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Os vídeos do README têm a configuração deles (npm run record:videos)
  testIgnore: 'videos/**',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: '../../../node_modules/.cache/e2e-results',
});
