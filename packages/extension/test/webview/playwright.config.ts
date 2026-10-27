import { defineConfig, devices } from '@playwright/test';

/** O bundle do webview (dist/webview) no Chromium, fora do VS Code: `npm run test:webview` na raiz. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: '../../../../test-results',
  use: { ...devices['Desktop Chrome'], screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
