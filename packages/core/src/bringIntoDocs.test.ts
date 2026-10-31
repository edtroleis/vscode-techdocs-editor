import { describe, expect, it } from 'vitest';
import { bringIntoDocs, mkdocsRepoUrl, repoFileUrl } from './bringIntoDocs';

const url = (path: string) => repoFileUrl('https://github.com/acme/api', 'main', path);

describe('bringIntoDocs', () => {
  it('links para o docs_dir ficam relativos à página nova', () => {
    const page = bringIntoDocs('Veja [o guia](docs/guia.md#topo) e ![x](./docs/img/a.png).\n', { from: 'README.md', to: 'docs/leia-me.md', docsDir: 'docs' });
    expect(page).toEqual({ text: 'Veja [o guia](guia.md#topo) e ![x](img/a.png).\n', images: [], asText: [], left: [] });
  });

  it('imagem de fora vira cópia em assets/, uma vez só, sem sobrescrever o que já existe', () => {
    const page = bringIntoDocs('![a](img/arq.png) ![b](<img/arq.png>) <img src="logo.svg">\n', {
      from: 'README.md',
      to: 'docs/guias/leia-me.md',
      docsDir: 'docs',
      taken: new Set(['docs/assets/logo.svg']),
    });
    expect(page.text).toBe('![a](../assets/arq.png) ![b](<../assets/arq.png>) <img src="../assets/logo-2.svg">\n');
    expect(page.images).toEqual([
      { from: 'img/arq.png', to: 'docs/assets/arq.png' },
      { from: 'logo.svg', to: 'docs/assets/logo-2.svg' },
    ]);
  });

  it('outro arquivo de fora vira o endereço no repositório', () => {
    const text = 'Código em [main](app/main.py#L3), ver [contribuir](CONTRIBUTING.md).\n\n[ref]: app/x.py\n';
    expect(bringIntoDocs(text, { from: 'README.md', to: 'docs/leia-me.md', docsDir: 'docs', fileUrl: url }).text).toBe(
      'Código em [main](https://github.com/acme/api/blob/main/app/main.py#L3), ver [contribuir](https://github.com/acme/api/blob/main/CONTRIBUTING.md).\n\n[ref]: https://github.com/acme/api/blob/main/app/x.py\n',
    );
  });

  it('sem endereço do repositório, o link para fora vira texto com o caminho (o build --strict do MkDocs aborta com ele)', () => {
    const text = 'Código em [main](app/main.py#L3), ver [contribuir](<CONTRIBUTING.md> "Como contribuir") e ![d](docs/d.png).\n\n[ref]: app/x.py\n';
    const page = bringIntoDocs(text, { from: 'README.md', to: 'docs/leia-me.md', docsDir: 'docs' });
    expect(page.text).toBe('Código em main (`app/main.py`), ver contribuir (`CONTRIBUTING.md`) e ![d](d.png).\n\n[ref]: ../app/x.py\n');
    expect(page.asText).toEqual(['app/main.py', 'CONTRIBUTING.md']);
    // A definição de referência não tem texto para ficar no lugar: relativa, e listada
    expect(page.left).toEqual(['app/x.py']);
  });

  it('site numa subpasta: caminhos do repositório, README da subpasta', () => {
    const page = bringIntoDocs('[api](app/main.py) ![d](docs/d.png) ![r](../../logo.png)\n', {
      from: 'servicos/pag/README.md',
      to: 'servicos/pag/docs/index.md',
      docsDir: 'servicos/pag/docs',
      fileUrl: url,
    });
    expect(page.text).toBe('[api](https://github.com/acme/api/blob/main/servicos/pag/app/main.py) ![d](d.png) ![r](assets/logo.png)\n');
    expect(page.images).toEqual([{ from: 'logo.png', to: 'servicos/pag/docs/assets/logo.png' }]);
  });

  it('endereços, âncoras e caminhos absolutos ficam como estão', () => {
    const text = '[a](https://x.dev) [b](#topo) [c](/raiz) [d](mailto:a@b.c)\n';
    expect(bringIntoDocs(text, { from: 'README.md', to: 'docs/x.md', docsDir: 'docs', fileUrl: url }).text).toBe(text);
  });
});

describe('repoFileUrl e mkdocsRepoUrl', () => {
  it('monta o endereço do arquivo e lê o repo_url', () => {
    expect(repoFileUrl('https://github.com/acme/api.git/', 'dev', 'docs/a b.md')).toBe('https://github.com/acme/api/blob/dev/docs/a%20b.md');
    expect(mkdocsRepoUrl('site_name: X\nrepo_url: "https://github.com/acme/api"\n')).toBe('https://github.com/acme/api');
    expect(mkdocsRepoUrl('repo_url: git@github.com:acme/api.git\n')).toBeUndefined();
    expect(mkdocsRepoUrl(undefined)).toBeUndefined();
  });
});
