#!/usr/bin/env node
// Vitrine no Backstage (spec 03, "Vitrine no Backstage"): publica no Backstage local todos os templates de página, os
// templates de site e os exemplos, nas duas línguas, e todos os diagramas Mermaid (galeria do editor e exemplos do
// mermaid.js.org); depois abre cada página no Backstage, como uma pessoa, e confere o que aparece. No fim, o relatório
// com a captura de cada página, o que deu errado e as sugestões. Só roda quando pedido: npm run test:backstage
//
//   npm run test:backstage                       tudo
//   npm run test:backstage -- --only mermaid     só as docs cujo nome tem "mermaid" (conferência e publicação)
//   npm run test:backstage -- --skip-publish     só confere o que já está publicado
//   npm run test:backstage -- --skip-validate    sem validar na extensão as docs do catálogo
//   npm run test:backstage -- --skip-edit-publish  sem publicar as docs do catálogo salvas pelo editor
//   BACKSTAGE_DIR=~/outro/backstage ...          o Backstage local (padrão ~/code/backstage, com o backstage.sh)
//
// Cada passo tem limite de tempo; passou, para e diz onde. O relatório fica em
// node_modules/.cache/backstage-showcase/report/index.html (no WSL, copiado para C:\Users\Public e aberto).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { crawl } from './crawl.mjs';
import { editorRoundtrip } from './editorRoundtrip.mjs';
import { writeReport } from './report.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CACHE = join(ROOT, 'node_modules', '.cache', 'backstage-showcase');
const REPO = join(CACHE, 'repo');
const BACKSTAGE = resolve(process.env.BACKSTAGE_DIR ?? join(homedir(), 'code', 'backstage'));
const APP = join(BACKSTAGE, 'app');
const EXTRA_CONFIG = 'app-config.showcase.local.yaml';
const BACKEND = 'http://localhost:7007';
const FRONTEND = 'http://localhost:3000';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const skipPublish = args.includes('--skip-publish');
const skipValidate = args.includes('--skip-validate');
const skipEditPublish = args.includes('--skip-edit-publish');

const started = Date.now();
const elapsed = since => `${((Date.now() - since) / 1000).toFixed(0)} s`;
const log = message => console.log(`[${elapsed(started).padStart(5)}] ${message}`);

