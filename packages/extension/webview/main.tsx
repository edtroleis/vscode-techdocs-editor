/**
 * Webview do editor visual: monta o MarkdownEditor do pacote `ui` e conversa com o host
 * (src/visualEditorProvider.ts) pelas mensagens de src/protocol.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fromEditor, toEditor } from '@edtroleis/techdocs-editor-core';
import {
  MarkdownEditor,
  MarkdownEditorHandle,
  SearchBar,
  editorTextFrom,
  en,
  ptBR,
  searchTextFrom,
  useVisualSearch,
} from '@edtroleis/techdocs-editor-ui';
import type { HostMessage, LinkPageView, ProblemView, WebviewLabels, WebviewMessage } from '../src/protocol';
import type { Strip } from '../src/publish/strip';
import { rebase } from '../src/rebase';
import './webview.css';

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const post = (message: WebviewMessage) => vscode.postMessage(message);

type Content = { text: string; language: string; baseUri: string; labels: WebviewLabels; readOnly?: boolean };

/** Texto com `{0}` trocado pelo valor. */
const format = (template: string, value: number) => template.replace('{0}', String(value));

/** Envios de imagem esperando a resposta do host, por id. */
const uploads = new Map<number, { resolve: (link: string) => void; reject: (error: Error) => void }>();
let nextUpload = 0;

/** Manda a imagem ao host, que grava em `<docs>/assets/` e devolve o link relativo à página. */
async function uploadImage(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const id = nextUpload++;
  return new Promise((resolve, reject) => {
    uploads.set(id, { resolve, reject });
    post({ type: 'uploadImage', id, name: file.name, mime: file.type, data });
  });
}

const linkRequests = new Map<number, (pages: LinkPageView[]) => void>();
let nextLinkRequest = 0;

/** Pede ao host as páginas do site para a caixa de link (a cada vez que ela abre: páginas novas entram). */
function linkPages(): Promise<LinkPageView[]> {
  const id = nextLinkRequest++;
  return new Promise(resolve => {
    linkRequests.set(id, resolve);
    post({ type: 'linkPages', id });
  });
}

/** Testes: escolhe o arquivo no botão de envio do bloco de imagem vazio (esperando ele aparecer). */
async function chooseImage(name: string, mime: string, data: Uint8Array) {
  const selector = '.milkdown-image-block input[type="file"]';
  for (let i = 0; i < 50 && !document.querySelector(selector); i++) await new Promise(r => setTimeout(r, 100));
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) return;
  const files = new DataTransfer();
  files.items.add(new File([new Uint8Array(data)], name, { type: mime }));
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function lookupFor(language: string) {
  const messages = language.toLowerCase().startsWith('pt') ? ptBR : en;
  return (key: string, vars: Record<string, string | number> = {}) =>
    (messages[key] ?? en[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''));
}

