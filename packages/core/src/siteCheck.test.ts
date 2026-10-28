import { checkSite, pageRefs, SiteFinding, SiteSnapshot } from './siteCheck';

const MKDOCS = `# Site do time
site_name: Pagamentos
nav:
  - Início: index.md
  - Guias:
      - guias/deploy.md
      - guias/sumiu.md # removida
plugins:
  - search
`;

const CATALOG = `apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: plataforma
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: pagamentos # o serviço
  annotations:
    github.com/project-slug: org/pagamentos
spec:
  owner: time-pag
`;

const site = (over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  root: 'svc',
  mkdocsFile: 'svc/mkdocs.yml',
  mkdocsYml: MKDOCS,
  docsDir: 'svc/docs',
  docsDirExists: true,
  files: ['index.md', 'guias/deploy.md', 'fora.md', 'assets/logo.png'],
  pages: {
    'index.md': '# Pagamentos\n\n![Logo](assets/logo.png)\n\nVeja o [deploy](guias/deploy.md#passos).\n',
    'guias/deploy.md': '# Deploy\n\n[Início](../index.md) e [falta](../nada.md).\n\n![](../assets/sem.png)\n',
    'fora.md': '# Fora do nav\n',
  },
  lintConfigFile: '.markdownlint.yaml',
  lintConfig: { default: true },
  catalog: { file: 'catalog-info.yaml', text: CATALOG },
  ...over,
});

const codes = (findings: SiteFinding[]) => findings.map(f => `${f.code}${f.target ? `:${f.target}` : ''}`);
const fixOf = (findings: SiteFinding[], code: string) => findings.find(f => f.code === code)!.fix!;