/** Roda um comando com limite de tempo; passou do limite, mata o grupo inteiro e falha dizendo qual. */
function run(command, argv, { limit, cwd = ROOT, env, quiet = true, input = 'ignore' } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, detached: true, stdio: [input, 'pipe', 'pipe'] });
    let output = '';
    const keep = chunk => {
      output = (output + chunk).slice(-20_000);
      if (!quiet) process.stdout.write(chunk);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
      reject(new Error(`${command} ${argv.join(' ').slice(0, 120)} passou de ${limit} s e foi interrompido\n${output.slice(-2000)}`));
    }, limit * 1000);
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${command} ${argv.join(' ').slice(0, 120)} saiu com ${code}\n${output.slice(-3000)}`));
    });
  });
}

async function step(name, fn) {
  const at = Date.now();
  log(`▶ ${name}`);
  const result = await fn();
  log(`✔ ${name} (${elapsed(at)})`);
  return result;
}

async function token() {
  const response = await fetch(`${BACKEND}/api/auth/guest/refresh`, { signal: AbortSignal.timeout(10_000) });
  return (await response.json()).backstageIdentity.token;
}

/** A entidade já está no catálogo? (undefined: o Backstage não respondeu) */
async function inCatalog(name) {
  try {
    const response = await fetch(`${BACKEND}/api/catalog/entities/by-name/component/default/${name}`, {
      headers: { Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return undefined;
  }
}

async function until(check, { limit, every = 5, what }) {
  const end = Date.now() + limit * 1000;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`${what}: esperou ${limit} s`);
    await new Promise(r => setTimeout(r, every * 1000));
  }
}

/** Todas as entidades do catálogo com TechDocs (as da vitrine também), com o nome, o título e a location. */
async function techdocsEntities() {
  const items = [];
  let cursor;
  do {
    const query = cursor ? `cursor=${encodeURIComponent(cursor)}` : 'filter=metadata.annotations.backstage.io/techdocs-ref&limit=200';
    const response = await fetch(`${BACKEND}/api/catalog/entities/by-query?${query}`, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(30_000) });
    const page = await response.json();
    items.push(...page.items);
    cursor = page.pageInfo?.nextCursor;
  } while (cursor);
  return items;
}

/**
 * O diretório do site de cada entidade: a location (url do GitHub → o clone em repos/ do Backstage; file → o
 * arquivo) e o `backstage.io/techdocs-ref: dir:…` relativo a ela.
 */
function sourceOf(entity) {
  const annotations = entity.metadata.annotations ?? {};
  const ref = annotations['backstage.io/techdocs-ref'] ?? '';
  const location = annotations['backstage.io/managed-by-location'] ?? '';
  if (!ref.startsWith('dir:')) return { reason: `techdocs-ref "${ref}" não é dir: (a extensão só edita sites no repositório)` };
  let locationDir;
  let repo;
  const github = /^url:https:\/\/github\.com\/[^/]+\/([^/]+)\/(?:blob|tree)\/[^/]+\/(.*)$/.exec(location);
  if (github) {
    repo = join(BACKSTAGE, 'repos', github[1]);
    locationDir = join(repo, github[2].split('/').slice(0, -1).join('/'));
  } else if (location.startsWith('file:')) {
    locationDir = resolve(join(APP, 'packages', 'backend'), location.slice('file:'.length), '..');
    repo = locationDir;
  } else return { reason: `location "${location}" não suportada` };
  if (!existsSync(repo)) return { reason: `o repositório não está em ${repo} (o backstage.sh start clona os de scripts/repos.txt)` };
  const site = resolve(locationDir, ref.slice('dir:'.length));
  if (!existsSync(join(site, 'mkdocs.yml')) && !existsSync(join(site, 'mkdocs.yaml'))) return { reason: `sem mkdocs.yml em ${site}` };
  return { repo, site };
}

/** "Conferir a documentação" e a ida e volta no editor visual, com o código da extensão, em todas as docs do catálogo. */
async function validateCatalog() {
  const catalog = await techdocsEntities();
  log(`  ${catalog.length} docs no catálogo`);
  const extensionRoot = join(ROOT, 'packages', 'extension');
  if (!existsSync(join(extensionRoot, 'dist', 'webview', 'main.js'))) await run('npm', ['run', '-s', 'build'], { limit: 300 });
  await run('npx', ['esbuild', 'scripts/backstage-showcase/check.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${join(CACHE, 'check.cjs')}`, '--log-level=warning'], { limit: 120 });
  const docs = catalog.map(e => ({ name: e.metadata.name, title: e.metadata.title ?? e.metadata.name, showcase: e.metadata.name.startsWith('showcase-'), ...sourceOf(e) }));
  const checkable = docs.filter(d => d.site);
  writeFileSync(join(CACHE, 'check-input.json'), JSON.stringify(checkable.map(({ name, repo, site }) => ({ name, repo, site }))));
  await run('node', [join(CACHE, 'check.cjs'), join(CACHE, 'check-input.json'), join(CACHE, 'check-output.json')], { limit: 300 });
  const checked = JSON.parse(readFileSync(join(CACHE, 'check-output.json'), 'utf8'));
  const markdown = dir => (existsSync(dir) ? readdirRecursive(dir).filter(p => p.endsWith('.md')) : []);
  const files = checked.flatMap(c => markdown(c.docsDir ?? '').map(path => ({ key: `${c.name}::${relative(c.docsDir, path)}`, path })));
  log(`  ${checkable.length} sites conferidos; ida e volta de ${files.length} páginas no editor visual`);
  const roundtrip = await editorRoundtrip({ extensionRoot, files, limit: 1200 });
  // O que mudou no texto muda o que o Backstage mostra? O HTML do MkDocs, com o mkdocs.yml do site, dos dois
  const changed = Object.entries(roundtrip).filter(([, r]) => r.saved !== undefined);
  if (changed.length) {
    const sites = Object.fromEntries(checked.map(c => [c.name, c.site]));
    writeFileSync(join(CACHE, 'render-input.json'), JSON.stringify(changed.map(([key, r]) => ({ key, site: sites[key.split('::')[0]], original: r.original, saved: r.saved }))));
    await run('bash', ['-c', `source .venv/bin/activate && python3 "$1" "$2" "$3"`, 'render', join(ROOT, 'scripts', 'backstage-showcase', 'render_compare.py'), join(CACHE, 'render-input.json'), join(CACHE, 'render-output.json')], { cwd: BACKSTAGE, limit: 300 });
    const rendered = JSON.parse(readFileSync(join(CACHE, 'render-output.json'), 'utf8'));
    for (const [key, r] of changed) {
      Object.assign(r, rendered[key]);
      savedByEditor.set(key, r.saved);
      delete r.original;
      delete r.saved;
    }
    log(`  ${changed.length} páginas mudam no texto; ${changed.filter(([, r]) => r.sameHtml === false).length} mudam no Backstage`);
  }
  return docs.map(d => {
    const c = checked.find(x => x.name === d.name);
    const pages = Object.entries(roundtrip)
      .filter(([key]) => key.startsWith(`${d.name}::`))
      .map(([key, r]) => ({ page: key.slice(d.name.length + 2), ...r }));
    return { ...d, ...(c ?? {}), roundtrip: pages };
  });
}