function App({ content }: { content: Content }) {
  const editor = useRef<MarkdownEditorHandle>(null);
  // O editor é criado uma vez; o que muda depois chega por setMarkdown (sem perder o cursor)
  const [initialValue] = useState(() => toEditor(content.text));
  // Texto do documento como o webview o conhece: o que veio do host ou o último enviado
  const documentText = useRef(content.text);
  const text = useMemo(() => editorTextFrom(lookupFor(content.language)), [content.language]);
  const searchText = useMemo(() => searchTextFrom(lookupFor(content.language)), [content.language]);
  const search = useVisualSearch(editor);
  // Lido pelos ouvintes registrados uma vez só
  const searchRef = useRef(search);
  searchRef.current = search;
  const [problems, setProblems] = useState<ProblemView[]>([]);
  const problemLines = useMemo(() => [...new Set(problems.map(p => p.line))], [problems]);

  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'update': {
          if (message.text === documentText.current) return;
          // Edição da pessoa ainda não avisada (o aviso é adiado enquanto ela digita): entra por cima
          // da mudança de fora, em vez de ser apagada por ela
          const pending = editor.current?.pendingChange();
          if (!pending) {
            documentText.current = message.text;
            editor.current?.setMarkdown(toEditor(message.text));
            searchRef.current.refresh();
            return;
          }
          const before = fromEditor(pending.previous);
          const after = fromEditor(pending.markdown);
          // Mostra já o resultado da junção; o host faz a mesma junção no documento
          const text = rebase(before, after, message.text);
          documentText.current = text;
          editor.current?.setMarkdown(toEditor(text));
          post({ type: 'edit', before, after });
          return;
        }
        case 'lint':
          setProblems(message.problems);
          return;
        case 'linkPages':
          linkRequests.get(message.id)?.(message.pages);
          linkRequests.delete(message.id);
          return;
        case 'uploaded': {
          const pending = uploads.get(message.id);
          uploads.delete(message.id);
          if (message.link !== undefined) pending?.resolve(message.link);
          else pending?.reject(new Error(message.error));
          return;
        }
        case 'select':
          editor.current?.selectText(message.text);
          return;
        case 'test:chooseImage':
          void chooseImage(message.name, message.mime, message.data);
          return;
        case 'test:getSaved':
          post({ type: 'test:saved', id: message.id, text: fromEditor(editor.current!.getMarkdown()) });
          return;
        case 'test:insert':
          editor.current!.insertMarkdown(message.markdown);
          return;
        case 'test:click':
          document.querySelector<HTMLElement>(message.selector)?.click();
          return;
        case 'test:clickTopBar': {
          const button = document.querySelectorAll<HTMLElement>('.top-bar-item')[message.index];
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
          }
          return;
        }
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  useEffect(() => {
    // Ctrl+F (Cmd+F no Mac) abre a busca do editor visual (spec 01, W10); com uma palavra selecionada,
    // já procura por ela, como a busca do VS Code
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        // Ctrl+S: o aviso do que a pessoa digitou é adiado; se o VS Code gravasse já, a página ficaria
        // gravada pela metade. Avisa tudo e pede ao host que grave depois de aplicar
        event.preventDefault();
        event.stopPropagation();
        editor.current?.flushChange();
        post({ type: 'save' });
        return;
      }
      if (key !== 'f') return;
      event.preventDefault();
      event.stopPropagation();
      const selected = window.getSelection()?.toString() ?? '';
      searchRef.current.show(selected && !selected.includes('\n') ? selected : undefined);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);

  /** Avisa o que ainda não foi avisado (o editor avisa com atraso) e então desfaz/refaz no documento. */
  const history = useMemo(() => {
    const run = (type: 'undo' | 'redo') => {
      editor.current?.flushChange();
      post({ type });
    };
    return { undo: () => run('undo'), redo: () => run('redo') };
  }, []);

  const resolveImage = async (url: string) => {
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    return new URL(url, `${content.baseUri.replace(/\/?$/, '/')}`).toString();
  };

  const lineTitle = (line: number) => {
    const here = problems.filter(p => p.line === line).map(p => p.message);
    return [...here, format(content.labels.showLine, line)].join('\n');
  };

  return (
    <>
    <StatusStrip labels={content.labels} />
    {search.open && <SearchBar text={searchText} {...search} />}
    <MarkdownEditor
      ref={editor}
      initialValue={initialValue}
      onChange={(markdown, previous) => {
        // Só o que a pessoa mudou; o host aplica ao documento como ele estiver (ver rebase.ts)
        const before = fromEditor(previous);
        const after = fromEditor(markdown);
        if (before === after) return;
        documentText.current = rebase(before, after, documentText.current);
        post({ type: 'edit', before, after });
        search.refresh();
      }}
      onUploadImage={uploadImage}
      resolveImage={resolveImage}
      problemLines={problemLines}
      text={text}
      onReady={() => post({ type: 'ready' })}
      history={history}
      onLineClick={line => post({ type: 'showLine', line })}
      lineTitle={lineTitle}
      readOnly={content.readOnly}
      linkPages={linkPages}
    />
    <Problems problems={problems} labels={content.labels} />
    </>
  );
}

