#!/usr/bin/env node
// Baixa de novo os exemplos de diagrama da documentação do Mermaid (mermaid.js.org: a página de introdução e as de
// sintaxe de cada tipo) para packages/ui/e2e/fixtures/mermaid-site-examples.json. O teste
// packages/ui/e2e/tests/mermaid-site-examples.spec.ts abre todos no editor visual a cada Release, sem rede.
//
// Rodar quando atualizar o Mermaid (o site documenta a versão mais nova):
//   npm run sync-mermaid-examples
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SITE = 'https://mermaid.js.org';
const OUTPUT = new URL('../packages/ui/e2e/fixtures/mermaid-site-examples.json', import.meta.url);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${SITE}/intro/`, { waitUntil: 'networkidle', timeout: 60_000 });
  const syntax = await page.evaluate(() => [
    ...new Set([...document.querySelectorAll('a[href*="/syntax/"]')].map(a => a.href.split(/[#?]/)[0])),
  ]);
  const examples = [];
  for (const url of [`${SITE}/intro/`, ...syntax]) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    // textContent: innerText volta vazio nos blocos fora da tela
    const codes = await page.evaluate(() =>
      [...document.querySelectorAll('div.language-mermaid code, div.language-mermaid-example code')].map(c => c.textContent ?? ''),
    );
    const name = url.replace(`${SITE}/`, '');
    codes.forEach((code, i) => examples.push({ page: name, n: i + 1, code: code.replace(/\n$/, '') }));
    console.log(`${name.padEnd(45)} ${codes.length}`);
  }
  if (examples.length === 0 || examples.some(e => !e.code.trim())) throw new Error('Exemplo vazio: o site mudou de formato?');
  const syncedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(OUTPUT, `${JSON.stringify({ source: SITE, syncedAt, examples }, null, 1)}\n`);
  console.log(`${examples.length} exemplos em ${OUTPUT.pathname}`);
} finally {
  await browser.close();
}