/** O texto que o editor gravaria, por `doc::página`, das páginas que ele muda (as outras ficam como estão). */
const savedByEditor = new Map();

/** Cópia do site (sem .git e sem o site gerado), com as páginas como o editor gravaria se `edited`. */
function siteCopy(doc, edited) {
  const target = join(CACHE, edited ? 'edited' : 'original', doc.name);
  rmSync(target, { recursive: true, force: true });
  cpSync(doc.site, target, { recursive: true, filter: source => !/^(\.git|site|node_modules)$/.test(relative(doc.site, source)) });
  if (edited) {
    const docsDir = join(target, relative(doc.site, doc.docsDir));
    for (const [key, text] of savedByEditor) {
      const [name, page] = key.split('::');
      if (name === doc.name) writeFileSync(join(docsDir, page), text);
    }
  }
  return target;
}

/** Gera o site com o techdocs-cli e publica no Azurite do portal, para a entidade `name`. */
const publishSite = (source, name) =>
  run(
    'bash',
    [
      '-c',
      `${backstageEnv} && out="$(mktemp -d)" && npx -y @techdocs/cli@1.13.0 generate --no-docker --source-dir "$1" --output-dir "$out" </dev/null && node scripts/techdocs-azure-publish.cjs "$out" "default/component/$2" </dev/null; status=$?; rm -rf "$out"; exit $status`,
      'publish',
      source,
      name,
    ],
    { cwd: BACKSTAGE, limit: 300 },
  );

