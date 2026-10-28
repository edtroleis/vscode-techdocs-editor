import { defineConfig } from '@playwright/test';

/** Vídeos do README (npm run record:videos): o VS Code de verdade, gravado; um teste por vídeo. */
export default defineConfig({
  testDir: '.',
  testMatch: 'record.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../../../../node_modules/.cache/video-results',
});