/** Problemas de formatação da página (spec 01, L-3 e L-4): a lista, "Ver linha" e "Ajustar agora". */
function Problems({ problems, labels }: { problems: ProblemView[]; labels: WebviewLabels }) {
  if (problems.length === 0) return null;
  const title = problems.length === 1 ? labels.problemsOne : format(labels.problemsOther, problems.length);
  return (
    <section className="problems" aria-label={title}>
      <details open>
        <summary>{title}</summary>
        <ul>
          {problems.map((problem, i) => (
            <li key={i}>
              <button
                type="button"
                className="problem-line"
                title={format(labels.showLine, problem.line)}
                onClick={() => post({ type: 'showLine', line: problem.line })}
              >
                {format(labels.line, problem.line)}
              </button>{' '}
              {problem.message}
            </li>
          ))}
        </ul>
      </details>
      {problems.some(p => p.fixable) && (
        <button type="button" className="problems-fix" onClick={() => post({ type: 'fixLint' })}>
          {labels.fixAll}
        </button>
      )}
    </section>
  );
}

/** Última faixa de estado vinda do host (pode chegar antes do editor montar). */
let lastStrip: Strip | undefined;

/**
 * Faixa de estado no topo da página: rascunho, enviando (com os passos), em revisão, publicada ou o que
 * corrigir, com a próxima ação. O resto fica no menu "⋯" e no painel de detalhes da publicação.
 */
function StatusStrip({ labels }: { labels: WebviewLabels }) {
  const [strip, setStrip] = useState(lastStrip);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      if (event.data.type !== 'status') return;
      setStrip(event.data.strip);
      setMenuOpen(false);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  if (!strip) return null;
  return (
    <div className={`status-strip ${strip.tone}`} role={strip.tone === 'problem' ? 'alert' : 'status'}>
      <span className="status-state">{strip.state}</span>
      {strip.steps ? (
        <span className="status-steps">
          {strip.steps.map(step => (
            <span key={step.label} className={`status-step ${step.status}`}>
              {step.status === 'done' ? '✓' : step.status === 'now' ? <span className="status-spin" aria-hidden="true" /> : '○'} {step.label}
            </span>
          ))}
        </span>
      ) : (
        <span className="status-message">{strip.message}</span>
      )}
      <span className="status-actions">
        {strip.actions.map(action => (
          <button
            key={action.action}
            type="button"
            className={action.primary ? '' : 'secondary'}
            onClick={() => post({ type: 'statusAction', action: action.action })}
          >
            {action.label}
          </button>
        ))}
        {strip.menu.length > 0 && (
          <span className="status-more">
            <button
              type="button"
              className="secondary"
              aria-label={labels.more}
              title={labels.more}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(open => !open)}
            >
              ⋯
            </button>
            {menuOpen && (
              <span className="status-menu" role="menu">
                {strip.menu.map(item => (
                  <button
                    key={item.action}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      post({ type: 'statusAction', action: item.action });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/** No lugar do editor quando o arquivo tem marcadores de conflito do Git (spec 02, LC4). */
function Conflict({ message, action }: { message: string; action: string }) {
  useEffect(() => post({ type: 'ready' }), []);
  return (
    <div className="conflict" role="alert">
      <p>{message}</p>
      <button type="button" onClick={() => post({ type: 'openText' })}>
        {action}
      </button>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
// `init` chega de novo quando o conflito é resolvido: um editor novo, com o texto de agora
let generation = 0;
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === 'status') lastStrip = message.strip;
  if (message.type === 'init') root.render(<App key={++generation} content={message} />);
  else if (message.type === 'conflict') root.render(<Conflict key={++generation} {...message} />);
});
post({ type: 'loaded' });
