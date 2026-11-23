import { FakeGitHub } from '../test/fakeGitHub';
import { centralExampleUrl, centralLabel, centralTemplates, fetchCentralTemplates, loadCentralTemplates, parseTemplatesRepository } from './centralTemplates';
import { GitHubClient } from './github';

const PAGE = '---\ntemplate:\n  name: Runbook da empresa\n  category: guide\n---\n\n# {{title}}\n\nDa empresa.\n';
const SITE = 'name: Serviço da plataforma\nfiles:\n  - path: index.md\n    title: Início\n    source: inicio.md\n';

const repo = () =>
  new FakeGitHub(
    {
      'README.md': '# Templates da empresa\n',
      'templates/runbook.md': PAGE,
      'templates/LEIAME.md': '# Sem bloco template\n',
      'templates/servico/template.yml': SITE,
      'templates/servico/inicio.md': '# {{site_name}}\n',
      'templates/servico/extra/fundo.md': '# Ainda cabe\n',
      'templates/en/sites/servico/extra/fundo.md': '# Fundo demais\n',
      'templates/logo.png': 'binário',
      'outra/runbook.md': PAGE,
    },
    'acme/docs-templates',
  );

/** Cliente do GitHub simulado, com o token do login ou sem nenhum (repositório público). */
const client = (github: FakeGitHub, token?: string) =>
  new GitHubClient({ baseUrl: 'https://api.github.com', fetch: github.fetch, headers: token ? { Authorization: `Bearer ${token}` } : {} }, github.slug);

describe('parseTemplatesRepository', () => {
  it('dono/repo, pasta, ref e host', () => {
    expect(parseTemplatesRepository('acme/docs-templates')).toEqual({ host: 'github.com', slug: 'acme/docs-templates', folder: '' });
    expect(parseTemplatesRepository(' acme/docs-templates/templates/v1@v3 ')).toEqual({ host: 'github.com', slug: 'acme/docs-templates', folder: 'templates/v1', ref: 'v3' });
    expect(parseTemplatesRepository('https://ghe.acme.com.br/plataforma/tpl/')).toEqual({ host: 'ghe.acme.com.br', slug: 'plataforma/tpl', folder: '' });
    expect(centralLabel(parseTemplatesRepository('ghe.acme.com.br/plataforma/tpl/docs@main')!)).toBe('ghe.acme.com.br/plataforma/tpl/docs');
    expect(centralLabel(parseTemplatesRepository('acme/tpl/docs')!)).toBe('acme/tpl/docs');
  });

  it('valores que não são um repositório', () => {
    for (const value of [undefined, '', 'acme', 'acme/tpl/../x', 'acme/tpl@', 'ac me/tpl']) expect(parseTemplatesRepository(value), String(value)).toBeUndefined();
  });
});

describe('fetchCentralTemplates', () => {
  it('só os arquivos de template da pasta, até três subpastas (idioma, sites, site), no commit da branch padrão', async () => {
    const github = repo();
    const result = await fetchCentralTemplates(client(github, github.token), parseTemplatesRepository('acme/docs-templates/templates')!);
    expect(result).not.toBe('unchanged');
    const { sha, files } = result as Exclude<typeof result, 'unchanged'>;
    expect(sha).toBe(github.head('main')!.sha);
    expect(Object.keys(files).sort()).toEqual(['LEIAME.md', 'runbook.md', 'servico/extra/fundo.md', 'servico/inicio.md', 'servico/template.yml']);
    expect(files['runbook.md']).toBe(PAGE);
  });

  it('o mesmo commit da cópia guardada: nada é baixado', async () => {
    const github = repo();
    const source = parseTemplatesRepository('acme/docs-templates/templates@main')!;
    expect(await fetchCentralTemplates(client(github, github.token), source, github.head('main')!.sha)).toBe('unchanged');
    expect(github.calls.filter(c => c.includes('/git/'))).toEqual([]);
  });

  it('ref que não existe é erro', async () => {
    const github = repo();
    await expect(fetchCentralTemplates(client(github, github.token), parseTemplatesRepository('acme/docs-templates@nada')!)).rejects.toThrow('not found');
  });
});

