/**
 * Webview do editor visual: monta o MarkdownEditor do pacote `ui` e conversa com o host
 * (src/visualEditorProvider.ts) pelas mensagens de src/protocol.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fromEditor, toEditor } from '@edtroleis/techdocs-editor-core';
import { MarkdownEditor, MarkdownEditorHandle, editorTextFrom, en, ptBR } from '@edtroleis/techdocs-editor-ui';
import type { HostMessage, WebviewMessage } from '../src/protocol';
import { rebase } from '../src/rebase';
import './webview.css';

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const post = (message: WebviewMessage) => vscode.postMessage(message);

type Content = { text: string; language: string; baseUri: string };

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
        case 'test:getSaved':
          post({ type: 'test:saved', id: message.id, text: fromEditor(editor.current!.getMarkdown()) });
          return;
        case 'test:insert':
          editor.current!.insertMarkdown(message.markdown);
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

  return (
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
      }}
      // Envio de imagens: fase 2 (grava em <docs>/assets/ pelo host)
      onUploadImage={() => Promise.reject(new Error('Envio de imagens ainda não disponível'))}
      resolveImage={resolveImage}
      problemLines={[]}
      text={text}
      onReady={() => post({ type: 'ready' })}
      history={history}
    />
  );
}

const root = createRoot(document.getElementById('root')!);
window.addEventListener('message', function init(event: MessageEvent<HostMessage>) {
  if (event.data.type !== 'init') return;
  window.removeEventListener('message', init);
  root.render(<App content={event.data} />);
});
post({ type: 'loaded' });
