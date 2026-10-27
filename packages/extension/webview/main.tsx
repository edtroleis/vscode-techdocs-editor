/**
 * Webview do editor visual: monta o MarkdownEditor do pacote `ui` e conversa com o host
 * (src/visualEditorProvider.ts) pelas mensagens de src/protocol.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fromEditor, toEditor } from '@edtroleis/techdocs-editor-core';
import { MarkdownEditor, MarkdownEditorHandle, editorTextFrom, en, ptBR } from '@edtroleis/techdocs-editor-ui';
import type { HostMessage, WebviewMessage } from '../src/protocol';
import './webview.css';

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const post = (message: WebviewMessage) => vscode.postMessage(message);

type Content = { text: string; language: string; baseUri: string };
/** Cada versão recria o editor: o mesmo texto de novo (desfazer até o original) também recria. */
type Loaded = { initialValue: string; version: number };

function lookupFor(language: string) {
  const messages = language.toLowerCase().startsWith('pt') ? ptBR : en;
  return (key: string, vars: Record<string, string | number> = {}) =>
    (messages[key] ?? en[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''));
}

function App({ content }: { content: Content }) {
  const editor = useRef<MarkdownEditorHandle>(null);
  const [loaded, setLoaded] = useState<Loaded>({ initialValue: toEditor(content.text), version: 0 });
  // Texto do documento como o webview o conhece: o que veio do host ou o último enviado
  const documentText = useRef(content.text);
  const text = useMemo(() => editorTextFrom(lookupFor(content.language)), [content.language]);

  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'update':
          if (message.text === documentText.current) return;
          documentText.current = message.text;
          setLoaded(prev => ({ initialValue: toEditor(message.text), version: prev.version + 1 }));
          return;
        case 'test:getSaved':
          post({ type: 'test:saved', id: message.id, text: fromEditor(editor.current!.getMarkdown()) });
          return;
        case 'test:insert':
          editor.current!.insertMarkdown(message.markdown);
          return;
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const resolveImage = async (url: string) => {
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    return new URL(url, `${content.baseUri.replace(/\/?$/, '/')}`).toString();
  };

  return (
    <MarkdownEditor
      key={loaded.version}
      ref={editor}
      initialValue={loaded.initialValue}
      onChange={markdown => {
        const saved = fromEditor(markdown);
        if (saved === documentText.current) return;
        documentText.current = saved;
        post({ type: 'edit', text: saved });
      }}
      // Envio de imagens: fase 2 (grava em <docs>/assets/ pelo host)
      onUploadImage={() => Promise.reject(new Error('Envio de imagens ainda não disponível'))}
      resolveImage={resolveImage}
      problemLines={[]}
      text={text}
      onReady={() => post({ type: 'ready' })}
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
