import { docsLanguage, textLanguage } from './docsLanguage';

describe('textLanguage', () => {
  test('README em português', () => {
    expect(textLanguage('# Tarefas API\n\nUma API para cadastrar as tarefas do time e acompanhar o que está em andamento.\n')).toBe('pt-br');
  });

  test('README em inglês', () => {
    expect(textLanguage('# Tasks API\n\nAn API to register the tasks of the team and follow what is in progress.\n')).toBe('en');
  });

  test('código não conta: comandos em inglês num texto em português', () => {
    const text = '# Como rodar\n\nRode o comando abaixo para subir a API e depois abra o navegador na porta que aparece:\n\n```bash\nif the server is on then run it with the flag\n```\n';
    expect(textLanguage(text)).toBe('pt-br');
  });

  test('README curto: as palavras com acento do português também contam', () => {
    expect(textLanguage('# Tarefas API\n\nAPI simples de tarefas (FastAPI), usada como exemplo de serviço com documentação no TechDocs.\n')).toBe('pt-br');
    expect(textLanguage('# techdocs-cenario-vazio\n\nRepositório de teste dos cenários do TechDocs Editor: começa só com este README.\n')).toBe('pt-br');
    // "Café" não puxa para o português (só til e cedilha contam)
    expect(textLanguage('# Café API\n\nA small API to order coffee for the team.\n')).not.toBe('pt-br');
  });

  test('pouco texto ou só título: não decide', () => {
    expect(textLanguage('# Tarefas API\n')).toBeUndefined();
    expect(textLanguage('')).toBeUndefined();
  });
});

describe('docsLanguage', () => {
  const pt = 'Uma API para cadastrar as tarefas do time e acompanhar o que está em andamento.';

  test('theme.language do mkdocs.yml vale primeiro', () => {
    expect(docsLanguage('site_name: X\ntheme:\n  name: material\n  language: en\n', [pt], 'pt-br')).toBe('en');
    expect(docsLanguage('theme:\n  language: pt-BR\n', [], 'en')).toBe('pt-br');
  });

  test('sem língua no tema: a do texto; sem texto que decida: a do VS Code', () => {
    expect(docsLanguage('site_name: X\n', [pt], 'en')).toBe('pt-br');
    expect(docsLanguage(undefined, ['# X'], 'en')).toBe('en');
  });

  test('mkdocs.yml com tag do Python não quebra', () => {
    expect(docsLanguage('markdown_extensions:\n  - pymdownx.emoji:\n      emoji_index: !!python/name:material.extensions.emoji.twemoji\n', [pt], 'en')).toBe('pt-br');
  });
});
