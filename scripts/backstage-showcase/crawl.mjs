// Conferência da vitrine no Backstage: abre cada página como uma pessoa (login de convidado), espera o TechDocs e os
// diagramas, tira a captura e anota o que está errado ou difícil de ler. Usado pelo run.mjs.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** index.md → "", guia/index.md → "guia/", guia/deploy.md → "guia/deploy/" (o use_directory_urls do MkDocs). */
export const pageUrl = path => path.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '/');

/** O que a página mostra, lido dentro do shadow DOM do TechDocs. */
function inspect() {
  const root = document.querySelector('[data-testid="techdocs-native-shadowroot"]')?.shadowRoot;
  if (!root) return { loaded: false };
  const article = root.querySelector('article') ?? root;
  const text = article.textContent ?? '';
  // O addon do Mermaid esconde o <pre class="mermaid"> do MkDocs e põe o desenho num <div class="mermaid"> ao lado.
  // O <pre> que continua à vista é um diagrama que não foi desenhado
  const drawnDivs = [...article.querySelectorAll('div.mermaid')].map(el => {
    const svg = el.querySelector('svg');
    const box = svg?.getBoundingClientRect();
    const natural = svg?.viewBox?.baseVal?.width || 0;
    const error = !!svg && (/Syntax error|Parse error|error in text/i.test(svg.textContent ?? '') || svg.getAttribute('aria-roledescription') === 'error');
    return {
      drawn: !!svg && !error,
      error,
      // Diagrama desenhado menor que o natural: o texto fica pequeno no Backstage (ele não tem zoom)
      scale: svg && natural && box?.width ? box.width / natural : 1,
      overflow: el.scrollWidth > el.clientWidth + 4,
      raw: '',
    };
  });
  const undrawn = [...article.querySelectorAll('pre.mermaid')]
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => ({ drawn: false, error: false, scale: 1, overflow: false, raw: (el.textContent ?? '').trim().slice(0, 600) }));
  const diagrams = [...drawnDivs, ...undrawn];
  const images = [...article.querySelectorAll('img')].filter(img => img.complete && img.naturalWidth === 0).map(img => img.getAttribute('src'));
  // Markdown que não virou HTML: blocos do MkDocs mal indentados, campos de template sem valor, cercas soltas
  const paragraphs = [...article.querySelectorAll('p')].map(p => p.textContent ?? '');
  const raw = paragraphs.filter(t => /^(!!!|\?\?\?|===|```|:::)/.test(t.trim())).map(t => t.trim().slice(0, 80));
  // Fora do código e dos diagramas: no mindmap, `{{texto}}` é o hexágono
  const prose = article.cloneNode(true);
  for (const el of prose.querySelectorAll('pre, code, .mermaid')) el.remove();
  const placeholders = [...(prose.textContent ?? '').matchAll(/\{\{\s*[\w-]+\s*\}\}/g)].map(m => m[0]);
  const wideTables = [...article.querySelectorAll('table')].filter(t => t.scrollWidth > (t.parentElement?.clientWidth ?? 0) + 4).length;
  return {
    loaded: true,
    title: article.querySelector('h1')?.textContent?.replace(/¶$/, '').trim() ?? '',
    words: text.split(/\s+/).filter(Boolean).length,
    diagrams,
    images,
    raw,
    placeholders: [...new Set(placeholders)],
    wideTables,
    admonitions: article.querySelectorAll('.admonition, details').length,
  };
}

export async function crawl({ frontend, entities, out, log, limit }) {
  mkdirSync(join(out, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const deadline = Date.now() + limit * 1000;
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    // Login de convidado uma vez: o contexto guarda a sessão
    const login = await context.newPage();
    await login.goto(`${frontend}/docs`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await login.getByRole('button', { name: /enter/i }).click({ timeout: 30_000 });
    await login.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await login.close();

    const queue = entities.flatMap(entity => entity.pages.map(page => ({ entity, page })));
    const results = [];
    let done = 0;
    const worker = async () => {
      const page = await context.newPage();
      const errors = [];
      page.on('console', message => message.type() === 'error' && errors.push(message.text().slice(0, 300)));
      page.on('pageerror', error => errors.push(String(error).slice(0, 300)));
      for (let item; (item = queue.shift()); ) {
        if (Date.now() > deadline) throw new Error(`a conferência passou de ${limit} s`);
        const { entity, page: doc } = item;
        const url = `${frontend}/docs/default/component/${entity.name}/${pageUrl(doc.path)}`;
        const shot = `shots/${entity.name}--${doc.path.replace(/[^\w-]+/g, '_')}.jpg`;
        errors.length = 0;
        const at = Date.now();
        let found = { loaded: false };
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          // O TechDocs pronto: o título da página dentro do shadow DOM
          await page.waitForFunction(() => document.querySelector('[data-testid="techdocs-native-shadowroot"]')?.shadowRoot?.querySelector('article h1'), null, { timeout: 45_000 });
          // Os diagramas: o addon desenha depois; espera todos terem svg (ou erro), até 30 s
          if (doc.mermaid)
            await page
              .waitForFunction(
                expected => {
                  const root = document.querySelector('[data-testid="techdocs-native-shadowroot"]')?.shadowRoot;
                  return (root?.querySelectorAll('article div.mermaid svg').length ?? 0) >= expected;
                },
                doc.mermaid,
                { timeout: 30_000, polling: 500 },
              )
              .catch(() => undefined);
          await page.waitForTimeout(400);
          found = await page.evaluate(inspect);
          await page.screenshot({ path: join(out, shot), type: 'jpeg', quality: 60, fullPage: true, timeout: 30_000 }).catch(() => page.screenshot({ path: join(out, shot), type: 'jpeg', quality: 60 }));
        } catch (error) {
          found = { ...found, failure: String(error.message ?? error).split('\n')[0] };
          await page.screenshot({ path: join(out, shot), type: 'jpeg', quality: 60 }).catch(() => undefined);
        }
        results.push({ entity: entity.name, path: doc.path, title: doc.title, expectedDiagrams: doc.mermaid, url, shot, seconds: (Date.now() - at) / 1000, console: [...new Set(errors)], ...found });
        done++;
        if (done % 20 === 0) log(`  ${done} páginas conferidas`);
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return results;
  } finally {
    await browser.close();
  }
}
