import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

/**
 * Cenários de usuário (npm run test:scenarios): o VS Code aparece na tela e a pessoa simulada trabalha no ritmo de
 * gente. HEADLESS=1 roda sem janela; FAST=1 tira as pausas; um cenário só: npm run test:scenarios -- 01.
 * Os do GitHub usam a conta do `gh` (repositórios privados de teste, recriados a cada rodada).
 */
if (!process.env.HEADLESS) process.env.HEADED = '1';
try {
  process.env.TECHDOCS_EDITOR_E2E_GITHUB_TOKEN ??= execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
} catch {
  // Sem o gh: os cenários do GitHub avisam e param
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../../../node_modules/.cache/scenarios-results',
});
