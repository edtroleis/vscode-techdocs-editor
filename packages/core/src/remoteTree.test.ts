import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient } from './github';
import { entryAt, listDir, loadRepoFiles, siteOfPath } from './remoteTree';

const FILES = {
  'mkdocs.yml': 'site_name: Wiki\n',
  'docs/index.md': '# Início\n',
  'docs/guias/deploy.md': '# Deploy\n',
  'docs/assets/logo.png': 'png',
  'servico/mkdocs.yml': 'site_name: Pagamentos\ndocs_dir: paginas\n',
  'servico/paginas/index.md': '# Pagamentos\n',
};

const client = (github: FakeGitHub) =>
  new GitHubClient({ baseUrl: 'https://api.github.com', fetch: github.fetch, headers: { Authorization: `Bearer ${github.token}` } }, github.slug);

describe('loadRepoFiles', () => {
  it('os arquivos do commit da ref, com SHA; ref que não existe: nenhum', async () => {
    const github = new FakeGitHub(FILES);
    const files = await loadRepoFiles(client(github), 'main');
    expect(files.map(f => f.path).sort()).toEqual(Object.keys(FILES).sort());
    expect(files.every(f => f.sha)).toBe(true);
    expect(await loadRepoFiles(client(github), 'nao-existe')).toEqual([]);
  });

  it('getBlobBytes devolve os bytes do arquivo (imagens)', async () => {
    const github = new FakeGitHub(FILES);
    const files = await loadRepoFiles(client(github), 'main');
    const logo = files.find(f => f.path === 'docs/assets/logo.png')!;
    expect(new TextDecoder().decode(await client(github).getBlobBytes(logo.sha))).toBe('png');
  });
});

describe('entryAt e listDir', () => {
  const files = Object.keys(FILES).map((path, i) => ({ path, sha: `sha${i}`, size: FILES[path as keyof typeof FILES].length }));

  it('arquivo, pasta (a raiz também) ou nada', () => {
    expect(entryAt(files, 'docs/index.md')).toEqual({ type: 'file', sha: 'sha1', size: 9 });
    expect(entryAt(files, 'docs/guias')).toEqual({ type: 'dir' });
    expect(entryAt(files, '')).toEqual({ type: 'dir' });
    expect(entryAt(files, 'docs/gui')).toBeUndefined();
    expect(entryAt(files, 'nada.md')).toBeUndefined();
  });

  it('o conteúdo de uma pasta, pastas antes, uma vez cada', () => {
    expect(listDir(files, 'docs')).toEqual([
      ['assets', 'dir'],
      ['guias', 'dir'],
      ['index.md', 'file'],
    ]);
    expect(listDir(files, '')).toEqual([
      ['docs', 'dir'],
      ['servico', 'dir'],
      ['mkdocs.yml', 'file'],
    ]);
    expect(listDir(files, 'nada')).toEqual([]);
  });
});

describe('siteOfPath', () => {
  const sites = [
    { root: '', docsDir: 'docs', name: 'Wiki', yml: '' },
    { root: 'servico', docsDir: 'servico/paginas', name: 'Pagamentos', yml: '' },
    { root: 'docs/interno', docsDir: 'docs/interno/docs', name: 'Interno', yml: '' },
  ];

  it('o site cujo docs_dir tem a página; com sites aninhados, o mais interno', () => {
    expect(siteOfPath(sites, 'docs/index.md')?.name).toBe('Wiki');
    expect(siteOfPath(sites, 'servico/paginas/index.md')?.name).toBe('Pagamentos');
    expect(siteOfPath(sites, 'docs/interno/docs/a.md')?.name).toBe('Interno');
    expect(siteOfPath(sites, 'README.md')).toBeUndefined();
    expect(siteOfPath(sites, 'docsx/a.md')).toBeUndefined();
  });
});
