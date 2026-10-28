import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

/** Textos passados a `vscode.l10n.t(...)` no código da extensão (o primeiro argumento, literal). */
function sourceTexts(): Set<string> {
  const texts = new Set<string>();
  const files = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' }).filter(
    f => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  for (const file of files) {
    const source = readFileSync(join(root, 'src', file), 'utf8');
    for (const match of source.matchAll(/l10n\.t\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs)) {
      texts.add(match[2].replace(/\\(['"`\\])/g, '$1'));
    }
  }
  return texts;
}

describe('traduções (l10n)', () => {
  const bundle = JSON.parse(readFileSync(join(root, 'l10n', 'bundle.l10n.pt-br.json'), 'utf8')) as Record<string, string>;
  const texts = sourceTexts();

  it('o código tem textos traduzíveis', () => {
    expect(texts.size).toBeGreaterThan(0);
  });

  it('todo texto do código tem tradução em pt-BR', () => {
    expect([...texts].filter(text => !bundle[text])).toEqual([]);
  });

  it('o bundle não tem tradução de texto que saiu do código', () => {
    expect(Object.keys(bundle).filter(key => !texts.has(key))).toEqual([]);
  });

  it('variáveis {0}, {1}… iguais no original e na tradução', () => {
    const vars = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort().join();
    expect(Object.entries(bundle).filter(([key, value]) => vars(key) !== vars(value))).toEqual([]);
  });
});

describe('package.json', () => {
  const manifest = readFileSync(join(root, 'package.json'), 'utf8');
  const keys = [...manifest.matchAll(/"%([^%"]+)%"/g)].map(m => m[1]);

  it('toda chave %…% tem texto em inglês e em português', () => {
    for (const file of ['package.nls.json', 'package.nls.pt-br.json']) {
      const nls = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>;
      expect(keys.filter(key => !nls[key]), file).toEqual([]);
    }
  });

  it('as páginas do guia de primeiros passos existem e entram no pacote', () => {
    const ignore = readFileSync(join(root, '.vscodeignore'), 'utf8');
    expect(ignore).toContain('!media/walkthrough/**');
    for (const file of ['package.nls.json', 'package.nls.pt-br.json']) {
      const nls = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>;
      const media = Object.entries(nls).filter(([key]) => /^walkthrough\.\w+\.media$/.test(key));
      expect(media.length).toBe(7);
      for (const [, path] of media) expect(existsSync(join(root, path)), path).toBe(true);
    }
  });
});
