// Gera media/icon.png (256 px, o ícone do Marketplace) a partir de media/icon.svg, com o Chromium do
// Playwright. Uso: node packages/extension/media/render-icon.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: join(dir, 'icon.png'), omitBackground: true });
await browser.close();
console.log('media/icon.png');
