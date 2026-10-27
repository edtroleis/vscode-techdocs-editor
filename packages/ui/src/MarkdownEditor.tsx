import { type KeyboardEvent as ReactKeyboardEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, parserCtx, remarkCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { insert } from '@milkdown/kit/utils';
import { STRINGIFY_OPTIONS, repoLineNumbers } from '@edtroleis/techdocs-editor-core';
import { defaultCodeLanguagePlugin } from './defaultCodeLanguage';
import { replaceChanged } from './externalContent';
import { ExternalHistory, externalHistoryCtx } from './externalHistory';
import { listCaretFixPlugin } from './listCaretFix';
import { inlineCodeTypingPlugin } from './inlineCodeTyping';
import { buildTopBar } from './topBar';
import { EditorText, headingOptions, labelTopBar, selectionToolbar, slashMenu } from './labels';
import { SearchResult, moveSearch, search, visualSearchPlugin } from './visualSearch';
// Tema do Crepe resolvido num arquivo do pacote (scripts/bundle-crepe-theme.mjs), depois os ajustes
import './vendor/crepe-theme.css';
import './editor.css';

// O editor se redimensiona enquanto mede o conteúdo e o navegador avisa "ResizeObserver loop…".
// É inofensivo, mas o overlay de desenvolvimento do Backstage o mostra como erro em tela cheia.
window.addEventListener(
  'error',
  event => {
    if (event.message?.startsWith('ResizeObserver loop')) event.stopImmediatePropagation();
  },
  true,
);

/** Número de linha mostrado ao lado de um bloco do editor visual. */
type LineMark = { top: number; line: number; problem: boolean };

type MdRoot = { children: Array<{ position?: { start: { line: number } } }> };

export type MarkdownEditorHandle = {
  /** Busca no texto e vai para o primeiro resultado. */
  search: (query: string) => SearchResult;
  /** Próximo (+1) ou anterior (-1) resultado. */
  moveSearch: (delta: 1 | -1) => SearchResult;
  /** Markdown atual do editor (formato do editor, antes do `fromEditor`). */
  getMarkdown: () => string;
  /** Insere Markdown na posição do cursor, como se a pessoa tivesse digitado. */
  insertMarkdown: (markdown: string) => void;
  /**
   * Troca o conteúdo por `markdown` (formato do editor) sem recriar o editor: só o trecho diferente
   * muda, o cursor fica onde estava e a troca não é avisada como edição (veio de fora).
   */
  setMarkdown: (markdown: string) => void;
  /** Mudança da pessoa ainda não avisada (o aviso é adiado enquanto ela digita). */
  pendingChange: () => { markdown: string; previous: string } | undefined;
  /** Avisa agora a mudança pendente, se houver (antes de desfazer, por exemplo). */
  flushChange: () => void;
};

type Props = {
  /** Conteúdo inicial; trocar o valor recria o editor. */
  initialValue: string;
  /** Mudança feita pela pessoa: o Markdown novo e o do aviso anterior (ou do carregamento). */
  onChange: (markdown: string, previous: string) => void;
  /** Envia a imagem e devolve o endereço que vai no Markdown. */
  onUploadImage: (file: File) => Promise<string>;
  /** Endereço do Markdown → endereço que o navegador consegue exibir. */
  resolveImage: (url: string) => Promise<string>;
  /** Linhas do arquivo com problema apontado pela pipeline. */
  problemLines: number[];
  /**
   * O texto do editor é o que está salvo no GitHub (sem edição pendente): só então as linhas
   * apontadas pela pipeline batem com os blocos e as marcas aparecem.
   */
  showsSavedVersion?: boolean;
  /** Textos do editor (menus, botões, dicas), já no idioma da pessoa. */
  text: EditorText;
  /** Editor criado e com o conteúdo carregado. */
  onReady?: () => void;
  /** Histórico de fora do editor (ver externalHistory.ts); sem ele, o do ProseMirror. */
  history?: ExternalHistory;
  /** Clique (ou Enter) no número da linha ao lado do bloco: sem ele, o número é só informativo. */
  onLineClick?: (line: number) => void;
  /** Dica do número da linha; sem ela (ou sem texto), a dica genérica nos blocos com problema. */
  lineTitle?: (line: number, problem: boolean) => string | undefined;
};

/**
 * Editor visual (Milkdown Crepe): a pessoa escreve formatado, o editor produz Markdown.
 * Ao lado de cada bloco, a linha em que ele começa no arquivo salvo (a mesma que a pipeline aponta).
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(
  (
    {
      initialValue,
      onChange,
      onUploadImage,
      resolveImage,
      problemLines,
      showsSavedVersion = true,
      text,
      onReady,
      history,
      onLineClick,
      lineTitle,
    },
    ref,
  ) => {
  const crepeRef = useRef<Crepe>();
  const container = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<LineMark[]>([]);
  // Refs: trocar os callbacks não deve recriar o editor
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const uploadRef = useRef(onUploadImage);
  uploadRef.current = onUploadImage;
  const resolveRef = useRef(resolveImage);
  resolveRef.current = resolveImage;
  const problemsRef = useRef(problemLines);
  problemsRef.current = problemLines;
  const savedRef = useRef(showsSavedVersion);
  savedRef.current = showsSavedVersion;
  const textRef = useRef(text);
  textRef.current = text;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const historyRef = useRef(history);
  historyRef.current = history;
  // Último Markdown repassado (ou recebido por setMarkdown): só o que for diferente é edição nova
  const lastRef = useRef<string>();
  /** Troca feita por setMarkdown em andamento: não é edição da pessoa. */
  const applyingExternal = useRef(false);
  const notifyRef = useRef<() => void>(() => {});
  const updateMarks = useRef<() => void>(() => {});

  useEffect(() => {
    // Os textos valem para o editor criado agora (um idioma novo recria a página inteira)
    const labels = textRef.current;
    const crepe = new Crepe({
      root: root.current,
      defaultValue: initialValue,
      features: {
        // Barra fixa no topo, parecida com Word/Confluence: mais fácil para quem está começando
        [Crepe.Feature.TopBar]: true,
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: labels.placeholder },
        [Crepe.Feature.TopBar]: { buildTopBar, headingOptions: headingOptions(labels) },
        // Textos no idioma da pessoa (labels.ts)
        [Crepe.Feature.BlockEdit]: slashMenu(labels),
        [Crepe.Feature.Toolbar]: selectionToolbar(labels),
        [Crepe.Feature.LinkTooltip]: { inputPlaceholder: labels.linkPlaceholder },
        // Sem isto o editor grava "blob:..." (endereço temporário do navegador) e a imagem quebra
        [Crepe.Feature.ImageBlock]: {
          onUpload: file => uploadRef.current(file),
          inlineOnUpload: file => uploadRef.current(file),
          blockOnUpload: file => uploadRef.current(file),
          proxyDomURL: url => resolveRef.current(url),
          blockUploadButton: labels.uploadImage,
          inlineUploadButton: labels.uploadImageInline,
          blockUploadPlaceholderText: labels.imageUrlPlaceholder,
          inlineUploadPlaceholderText: labels.imageUrlPlaceholderInline,
          blockCaptionPlaceholderText: labels.imageCaption,
        },
      },
    });
    // Lido a cada uso: trocar os callbacks não recria o editor
    const external: ExternalHistory | null = historyRef.current
      ? { undo: () => historyRef.current?.undo(), redo: () => historyRef.current?.redo() }
      : null;
    crepe.editor
      .config(ctx => {
        ctx.update(remarkStringifyOptionsCtx, prev => ({ ...prev, ...STRINGIFY_OPTIONS }));
        ctx.inject(externalHistoryCtx, external);
      })
      .use(defaultCodeLanguagePlugin)
      .use(inlineCodeTypingPlugin)
      .use(listCaretFixPlugin)
      .use(visualSearchPlugin);
    crepeRef.current = crepe;

    // Linha de cada bloco: os blocos do editor e os do Markdown (remark) andam um para um; a linha no
    // Markdown do editor é convertida para a do arquivo salvo (ajustes e blocos do MkDocs mudam a contagem)
    // O editor normaliza o texto ao carregar e avisa uma "mudança": só repassa edições de verdade
    let loaded: string | undefined;
    let ready = false;
    let frame = 0;
    updateMarks.current = () => {
      if (!ready) return;
      // A barra é redesenhada pelo Crepe; os nomes dos botões são postos de novo a cada mudança
      if (root.current) labelTopBar(root.current, textRef.current);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const view = crepe.editor.ctx.get(editorViewCtx);
        const markdown = crepe.getMarkdown();
        const starts = (crepe.editor.ctx.get(remarkCtx).parse(markdown) as unknown as MdRoot).children.map(
          c => c.position?.start.line,
        );
        // Sem edição: linhas do último commit (as da pipeline); com edição: como vai ficar ao salvar
        const edited = loaded !== undefined && markdown !== loaded;
        const toRepo = repoLineNumbers(markdown, { saved: edited });
        const base = container.current?.getBoundingClientRect().top ?? 0;
        const next: LineMark[] = [];
        let index = 0;
        view.state.doc.forEach((_node, offset) => {
          const start = starts[index];
          const following = starts[index + 1];
          index++;
          const dom = view.nodeDOM(offset);
          if (!start || !(dom instanceof HTMLElement)) return;
          const line = toRepo[start - 1];
          const last = following ? toRepo[following - 1] - 1 : Infinity;
          // As linhas apontadas são da versão salva: com edição nova, as marcas ficam para depois de salvar
          // (Depois de salvar, o texto do editor é o salvo, mesmo diferente do carregado ao abrir)
          const problem = savedRef.current && problemsRef.current.some(p => p >= line && p <= Math.max(line, last));
          next.push({ top: dom.getBoundingClientRect().top - base, line, problem });
        });
        setMarks(next);
      });
    };

    // Compara com o último texto repassado, não com o carregado: editar e voltar ao texto original
    // também é mudança (senão a página ficava com a versão intermediária e salvava ela)
    lastRef.current = undefined;
    const notifyChange = () => {
      if (lastRef.current === undefined || applyingExternal.current) return;
      // O Markdown de agora: o que o aviso do Milkdown traz pode ser de um estado anterior (o aviso
      // é adiado e, com várias mudanças seguidas, chega com o documento da primeira)
      const markdown = crepe.getMarkdown();
      const previous = lastRef.current;
      if (markdown === previous) return;
      lastRef.current = markdown;
      onChangeRef.current(markdown, previous);
    };
    notifyRef.current = notifyChange;
    crepe.on(listener =>
      listener.markdownUpdated(() => {
        notifyChange();
        updateMarks.current();
      }),
    );
    // "Escolher imagem do computador" é um <label> do campo de arquivo; com o bloco de imagem no meio
    // do texto, o navegador não repassa o clique ao campo e o seletor de arquivo não abre. Repassa aqui.
    const openUploader = (event: MouseEvent) => {
      const label = (event.target as Element | null)?.closest?.('.milkdown-image-block label.uploader');
      const input = (label as HTMLLabelElement | null)?.control;
      if (!input) return;
      event.preventDefault();
      input.click();
    };
    root.current?.addEventListener('click', openUploader);
    // Com histórico de fora, os atalhos de desfazer não chegam ao ProseMirror (que tem o dele)
    const historyKeys = (event: KeyboardEvent) => {
      if (!external || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : undefined;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      external[action]();
    };
    root.current?.addEventListener('keydown', historyKeys, true);
    // Imagens carregando, janela redimensionada etc. mudam a posição dos blocos
    const resize = new ResizeObserver(() => updateMarks.current());
    const created = crepe.create().then(() => {
      loaded = crepe.getMarkdown();
      lastRef.current = loaded;
      ready = true;
      if (root.current) resize.observe(root.current);
      updateMarks.current();
      readyRef.current?.();
    });
    const rootElement = root.current;
    return () => {
      rootElement?.removeEventListener('click', openUploader);
      rootElement?.removeEventListener('keydown', historyKeys, true);
      resize.disconnect();
      cancelAnimationFrame(frame);
      created.then(() => crepe.destroy());
    };
  }, [initialValue]);

  useEffect(() => updateMarks.current(), [problemLines, showsSavedVersion]);

  useImperativeHandle(ref, () => ({
    search: query => search(crepeRef.current!.editor.ctx.get(editorViewCtx), query),
    moveSearch: delta => moveSearch(crepeRef.current!.editor.ctx.get(editorViewCtx), delta),
    getMarkdown: () => crepeRef.current!.getMarkdown(),
    insertMarkdown: markdown => crepeRef.current!.editor.action(insert(markdown)),
    setMarkdown: markdown => {
      const crepe = crepeRef.current!;
      crepe.editor.action(ctx => {
        const view = ctx.get(editorViewCtx);
        const tr = replaceChanged(view.state, ctx.get(parserCtx)(markdown));
        if (!tr) return;
        applyingExternal.current = true;
        try {
          view.dispatch(tr.setMeta('addToHistory', false));
        } finally {
          applyingExternal.current = false;
        }
      });
      lastRef.current = crepe.getMarkdown();
    },
    pendingChange: () => {
      const previous = lastRef.current;
      if (previous === undefined) return undefined;
      const markdown = crepeRef.current!.getMarkdown();
      return markdown === previous ? undefined : { markdown, previous };
    },
    flushChange: () => notifyRef.current(),
  }));

  return (
    <div ref={container} className="docs-editor">
      <div ref={root} />
      {marks.map((mark, i) => (
        <span
          key={i}
          className={`docs-editor-line${mark.problem ? ' docs-editor-problem' : ''}${onLineClick ? ' docs-editor-line-link' : ''}`}
          style={{ top: mark.top }}
          title={lineTitle?.(mark.line, mark.problem) ?? (mark.problem ? text.problemMark : undefined)}
          {...(onLineClick && {
            role: 'button',
            tabIndex: 0,
            onClick: () => onLineClick(mark.line),
            onKeyDown: (event: ReactKeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onLineClick(mark.line);
            },
          })}
        >
          {mark.problem ? '● ' : ''}
          {mark.line}
        </span>
      ))}
    </div>
  );
},
);