describe('checkSite', () => {
  it('nav, páginas fora do nav, links e imagens, plugin e catalog-info.yaml', () => {
    const findings = checkSite(site());
    expect(codes(findings)).toEqual([
      'techdocs-plugin-missing',
      'nav-page-missing:guias/sumiu.md',
      'broken-link:../nada.md',
      'missing-image:../assets/sem.png',
      'page-not-in-nav:fora.md',
      'lint-problems:1',
      'catalog-ref-missing:backstage.io/techdocs-ref: dir:./svc',
    ]);
    expect(findings.find(f => f.code === 'nav-page-missing')).toMatchObject({ file: 'svc/mkdocs.yml', line: 7 });
    expect(findings.find(f => f.code === 'broken-link')).toMatchObject({ file: 'svc/docs/guias/deploy.md', line: 3 });
    expect(findings.find(f => f.code === 'techdocs-plugin-missing')).toMatchObject({ line: 8 });
    expect(findings.find(f => f.code === 'catalog-ref-missing')).toMatchObject({ file: 'catalog-info.yaml', line: 3 });
    expect(findings.find(f => f.code === 'broken-link')!.fix).toBeUndefined();
    // A imagem sem texto alternativo (MD045) não se corrige sozinha
    expect(findings.find(f => f.code === 'lint-problems')).toMatchObject({ file: 'svc/docs/guias/deploy.md', line: 5 });
    expect(findings.find(f => f.code === 'lint-problems')!.fix).toBeUndefined();
  });

  it('as correções do mkdocs.yml se somam e mantêm comentários', () => {
    const findings = checkSite(site());
    let yml = MKDOCS;
    for (const code of ['techdocs-plugin-missing', 'page-not-in-nav']) yml = fixOf(findings, code).apply(yml);
    expect(yml).toBe(MKDOCS.replace('  - search\n', '  - techdocs-core\n  - search\n').replace('# removida\n', '# removida\n  - Fora do nav: fora.md\n'));
    // Aplicar de novo não muda nada
    expect(fixOf(findings, 'techdocs-plugin-missing').apply(yml)).toBe(yml);
    expect(fixOf(findings, 'nav-page-missing')).toMatchObject({ file: 'svc/docs/guias/sumiu.md' });
    expect(fixOf(findings, 'nav-page-missing').apply(undefined)).toBe('# Sumiu\n');
    expect(fixOf(findings, 'nav-page-missing').apply('# Já existe\n')).toBe('# Já existe\n');
  });

  it('plugins: sem a chave, em lista na mesma linha, ou o techdocs-core com opções', () => {
    const without = 'site_name: X\n';
    expect(fixOf(checkSite(site({ mkdocsYml: without })), 'techdocs-plugin-missing').apply(without)).toBe('site_name: X\nplugins:\n  - techdocs-core\n');
    const flow = 'site_name: X\nplugins: [search]\n';
    expect(fixOf(checkSite(site({ mkdocsYml: flow })), 'techdocs-plugin-missing').apply(flow)).toBe('site_name: X\nplugins: [ techdocs-core, search ]\n');
    const options = 'site_name: X\nplugins:\n  - techdocs-core:\n      use_material_search: true\n';
    expect(codes(checkSite(site({ mkdocsYml: options })))).not.toContain('techdocs-plugin-missing');
  });

  it('sem site_name: a primeira linha depois dos comentários, com o nome da pasta', () => {
    const yml = '# comentário\nnav:\n  - index.md\nplugins:\n  - techdocs-core\n';
    const findings = checkSite(site({ mkdocsYml: yml, root: 'servico-pagamentos' }));
    expect(codes(findings)[0]).toBe('site-name-missing');
    expect(fixOf(findings, 'site-name-missing').apply(yml)).toBe('# comentário\nsite_name: Servico pagamentos\nnav:\n  - index.md\nplugins:\n  - techdocs-core\n');
  });

  it('sem docs_dir: só o achado da pasta, com a correção que cria o index.md', () => {
    const findings = checkSite(site({ docsDirExists: false, files: [], pages: {} }));
    expect(codes(findings)).toContain('docs-dir-missing:svc/docs');
    expect(codes(findings)).not.toContain('index-missing:index.md');
    expect(fixOf(findings, 'docs-dir-missing')).toMatchObject({ file: 'svc/docs/index.md' });
    expect(fixOf(findings, 'docs-dir-missing').apply(undefined)).toBe('# Pagamentos\n');
  });

  it('sem index.md, sem catalog-info.yaml e sem regras do lint', () => {
    const findings = checkSite(
      site({ mkdocsYml: 'site_name: X\nplugins:\n  - techdocs-core\n', files: ['a.md'], pages: { 'a.md': '# A\n' }, catalog: undefined, lintConfigFile: undefined }),
    );
    expect(codes(findings)).toEqual(['index-missing:index.md', 'catalog-missing:catalog-info.yaml', 'lint-config-missing:.markdownlint.yaml']);
    expect(fixOf(findings, 'lint-config-missing')).toMatchObject({ file: '.markdownlint.yaml' });
    expect(fixOf(findings, 'lint-config-missing').apply(undefined)).toContain('default: true');
    expect(findings.find(f => f.code === 'catalog-missing')!.fix).toBeUndefined();
  });

  it('anotação no componente: na lista de annotations, ou com annotations novo', () => {
    const fix = fixOf(checkSite(site()), 'catalog-ref-missing');
    expect(fix.apply(CATALOG)).toBe(CATALOG.replace('  annotations:\n', '  annotations:\n    backstage.io/techdocs-ref: dir:./svc\n'));
    const plain = 'kind: Component\nmetadata:\n  name: x\nspec:\n  owner: y\n';
    const fixPlain = fixOf(checkSite(site({ root: '', catalog: { file: 'catalog-info.yaml', text: plain } })), 'catalog-ref-missing');
    expect(fixPlain.apply(plain)).toBe('kind: Component\nmetadata:\n  annotations:\n    backstage.io/techdocs-ref: dir:.\n  name: x\nspec:\n  owner: y\n');
    expect(codes(checkSite(site({ catalog: { file: 'catalog-info.yaml', text: fix.apply(CATALOG) } })))).not.toContain('catalog-ref-missing:backstage.io/techdocs-ref: dir:./svc');
  });

  it('lint: um achado por página com o total, com correção só se algo se corrige sozinho', () => {
    const pages = { 'index.md': '# A\n\n```\ncódigo\n```\n', 'b.md': '# B\ntexto\n' };
    const findings = checkSite(site({ mkdocsYml: 'site_name: X\nplugins:\n  - techdocs-core\n', files: Object.keys(pages), pages }));
    const lint = findings.filter(f => f.code === 'lint-problems');
    expect(lint.map(f => `${f.file}:${f.target}:${Boolean(f.fix)}`)).toEqual(['svc/docs/b.md:1:true', 'svc/docs/index.md:1:false']);
    expect(lint[0].fix!.apply(pages['b.md'])).toBe('# B\n\ntexto\n');
    expect(codes(checkSite(site({ lintConfig: undefined, files: Object.keys(pages), pages })))).not.toContain('lint-problems:1');
  });
});

describe('pageRefs', () => {
  it('links e imagens fora de código; sem URLs, âncoras e caminhos absolutos', () => {
    const md = [
      '[a](a.md) ![b](img/b.png "título") [c](<c d.md>)',
      '`[x](codigo.md)` [web](https://x.y) [ancora](#sec) [abs](/raiz.md) [mail](mailto:a@b)',
      '```',
      '[dentro](bloco.md)',
      '```',
      '[ref]: refs/r.md',
      '    [indentado](codigo.md)',
    ].join('\n');
    expect(pageRefs(md)).toEqual([
      { target: 'a.md', image: false, line: 1 },
      { target: 'img/b.png', image: true, line: 1 },
      { target: 'c d.md', image: false, line: 1 },
      { target: 'refs/r.md', image: false, line: 6 },
    ]);
  });
});