describe('loadCentralTemplates', () => {
  const source = parseTemplatesRepository('acme/docs-templates/templates')!;

  it('público: sem login', async () => {
    const github = repo();
    github.publicRepo = true;
    const asked: boolean[] = [];
    const { result, needsAuth } = await loadCentralTemplates({ source, needsAuth: false, client: withLogin => (asked.push(withLogin), client(github, withLogin ? github.token : undefined)) });
    expect(needsAuth).toBe(false);
    expect(asked).toEqual([false]);
    expect(result).not.toBe('unchanged');
  });

  it('privado: tenta sem login, depois com; da próxima vez vai direto com login', async () => {
    const github = repo();
    const asked: boolean[] = [];
    const make = (withLogin: boolean) => (asked.push(withLogin), client(github, withLogin ? github.token : undefined));
    expect((await loadCentralTemplates({ source, needsAuth: false, client: make })).needsAuth).toBe(true);
    expect(asked).toEqual([false, true]);
    asked.length = 0;
    await loadCentralTemplates({ source, needsAuth: true, client: make });
    expect(asked).toEqual([true]);
  });

  it('erro que não é de acesso não tenta com login', async () => {
    const github = repo();
    github.failNext('GET', /\/repos\/acme\/docs-templates$/, 500, 'Server error');
    const asked: boolean[] = [];
    await expect(loadCentralTemplates({ source, needsAuth: false, client: w => (asked.push(w), client(github, github.token)) })).rejects.toThrow('Server error');
    expect(asked).toEqual([false]);
  });
});

describe('centralTemplates', () => {
  it('páginas com bloco template e sites com template.yml, cada site com os próprios arquivos', () => {
    const { pages, sites } = centralTemplates({
      'runbook.md': PAGE,
      'LEIAME.md': '# Sem bloco\n',
      'servico/template.yml': SITE,
      'servico/inicio.md': '# {{site_name}}\n',
      'quebrado/template.yml': 'name: [\n',
    });
    expect(pages.map(p => `${p.id}:${p.name}`)).toEqual(['runbook:Runbook da empresa']);
    expect(sites.map(s => s.template.id)).toEqual(['servico']);
    expect(sites[0].files).toEqual({ 'template.yml': SITE, 'inicio.md': '# {{site_name}}\n' });
  });
});

describe('centralTemplates no formato do repositório de templates (spec 08, TR2)', () => {
  const page = (name: string, category?: string, example?: string) =>
    `---\ntemplate:\n  version: 1\n  name: ${name}\n  description: d\n${category ? `  category: ${category}\n` : ''}${example ? `  example: ${example}\n` : ''}---\n\n# {{title}}\n`;
  const files = {
    'en/how-to-guides/runbook.md': page('Runbook', 'guide', 'how-to-guides/runbook.md'),
    'en/tutorials/sem-categoria.md': page('Sem categoria'),
    'en/explanation/adr.md': page('ADR', 'explanation'),
    'en/sites/servico/template.yml': SITE,
    'en/sites/servico/inicio.md': '# {{site_name}}\n',
    'pt-br/how-to-guides/runbook.md': page('Runbook pt', 'guide'),
    'pt-br/sites/servico/template.yml': SITE,
  };

  it('usa a pasta do idioma; a categoria vem do front matter ou da pasta; o exemplo vem junto', () => {
    const { pages, sites } = centralTemplates(files, 'en');
    expect(pages.map(p => `${p.id}:${p.category}:${p.example ?? ''}`).sort()).toEqual([
      'adr:explanation:',
      'runbook:guide:how-to-guides/runbook.md',
      'sem-categoria:tutorial:',
    ]);
    expect(sites.map(s => s.template.id)).toEqual(['servico']);
    expect(sites[0].files).toEqual({ 'template.yml': SITE, 'inicio.md': '# {{site_name}}\n' });
  });

  it('pt-br usa a pasta pt-br; idioma sem pasta cai no en', () => {
    expect(centralTemplates(files, 'pt-br').pages.map(p => p.name)).toEqual(['Runbook pt']);
    expect(centralTemplates(files, 'es').pages.map(p => p.name).sort()).toEqual(['ADR', 'Runbook', 'Sem categoria']);
  });

  it('pasta sem idiomas vale para todos (o formato da TA3 continua valendo)', () => {
    expect(centralTemplates({ 'runbook.md': PAGE }, 'pt-br').pages.map(p => p.id)).toEqual(['runbook']);
  });
});


describe('centralExampleUrl (spec 08)', () => {
  it('examples/<idioma>/docs ao lado da pasta de templates, na ref configurada', () => {
    const source = parseTemplatesRepository('acme/docs-templates/templates@v2')!;
    expect(centralExampleUrl(source, 'pt-br', 'how-to-guides/runbook.md')).toBe(
      'https://github.com/acme/docs-templates/blob/v2/examples/pt-br/docs/how-to-guides/runbook.md',
    );
    expect(centralExampleUrl(parseTemplatesRepository('ghe.acme.com/acme/t')!, undefined, 'a.md')).toBe('https://ghe.acme.com/acme/t/blob/HEAD/examples/docs/a.md');
  });
});
