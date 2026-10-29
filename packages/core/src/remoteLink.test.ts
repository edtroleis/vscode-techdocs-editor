import { describe, expect, it } from 'vitest';
import { allowedHosts, parseRemoteInput, parseRemoteUri, remoteUriPath, safeRepoPath, validateOpenLink } from './remoteLink';

describe('safeRepoPath', () => {
  it('aceita caminho relativo dentro do repositório', () => {
    expect(safeRepoPath('docs/guias/index.md')).toBe('docs/guias/index.md');
    expect(safeRepoPath('README.md')).toBe('README.md');
  });

  it('recusa .., caminho absoluto, barra invertida, vazio e caracteres de controle', () => {
    for (const path of ['../segredo.md', 'docs/../../x.md', '/etc/passwd', 'docs\\x.md', '', 'docs//x.md', 'docs/./x.md', 'docs/x\n.md']) {
      expect(safeRepoPath(path), path).toBeUndefined();
    }
  });
});

describe('URI techdocs:', () => {
  it('ida e volta: host na autoridade, dono/repo e o caminho no path', () => {
    expect(remoteUriPath('acme/wiki', 'docs/index.md')).toBe('/acme/wiki/docs/index.md');
    expect(remoteUriPath('acme/wiki', '')).toBe('/acme/wiki');
    expect(parseRemoteUri('github.com', '/acme/wiki/docs/index.md')).toEqual({ host: 'github.com', slug: 'acme/wiki', path: 'docs/index.md' });
    expect(parseRemoteUri('GHE.Empresa', '/acme/wiki')).toEqual({ host: 'ghe.empresa', slug: 'acme/wiki', path: '' });
  });

  it('recusa URI sem dono/repo ou com caminho inseguro', () => {
    expect(parseRemoteUri('github.com', '/acme')).toBeUndefined();
    expect(parseRemoteUri('github.com', '/acme/wiki/../x.md')).toBeUndefined();
    expect(parseRemoteUri('', '/acme/wiki/x.md')).toBeUndefined();
  });
});

describe('parseRemoteInput (o que a pessoa digita no "Abrir documentação do GitHub…")', () => {
  it('dono/repo usa o host padrão', () => {
    expect(parseRemoteInput('acme/wiki')).toEqual({ host: 'github.com', slug: 'acme/wiki' });
    expect(parseRemoteInput('  acme/wiki  ', 'ghe.empresa')).toEqual({ host: 'ghe.empresa', slug: 'acme/wiki' });
  });

  it('URL do repositório, com .git e barra no fim', () => {
    expect(parseRemoteInput('https://github.com/acme/wiki')).toEqual({ host: 'github.com', slug: 'acme/wiki' });
    expect(parseRemoteInput('https://ghe.empresa/acme/wiki.git/')).toEqual({ host: 'ghe.empresa', slug: 'acme/wiki' });
    expect(parseRemoteInput('git@github.com:acme/wiki.git')).toEqual({ host: 'github.com', slug: 'acme/wiki' });
  });

  it('URL de um arquivo ou pasta: guarda o caminho (a branch fica de fora: vale o rascunho ou a principal)', () => {
    expect(parseRemoteInput('https://github.com/acme/wiki/blob/main/docs/guias/index.md')).toEqual({
      host: 'github.com',
      slug: 'acme/wiki',
      path: 'docs/guias/index.md',
    });
    expect(parseRemoteInput('https://github.com/acme/wiki/tree/main/servico/docs')).toEqual({
      host: 'github.com',
      slug: 'acme/wiki',
      path: 'servico/docs',
    });
  });

  it('recusa o que não é repositório', () => {
    for (const text of ['', 'wiki', 'https://github.com/acme', 'acme/wiki/extra', 'ftp://github.com/acme/wiki', 'acme/..']) {
      expect(parseRemoteInput(text), text).toBeUndefined();
    }
  });
});

describe('validateOpenLink (B1, B3)', () => {
  const hosts = ['github.com'];

  it('aceita host conhecido, dono/repo e caminho de página', () => {
    expect(validateOpenLink('host=github.com&repo=acme/wiki&path=docs/index.md', hosts)).toEqual({
      ok: true,
      target: { host: 'github.com', slug: 'acme/wiki', path: 'docs/index.md' },
    });
    expect(validateOpenLink('host=GitHub.com&repo=acme%2Fwiki&path=docs%2Fguias%2Fa.md', hosts)).toEqual({
      ok: true,
      target: { host: 'github.com', slug: 'acme/wiki', path: 'docs/guias/a.md' },
    });
  });

  it('recusa host fora da lista, repositório malformado e caminho inseguro ou que não é página', () => {
    const reasons = {
      'host=evil.example&repo=acme/wiki&path=docs/index.md': 'host',
      'repo=acme/wiki&path=docs/index.md': 'host',
      'host=github.com&repo=acme&path=docs/index.md': 'repo',
      'host=github.com&repo=acme/wi ki&path=docs/index.md': 'repo',
      'host=github.com&repo=../wiki&path=docs/index.md': 'repo',
      'host=github.com&repo=acme/wiki&path=../index.md': 'path',
      'host=github.com&repo=acme/wiki&path=docs/script.sh': 'path',
      'host=github.com&repo=acme/wiki': 'path',
    };
    for (const [query, reason] of Object.entries(reasons)) {
      expect(validateOpenLink(query, hosts), query).toEqual({ ok: false, reason });
    }
  });
});

describe('allowedHosts', () => {
  it('github.com sempre, mais o host da configuração, sem repetir', () => {
    expect(allowedHosts('github.com')).toEqual(['github.com']);
    expect(allowedHosts(' GHE.Empresa ')).toEqual(['github.com', 'ghe.empresa']);
    expect(allowedHosts(undefined)).toEqual(['github.com']);
  });
});
