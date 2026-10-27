import { RefObject, useEffect, useRef, useState } from 'react';
import type { TextLookup } from './labels';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import type { SearchResult } from './visualSearch';

const NO_RESULT: SearchResult = { current: 0, total: 0 };

/** Textos da barra de busca, na língua de quem usa o editor. */
export type SearchText = {
  placeholder: string;
  count: (current: number, total: number) => string;
  none: string;
  previous: string;
  next: string;
  close: string;
};

export function searchTextFrom(t: TextLookup): SearchText {
  return {
    placeholder: t('search.placeholder'),
    count: (current, total) => t('search.count', { current, total }),
    none: t('search.none'),
    previous: t('search.previous'),
    next: t('search.next'),
    close: t('search.close'),
  };
}

/**
 * Busca no modo visual: abre, procura, anda pelos resultados e fecha (limpando o destaque).
 * `focusRequest` muda a cada pedido de abrir (Ctrl+F com a barra já aberta volta o foco ao campo).
 */
export function useVisualSearch(editorRef: RefObject<MarkdownEditorHandle>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult>(NO_RESULT);
  const [focusRequest, setFocusRequest] = useState(0);

  const run = (text: string) => {
    setQuery(text);
    setResult(editorRef.current?.search(text) ?? NO_RESULT);
  };
  /** Abre a barra; com `initial` (o texto selecionado), já procura por ele. */
  const show = (initial?: string) => {
    setOpen(true);
    setFocusRequest(n => n + 1);
    if (initial) run(initial);
  };
  const move = (delta: 1 | -1) => setResult(editorRef.current?.moveSearch(delta) ?? NO_RESULT);
  const close = () => {
    editorRef.current?.search('');
    setQuery('');
    setResult(NO_RESULT);
    setOpen(false);
    editorRef.current?.focus();
  };
  /** O texto mudou: o total e a posição podem ser outros. */
  const refresh = () => {
    if (open && query) setResult(editorRef.current?.searchResult() ?? NO_RESULT);
  };
  return { open, query, result, focusRequest, show, run, move, close, refresh };
}

type Props = Omit<ReturnType<typeof useVisualSearch>, 'open' | 'show' | 'refresh'> & { text: SearchText };

/** Barra de busca do modo visual (no plugin era de Material UI; aqui, HTML com as classes `docs-search-*`). */
export const SearchBar = ({ text, query, result, focusRequest, run, move, close }: Props) => {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);
  const count = result.total ? text.count(result.current, result.total) : query ? text.none : '';
  return (
    <div className="docs-search-bar" role="search">
      <input
        ref={input}
        type="text"
        aria-label={text.placeholder}
        placeholder={text.placeholder}
        value={query}
        onChange={e => run(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            move(e.shiftKey ? -1 : 1);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="docs-search-count" aria-live="polite">
        {count}
      </span>
      <button type="button" title={text.previous} aria-label={text.previous} onClick={() => move(-1)}>
        ↑
      </button>
      <button type="button" title={text.next} aria-label={text.next} onClick={() => move(1)}>
        ↓
      </button>
      <button type="button" title={text.close} aria-label={text.close} onClick={close}>
        ✕
      </button>
    </div>
  );
};
