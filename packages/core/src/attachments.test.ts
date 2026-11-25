import { describe, expect, it } from 'vitest';
import {
  attachmentKind,
  attachmentLinkText,
  attachmentTarget,
  cleanFileName,
  DEFAULT_FILE_TYPES,
  DEFAULT_IMAGE_TYPES,
  parseTypes,
  withSuffix,
} from './attachments';

describe('nome do arquivo (spec 07, AX1)', () => {
  it('sem acento, minúsculas, - no lugar de espaços e símbolos; extensão em minúsculas', () => {
    expect(cleanFileName('Manual do Cliente.pdf')).toBe('manual-do-cliente.pdf');
    expect(cleanFileName('Relatório Ação (v2) — final.DOCX')).toBe('relatorio-acao-v2-final.docx');
    expect(cleanFileName('  __capacidade__2026  .xlsx')).toBe('capacidade-2026.xlsx');
    expect(cleanFileName('arquivo.tar.gz')).toBe('arquivo-tar.gz');
  });

  it('sem extensão ou sem nome que sobre', () => {
    expect(cleanFileName('LEIAME')).toBe('leiame');
    expect(cleanFileName('###.pdf')).toBe('arquivo.pdf');
    expect(cleanFileName('', new Date(2026, 10, 25, 9, 5), 'png')).toBe('imagem-20261125-0905.png');
  });

  it('sufixo -2, -3 antes da extensão', () => {
    expect(withSuffix('manual.pdf', 2)).toBe('manual-2.pdf');
    expect(withSuffix('leiame', 3)).toBe('leiame-3');
  });
});

describe('tipos (spec 07, revisão 0.22)', () => {
  it('campo de texto: separa por vírgula, espaço ou ;, tira o ponto, minúsculas, sem repetidos', () => {
    expect(parseTypes(' .PDF, docx;xlsx  pdf ,, csv.')).toEqual({ types: ['pdf', 'docx', 'xlsx', 'csv'], refused: [] });
  });

  it('executáveis, scripts e md ficam de fora, mesmo escritos', () => {
    expect(parseTypes('pdf, exe, sh, md, zip')).toEqual({ types: ['pdf', 'zip'], refused: ['exe', 'sh', 'md'] });
  });

  it('vazio: undefined (volta ao padrão); * libera tudo', () => {
    expect(parseTypes('  , ').types).toBeUndefined();
    expect(parseTypes('*').types).toEqual(['*']);
    expect(parseTypes('pdf, *').types).toEqual(['*']);
  });

  it('imagem, anexo ou recusado pela extensão', () => {
    const lists = { imageTypes: DEFAULT_IMAGE_TYPES, fileTypes: DEFAULT_FILE_TYPES };
    expect(attachmentKind('diagrama.PNG', lists)).toBe('image');
    expect(attachmentKind('manual.pdf', lists)).toBe('file');
    expect(attachmentKind('setup.exe', lists)).toBe('blocked');
    expect(attachmentKind('outra.md', lists)).toBe('blocked');
    expect(attachmentKind('video.mp4', lists)).toBe('notAllowed');
    expect(attachmentKind('sem-extensao', lists)).toBe('notAllowed');
    // Imagem fora da lista das imagens vira anexo se estiver na dos anexos
    expect(attachmentKind('foto.png', { imageTypes: ['jpg'], fileTypes: ['png'] })).toBe('file');
    // * libera tudo, menos executáveis e md
    expect(attachmentKind('video.mp4', { imageTypes: DEFAULT_IMAGE_TYPES, fileTypes: ['*'] })).toBe('file');
    expect(attachmentKind('run.ps1', { imageTypes: ['*'], fileTypes: ['*'] })).toBe('blocked');
  });
});

describe('onde grava e o link', () => {
  it('no diretório dentro do docs_dir; o link relativo à página', () => {
    expect(attachmentTarget('/r/docs/guias/a.md', '/r/docs', 'assets', 'manual.pdf')).toEqual({
      path: '/r/docs/assets/manual.pdf',
      link: '../assets/manual.pdf',
    });
    expect(attachmentTarget('/r/docs/index.md', '/r/docs', '/images/', 'x.png').link).toBe('images/x.png');
    // Página fora de um site: ao lado dela
    expect(attachmentTarget('/r/notas/a.md', undefined, 'assets', 'x.pdf').path).toBe('/r/notas/assets/x.pdf');
  });

  it('texto do link: nome legível, tipo e tamanho na língua', () => {
    expect(attachmentLinkText('manual_do-cliente.pdf', 2.3 * 1024 * 1024, 'pt-BR')).toBe('Manual do cliente (PDF, 2,3 MB)');
    expect(attachmentLinkText('capacity plan.xlsx', 1536, 'en')).toBe('Capacity plan (XLSX, 1.5 KB)');
    expect(attachmentLinkText('LEIAME', 300, 'pt-BR')).toBe('LEIAME (300 B)');
  });
});
