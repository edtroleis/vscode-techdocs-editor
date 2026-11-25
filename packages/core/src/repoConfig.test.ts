import { EMPTY_REPO_CONFIG, parseRepoConfig, setAttachments, setCatalogMode, setTemplatesRepository } from './repoConfig';

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

  it('sem modo, tira o catalog (vale o da pessoa); o arquivo só com ele fica vazio', () => {
    expect(setCatalogMode('# do time\ncatalog: off\nverification:\n  mode: editor\n', undefined)).toBe('# do time\nverification:\n  mode: editor\n');
    expect(setCatalogMode('catalog: required\n', undefined)).toBe('');
    expect(setCatalogMode(undefined, undefined)).toBe('');
    expect(setCatalogMode('catalog: [\n', undefined)).toBe('catalog: [\n');
  });
});

describe('templates.repository no .techdocs-editor.yaml (spec 08, TR6)', () => {
  it('lê o repositório de templates do time; vazio ou de outro tipo é ignorado', () => {
    expect(parseRepoConfig('templates:\n  repository: acme/docs-templates/templates@v2\n').templates).toEqual({ repository: 'acme/docs-templates/templates@v2' });
    expect(parseRepoConfig('templates:\n  repository: "  "\n').templates).toBeUndefined();
    expect(parseRepoConfig('templates:\n  repository: 3\n').templates).toBeUndefined();
    expect(parseRepoConfig('templates: acme/x\n').templates).toBeUndefined();
  });

  it('grava e tira o valor sem mexer no resto do arquivo', () => {
    expect(setTemplatesRepository(undefined, 'acme/t')).toBe('templates:\n  repository: acme/t\n');
    const text = '# do time\ncatalog: off\n';
    expect(setTemplatesRepository(text, 'acme/t')).toBe('# do time\ncatalog: off\ntemplates:\n  repository: acme/t\n');
    expect(setTemplatesRepository('catalog: off\ntemplates:\n  repository: acme/t\n', undefined)).toBe('catalog: off\n');
  });

  it('arquivo que não se lê: acrescenta no fim, sem uma segunda chave templates', () => {
    expect(setTemplatesRepository('catalog: [\n', 'acme/t')).toBe('catalog: [\ntemplates:\n  repository: acme/t\n');
    const broken = 'catalog: [\ntemplates:\n  repository: velho/t\n';
    expect(setTemplatesRepository(broken, 'acme/t')).toBe(broken);
  });
});

describe('attachments no .techdocs-editor.yaml (spec 07, AX1)', () => {
  it('lê cada campo; inválido é ignorado', () => {
    const text = 'attachments:\n  images: imgs/\n  imagesMaxSizeMB: 8\n  imageTypes: [PNG, .jpg]\n  files: ""\n  filesMaxSizeMB: -1\n  fileTypes: pdf, exe, zip\n';
    expect(parseRepoConfig(text).attachments).toEqual({ images: 'imgs', imagesMaxSizeMB: 8, imageTypes: ['png', 'jpg'], fileTypes: ['pdf', 'zip'] });
    expect(parseRepoConfig('catalog: off\n').attachments).toBeUndefined();
    expect(parseRepoConfig('attachments: [1]\n').attachments).toBeUndefined();
  });

  it('grava os campos dados (na ordem fixa: imagens, depois anexos), tira os undefined e o attachments vazio; o resto do arquivo fica', () => {
    const text = '# do time\ncatalog: off\n';
    const set = setAttachments(text, { files: 'anexos', fileTypes: ['pdf', 'zip'], imagesMaxSizeMB: 8 });
    expect(set).toBe('# do time\ncatalog: off\nattachments:\n  imagesMaxSizeMB: 8\n  files: anexos\n  fileTypes: [ pdf, zip ]\n');
    expect(parseRepoConfig(set).attachments).toEqual({ files: 'anexos', fileTypes: ['pdf', 'zip'], imagesMaxSizeMB: 8 });
    expect(setAttachments(set, { files: undefined, fileTypes: undefined, imagesMaxSizeMB: undefined })).toBe(text);
    expect(setAttachments(undefined, { images: 'imgs' })).toBe('attachments:\n  images: imgs\n');
  });
});