/** As páginas de um site, para a conferência: o caminho, o título (o primeiro #) e quantos diagramas. */
function sitePages(doc) {
  return readdirRecursive(doc.docsDir)
    .filter(p => p.endsWith('.md'))
    .map(p => {
      const text = readFileSync(p, 'utf8');
      return {
        path: relative(doc.docsDir, p).split('\\').join('/'),
        title: /^#\s+(.+)$/m.exec(text)?.[1] ?? relative(doc.docsDir, p),
        mermaid: (text.match(/^\s*```mermaid\s*$/gm) ?? []).length,
      };
    });
}

/**
 * As docs do catálogo editadas no editor e publicadas (spec 03): publica cada uma como está (de uma cópia limpa),
 * abre as páginas no Backstage, publica como o editor gravaria, abre de novo e compara o que a pessoa vê. No fim,
 * publica de novo o original do repositório, mesmo se algo falhar no meio.
 */
async function editAndPublish(validation) {
  const docs = validation.filter(v => !v.showcase && v.site && v.docsDir && !v.failure).map(v => ({ ...v, pages: sitePages(v) }));
  const edited = docs.filter(d => [...savedByEditor.keys()].some(k => k.startsWith(`${d.name}::`)));
  log(`  ${docs.length} docs; o editor muda o arquivo de ${edited.length}`);
  const out = join(CACHE, 'report');
  const queue = async (items, fn) => {
    const list = [...items];
    await Promise.all(Array.from({ length: 4 }, async () => { for (let item; (item = list.shift()); ) await fn(item); }));
  };
  try {
    await queue(edited, d => publishSite(siteCopy(d, false), d.name));
    const before = await crawl({ frontend: FRONTEND, entities: edited, out, log, limit: 1200, shots: 'antes' });
    await queue(edited, d => publishSite(siteCopy(d, true), d.name));
    const after = await crawl({ frontend: FRONTEND, entities: edited, out, log, limit: 1200, shots: 'depois' });
    return edited.flatMap(d =>
      d.pages.map(page => {
        const a = before.find(r => r.entity === d.name && r.path === page.path);
        const b = after.find(r => r.entity === d.name && r.path === page.path);
        const changedFile = savedByEditor.has(`${d.name}::${page.path}`);
        const shape = Object.keys(a?.shape ?? {}).filter(k => a.shape[k] !== b?.shape?.[k]).map(k => `${k}: ${a.shape[k]} → ${b?.shape?.[k]}`);
        const i = a?.text && b?.text ? [...a.text].findIndex((c, n) => c !== b.text[n]) : -1;
        const textDiff = a?.text !== b?.text ? { before: a?.text?.slice(Math.max(0, i - 60), i + 120), after: b?.text?.slice(Math.max(0, i - 60), i + 120) } : undefined;
        return { doc: d.name, title: d.title, page: page.path, url: a?.url ?? b?.url, changedFile, same: !shape.length && !textDiff && !a?.failure && !b?.failure, shape, textDiff, failure: a?.failure ?? b?.failure, before: a?.shot, after: b?.shot };
      }),
    );
  } finally {
    // O Backstage volta a mostrar o que está no repositório
    await queue(edited, d => publishSite(d.site, d.name)).catch(error => log(`  ✖ não deu para publicar de novo o original: ${error.message}`));
    log('  originais publicados de novo');
  }
}

const readdirRecursive = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? readdirRecursive(path) : [path];
  });

const backstageEnv = 'source .venv/bin/activate && source "$HOME/.nvm/nvm.sh" >/dev/null && nvm use 24 >/dev/null && eval "$(scripts/azurite.sh env)"';

try {
  if (!existsSync(join(BACKSTAGE, 'backstage.sh'))) throw new Error(`Backstage local não encontrado em ${BACKSTAGE} (BACKSTAGE_DIR)`);

  const manifest = await step('Gerar as docs (templates, sites, exemplos e diagramas)', async () => {
    mkdirSync(CACHE, { recursive: true });
    await run('npx', ['esbuild', 'scripts/backstage-showcase/generate.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${join(CACHE, 'generate.cjs')}`, '--log-level=warning'], { limit: 120 });
    log(`  ${(await run('node', [join(CACHE, 'generate.cjs'), REPO], { limit: 60 })).trim()}`);
    return JSON.parse(readFileSync(join(REPO, 'manifest.json'), 'utf8'));
  });
  const entities = manifest.entities.filter(e => !only || e.name.includes(only));
  if (!entities.length) throw new Error(`nenhuma doc com "${only}" no nome`);

  await step('Backstage com a location da vitrine', async () => {
    // As locations do app-config.yaml e a da vitrine: um app-config a mais troca a lista inteira, não junta
    const base = parse(readFileSync(join(APP, 'app-config.yaml'), 'utf8'));
    const locations = [...(base.catalog?.locations ?? []), { type: 'file', target: join(REPO, 'catalog-info.yaml') }];
    const config = `# Gerado pela vitrine da extensão TechDocs Editor (scripts/backstage-showcase/run.mjs). Pode apagar.\n${stringify({ catalog: { locations } }, { lineWidth: 0 })}`;
    const path = join(APP, EXTRA_CONFIG);
    const changed = !existsSync(path) || readFileSync(path, 'utf8') !== config;
    writeFileSync(path, config);
    const present = await inCatalog(manifest.entities[0].name);
    if (present && !changed) return log('  já rodando com a vitrine');
    if (present === undefined) log('  Backstage parado: subindo com a vitrine');
    else {
      log('  reiniciando o Backstage com a vitrine (a location é lida na subida)');
      await run('./backstage.sh', ['stop'], { cwd: BACKSTAGE, limit: 120 });
    }
    await run('./backstage.sh', ['start'], { cwd: BACKSTAGE, limit: 900, env: { BACKSTAGE_EXTRA_CONFIG: EXTRA_CONFIG } });
    log('  Backstage pronto; esperando o catálogo ler as docs da vitrine');
  });
  await step('Catálogo com as docs da vitrine', () =>
    until(async () => (await Promise.all(entities.map(e => inCatalog(e.name)))).every(Boolean), { limit: 300, what: 'o catálogo não leu as docs da vitrine' }),
  );

  if (!skipPublish)
    await step(`Publicar ${entities.length} docs no Backstage (techdocs-cli e o Azurite do portal)`, async () => {
      rmSync(join(CACHE, 'sites'), { recursive: true, force: true });
      const queue = [...entities];
      const worker = async () => {
        for (let entity; (entity = queue.shift()); ) {
          const site = join(CACHE, 'sites', entity.name);
          const at = Date.now();
          await run(
            'bash',
            [
              '-c',
              `${backstageEnv} && npx -y @techdocs/cli@1.13.0 generate --no-docker --source-dir "$1" --output-dir "$2" </dev/null && node scripts/techdocs-azure-publish.cjs "$2" "default/component/$3" </dev/null`,
              'publish',
              join(REPO, entity.dir),
              site,
              entity.name,
            ],
            { cwd: BACKSTAGE, limit: 240 },
          );
          log(`  ${entity.name} (${elapsed(at)})`);
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    });

  const results = await step(`Conferir ${entities.reduce((n, e) => n + e.pages.length, 0)} páginas no Backstage`, () =>
    crawl({ frontend: FRONTEND, entities, out: join(CACHE, 'report'), log, limit: 1800 }),
  );

  const validation = skipValidate ? undefined : await step('Validar na extensão todas as docs do catálogo do Backstage', () => validateCatalog());

  const editedPublished =
    validation && !skipEditPublish ? await step('Publicar as docs do catálogo como o editor gravaria e comparar no Backstage', () => editAndPublish(validation)) : undefined;

  const report = await step('Relatório', () =>
    writeReport({ out: join(CACHE, 'report'), manifest, entities, results, validation, editedPublished, frontend: FRONTEND, elapsed: elapsed(started) }),
  );
  log(`Relatório: ${report.path}`);
  log(`Páginas: ${report.pages} · com problema: ${report.withProblems} · diagramas: ${report.diagrams.ok}/${report.diagrams.expected} desenhados, ${report.diagrams.errors} com erro`);

  // No WSL, abre no navegador do Windows
  if (existsSync('/mnt/c/Users/Public')) {
    const target = '/mnt/c/Users/Public/techdocs-backstage';
    rmSync(target, { recursive: true, force: true });
    cpSync(join(CACHE, 'report'), target, { recursive: true });
    spawnSync('cmd.exe', ['/c', 'start', '', 'C:\\Users\\Public\\techdocs-backstage\\index.html'], { cwd: '/mnt/c', stdio: 'ignore', timeout: 10_000 });
    log('Aberto no navegador: C:\\Users\\Public\\techdocs-backstage\\index.html');
  }
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  process.exitCode = 1;
}
