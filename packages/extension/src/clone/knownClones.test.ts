import { describe, expect, it } from 'vitest';
import { KnownClones, suggestedFolder } from './knownClones';

const memento = () => {
  const data = new Map<string, unknown>();
  return { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => void data.set(key, value) };
};

describe('suggestedFolder', () => {
  it('expande o ~ e junta o nome do repositório', () => {
    expect(suggestedFolder('~/Documents/TechDocs', 'guia-pagamentos', '/home/m')).toBe('/home/m/Documents/TechDocs/guia-pagamentos');
  });
  it('caminho absoluto fica como está; barra no fim não duplica', () => {
    expect(suggestedFolder('/dados/docs/', 'guia', '/home/m')).toBe('/dados/docs/guia');
  });
  it('vazio: ~/Documents/TechDocs', () => {
    expect(suggestedFolder('', 'guia', '/home/m')).toBe('/home/m/Documents/TechDocs/guia');
  });
});

describe('KnownClones', () => {
  it('acha o clone lembrado quando o diretório existe e o origin bate', async () => {
    const clones = new KnownClones(memento(), async path => (path === '/c/guia' ? 'https://github.com/acme/guia.git' : undefined));
    await clones.remember('github.com', 'acme/guia', '/c/guia');
    expect(await clones.find('github.com', 'ACME/guia')).toBe('/c/guia');
  });
  it('ignora caminho apagado e esquece', async () => {
    const state = memento();
    const clones = new KnownClones(state, async () => undefined);
    await clones.remember('github.com', 'acme/guia', '/c/guia');
    expect(await clones.find('github.com', 'acme/guia')).toBeUndefined();
    expect(state.get('techdocsEditor.clones')).toEqual({});
  });
  it('ignora o diretório que agora é de outro repositório', async () => {
    const clones = new KnownClones(memento(), async () => 'https://github.com/acme/outro.git');
    await clones.remember('github.com', 'acme/guia', '/c/guia');
    expect(await clones.find('github.com', 'acme/guia')).toBeUndefined();
  });
});
