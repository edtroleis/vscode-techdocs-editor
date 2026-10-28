import { EMPTY_REPO_CONFIG, parseRepoConfig, setCatalogMode } from './repoConfig';

describe('.techdocs-editor.yaml', () => {
  it('lê o modo, o tempo para começar e as mensagens dos checks', () => {
    const config = parseRepoConfig(`
verification:
  mode: pipeline
  startTimeoutSeconds: 600
  checkHelp:
    build: A documentação não pôde ser montada.
    'Verificação de links': Há links que não funcionam.
`);
    expect(config).toEqual({
      verification: {
        mode: 'pipeline',
        startTimeoutSeconds: 600,
        checkHelp: {
          build: 'A documentação não pôde ser montada.',
          'Verificação de links': 'Há links que não funcionam.',
        },
      },
    });
  });

  it('ignora campos inválidos (vale o do portal) sem travar o editor', () => {
    const config = parseRepoConfig(`
verification:
  mode: jenkins
  startTimeoutSeconds: -5
  checkHelp:
    build: 3
    lint: Formatação fora do padrão.
`);
    expect(config.verification).toEqual({ mode: undefined, startTimeoutSeconds: undefined, checkHelp: { lint: 'Formatação fora do padrão.' } });
  });

  it('YAML que não abre, vazio ou sem verification: configuração vazia', () => {
    expect(parseRepoConfig('verification: [')).toEqual(EMPTY_REPO_CONFIG);
    expect(parseRepoConfig('')).toEqual(EMPTY_REPO_CONFIG);
    expect(parseRepoConfig('outra: coisa')).toEqual(EMPTY_REPO_CONFIG);
    expect(parseRepoConfig('verification: texto')).toEqual(EMPTY_REPO_CONFIG);
  });
});

describe('catalog no .techdocs-editor.yaml', () => {
  it('lê o modo; valor inválido é ignorado', () => {
    expect(parseRepoConfig('catalog: off\n').catalog).toBe('off');
    expect(parseRepoConfig('catalog: required\n').catalog).toBe('required');
    expect(parseRepoConfig('catalog: sim\n').catalog).toBeUndefined();
    expect(parseRepoConfig('verification:\n  mode: editor\n').catalog).toBeUndefined();
  });

  it('grava o modo mantendo o resto do arquivo e os comentários', () => {
    expect(setCatalogMode(undefined, 'off')).toBe('catalog: off\n');
    const text = '# do time\nverification:\n  mode: editor # sem pipeline\n';
    expect(setCatalogMode(text, 'required')).toBe(`${text}catalog: required\n`);
    expect(setCatalogMode('catalog: off # antes\nverification:\n  mode: editor\n', 'auto')).toBe('catalog: auto # antes\nverification:\n  mode: editor\n');
  });
});
