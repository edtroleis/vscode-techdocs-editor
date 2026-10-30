/** Webview da prévia da documentação nova: desenha o plano do host e devolve o que a pessoa mexeu. */
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreviewMessage, PreviewView } from '../../src/templates/sitePreview';
import { serveExtension } from './webview';

/** Os textos em inglês do host, lidos de `previewLabels()` (o webview não tem `vscode.l10n`). */
const LABELS = Object.fromEntries(
  [...readFileSync(join(__dirname, '..', '..', 'src', 'templates', 'sitePreview.ts'), 'utf8').matchAll(/(\w+): vscode\.l10n\.t\('([^']*)'\)/g)].map(m => [m[1], m[2]]),
);

const page = (path: string, title: string, origin: 'template' | 'added' | 'existing' = 'template') => ({ path, title, included: true, origin, status: origin === 'existing' ? ('unchanged' as const) : ('new' as const) });

const VIEW: PreviewView = {
  folder: 'pagamentos',
  templates: [
    { id: 'golden-path', name: 'Golden path', origin: 'builtIn' },
    { id: 'service-docs', name: 'Service docs', origin: 'builtIn' },
  ],
  template: 'service-docs',
  allowNone: false,
  siteName: 'Pagamentos',
  siteNameFrom: 'README.md',
  owner: 'time-pagamentos',
  ownerFrom: 'CODEOWNERS',
  ownerRequired: true,
  readme: { path: 'README.md', use: 'copy' },
  pageTypes: [{ id: 'adr', name: 'Decision record (ADR)' }],
  files: [
    { path: 'mkdocs.yml', status: 'new', origin: 'mkdocs', optional: false, included: true },
    { path: 'catalog-info.yaml', status: 'new', origin: 'catalog', optional: true, included: true },
    { path: 'docs/adr/0001-record-decisions.md', status: 'new', origin: 'template', optional: true, included: true },
    { path: 'docs/architecture.md', status: 'new', origin: 'template', optional: true, included: false },
    { path: 'docs/index.md', status: 'new', origin: 'template', optional: true, included: true, readme: 'copy' },
    { path: 'README.md', status: 'unchanged', origin: 'readme', optional: false, included: true, readme: 'copy' },
  ],
  nav: [
    { kind: 'page', key: 'index.md', page: page('index.md', 'Pagamentos') },
    { kind: 'page', key: 'architecture.md', page: { ...page('architecture.md', 'Architecture'), included: false } },
    { kind: 'section', key: 'section:Decisions', name: 'Decisions', original: 'Decisions', pages: [page('adr/0001-record-decisions.md', 'Record decisions')] },
  ],
  missing: [],
  selected: 'docs/index.md',
  busy: false,
};

const sent = (p: Page) => p.evaluate(() => (window as unknown as { sent: PreviewMessage[] }).sent);
const last = async (p: Page) => (await sent(p)).at(-1);

async function show(p: Page, view: Partial<PreviewView> = {}) {
  await p.evaluate(message => window.postMessage(message, '*'), { type: 'state', state: { status: 'ready', view: { ...VIEW, ...view } }, labels: LABELS });
}

test.beforeEach(async ({ page: p }) => {
  await serveExtension(p);
  await p.goto('http://webview.test/test/webview/preview-harness.html');
  await expect.poll(async () => (await sent(p)).some(m => m.type === 'ready')).toBe(true);
});

test('campos com a origem da sugestão; desmarcar um arquivo e abrir outro', async ({ page: p }) => {
  await show(p);
  await expect(p.getByLabel('Site name')).toHaveValue('Pagamentos');
  await expect(p.getByText('Suggested from CODEOWNERS')).toBeVisible();
  await expect(p.getByText('copied from README.md')).toBeVisible();
  await expect(p.getByText('4 new, 0 modified · nothing written yet')).toBeVisible();
  await p.getByLabel('Include catalog-info.yaml').uncheck();
  expect(await last(p)).toEqual({ type: 'toggle', path: 'catalog-info.yaml', on: false });
  await p.getByText('architecture.md').click();
  expect(await last(p)).toEqual({ type: 'open', path: 'docs/architecture.md' });
  await p.getByLabel('Template').selectOption('golden-path');
  expect(await last(p)).toEqual({ type: 'set', field: 'template', value: 'golden-path' });
});

test('campo que falta: aviso, Criar desligado; o dono opcional sem o catalog-info.yaml', async ({ page: p }) => {
  await show(p, { owner: '', missing: ['owner'] });
  await expect(p.getByText('Fill in the owner or uncheck catalog-info.yaml.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Create' })).toBeDisabled();
  await show(p, { owner: '', ownerRequired: false });
  await expect(p.getByText('Only catalog-info.yaml needs the owner, and it is unchecked.')).toBeVisible();
  await p.getByRole('button', { name: 'Create' }).click();
  expect(await last(p)).toEqual({ type: 'create' });
});

test('menu: subir, renomear com dois cliques e acrescentar página na seção com o tipo', async ({ page: p }) => {
  await show(p);
  await p.getByRole('button', { name: 'Menu' }).click();
  await p.getByText('Architecture', { exact: true }).hover();
  await p.getByRole('button', { name: 'Move up' }).nth(1).click();
  expect(await last(p)).toEqual({ type: 'move', key: 'architecture.md', delta: -1 });
  await p.getByText('Pagamentos', { exact: true }).dblclick();
  await p.locator('#rename').fill('Início');
  await p.locator('#rename').press('Enter');
  expect(await last(p)).toEqual({ type: 'rename', key: 'index.md', title: 'Início' });
  await p.getByText('Decisions', { exact: true }).hover();
  await p.getByRole('button', { name: 'Add page in Decisions' }).click();
  await p.getByLabel('Kind of page').selectOption('adr');
  await p.getByPlaceholder('Page title').fill('Usar Postgres');
  await p.getByPlaceholder('Page title').press('Enter');
  expect(await last(p)).toEqual({ type: 'add', text: 'Usar Postgres', by: 'title', section: 'Decisions', template: 'adr' });
});

test('arquivos: "+ Página" pede o nome (com pasta, se quiser); página que já existe pede manter ou substituir', async ({ page: p }) => {
  await show(p, {
    files: [...VIEW.files, { path: 'docs/faq.md', status: 'unchanged', origin: 'existing', optional: false, included: true, conflict: { replace: false } }],
  });
  await p.getByRole('button', { name: 'Use the template one' }).click();
  expect(await last(p)).toEqual({ type: 'replace', path: 'faq.md', replace: true });
  await p.getByRole('button', { name: '+ Page' }).click();
  await p.getByPlaceholder('Page name (guides/Name puts it in a folder)').fill('guias/Como publicar');
  await p.getByPlaceholder('Page name (guides/Name puts it in a folder)').press('Enter');
  expect(await last(p)).toEqual({ type: 'add', text: 'guias/Como publicar', by: 'path', template: undefined });
});
