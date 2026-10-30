/**
 * Página de teste do editor visual: monta o MarkdownEditor real (Crepe + plugins da demo), sem
 * Backstage nem GitHub. Os testes leem o estado por `window.harness`.
 *
 * Conteúdo inicial: `?md=<texto>` na URL (padrão: um parágrafo).
 */
import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownEditor, MarkdownEditorHandle } from '../../src/MarkdownEditor';
import { editorTextFrom } from '../../src/labels';
import { ptBR } from '../../src/messages/pt-BR';
import {
  fixLintProblems,
  fromEditor,
  LintFinding,
  lintFindings,
  parseLintConfig,
  toEditor,
} from '@edtroleis/techdocs-editor-core';
// Mesma configuração do lint da wiki de demonstração (fora do monorepo de propósito: é a da wiki)
import lintConfigText from '../../../extension/test/fixtures/wiki/.markdownlint.yaml';

// Toda imagem "do repositório" aparece com esta (200x100, tamanho real para dar para clicar)
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#4a90d9"/></svg>',
)}`;

type Harness = {
  /** Markdown do editor na última mudança (undefined: nenhuma edição ainda). */
  editorMarkdown?: string;
  /** Quantas vezes o editor avisou mudança. */
  changes: number;
  /** Nomes dos arquivos enviados pelo botão de imagem. */
  uploads: string[];
  /** Endereços que o editor pediu para exibir. */
  resolved: string[];
  /** Markdown como seria salvo no repositório (fromEditor). */
  saved: () => string | undefined;
  /** Problemas de lint do Markdown salvo (o mesmo lint do editor e da pipeline). */
  lint: () => LintFinding[];
  /** Markdown que o botão Salvar grava: o salvo com as correções automáticas do lint. */
  committed: () => string;
  /** Problemas que sobram depois das correções automáticas (travam o Salvar). */
  lintCommitted: () => LintFinding[];
  editor: MarkdownEditorHandle | null;
};

declare global {
  interface Window {
    harness: Harness;
  }
}

const params = new URLSearchParams(window.location.search);
const initial = params.get('md') ?? '# Página\n\nTexto inicial.\n';

const lintConfig = parseLintConfig('.markdownlint.yaml', lintConfigText);

// Textos do editor em português, direto do catálogo (sem a API de tradução do Backstage)
const messages: Record<string, string> = ptBR;
const text = editorTextFrom((key, vars = {}) =>
  (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? '')),
);

const ref = createRef<MarkdownEditorHandle>();
const harness: Harness = {
  changes: 0,
  uploads: [],
  resolved: [],
  saved: () => (harness.editorMarkdown === undefined ? undefined : fromEditor(harness.editorMarkdown)),
  lint: () => lintFindings(harness.saved() ?? fromEditor(toEditor(initial)), lintConfig),
  committed: () => fixLintProblems(harness.saved() ?? fromEditor(toEditor(initial)), lintConfig),
  lintCommitted: () => lintFindings(harness.committed(), lintConfig),
  get editor() {
    return ref.current;
  },
};
window.harness = harness;

createRoot(document.getElementById('root')!).render(
  <MarkdownEditor
    ref={ref}
    text={text}
    initialValue={toEditor(initial)}
    onChange={markdown => {
      harness.editorMarkdown = markdown;
      harness.changes++;
    }}
    onUploadImage={async file => {
      harness.uploads.push(file.name);
      return `../assets/${file.name}`;
    }}
    resolveImage={async url => {
      harness.resolved.push(url);
      return url ? PICTURE : '';
    }}
    problemLines={[]}
    // Páginas do site para a caixa de link, como o host manda (a página aberta é guias/deploy.md)
    linkPages={async () => [
      { title: 'Início', href: '../index.md', detail: 'index.md' },
      { title: 'Referência da API', href: '../referencia-da-api.md', detail: 'referencia-da-api.md' },
      { title: 'Rotina de backup', href: 'backup.md', detail: 'guias/backup.md', section: 'Guias' },
      { title: 'Rascunho', href: '../rascunho.md', detail: 'rascunho.md', outside: true },
    ]}
  />,
);
