import type { DiagramViewerText } from './diagramViewer';
import { commandsCtx } from '@milkdown/kit/core';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import { DIAGRAM_GROUPS, DIAGRAM_TEMPLATES, type DiagramGroup } from './diagramTemplates';
import type { DiagramBarText } from './diagramNodeBar';
import type { FlowchartWords } from './flowchartEdit';
import { insertDiagram } from './insertDiagram';
import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import type { ToolbarFeatureConfig } from '@milkdown/crepe/feature/toolbar';

/** Um modelo de diagrama do menu "/" e da galeria (spec 06, M11 e M21). */
export type DiagramTemplate = {
  key: string;
  group: DiagramGroup;
  label: string;
  sample: string;
  icon: string;
  /** Tipo novo do Mermaid: versão mínima que o TechDocs precisa (M23). */
  since?: string;
};

/** Textos da galeria de diagramas (M22) e do aviso dos tipos novos (M23). */
export type DiagramGalleryText = {
  title: string;
  all: string;
  search: string;
  close: string;
  groups: Record<DiagramGroup, string>;
  /** Etiqueta curta do tipo novo ("Backstage 11.16+") e a explicação dela. */
  sinceChip: (since: string) => string;
  sinceTitle: (since: string) => string;
};

/** Busca um texto traduzido pela chave (ex.: "editorText.quote"), com as variáveis. */
export type TextLookup = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Textos do editor visual (o Crepe vem em inglês e não usa a tradução do Backstage). Montados por
 * quem usa o editor, a partir da tradução (`editorTextFrom`).
 */
export type EditorText = {
  placeholder: string;
  paragraph: string;
  heading: (level: number) => string;
  text: string;
  lists: string;
  others: string;
  bulletList: string;
  orderedList: string;
  taskList: string;
  image: string;
  codeBlock: string;
  /** Botões do bloco de código e da prévia dos diagramas Mermaid (spec 06). */
  code: { copy: string; preview: string };
  diagram: {
    label: string;
    sample: string;
    edit: string;
    show: string;
    hint: string;
    /** Dica dos fluxogramas, que têm a barra do nó (M12). */
    flowHint: string;
    error: (line?: number) => string;
    /** Os modelos do menu "/" e da galeria (M11, M21), nesta ordem. */
    templates: DiagramTemplate[];
    gallery: DiagramGalleryText;
    /** Aviso embaixo do desenho de um tipo novo do Mermaid (M23). */
    sinceWarning: (since: string) => string;
    /** Diagrama maior que os limites do Mermaid (M27). */
    tooBig: string;
    /** Botão Ampliar e janela de zoom (M28). */
    viewer: DiagramViewerText;
    /** Barra do nó no fluxograma (M12–M16). */
    bar: DiagramBarText;
    /** Textos que a barra põe no código. */
    words: FlowchartWords;
  };
  table: string;
  quote: string;
  divider: string;
  bold: string;
  italic: string;
  strikethrough: string;
  inlineCode: string;
  link: string;
  linkPlaceholder: string;
  linkOutsideMenu: string;
  topBar: { bold: string; italic: string; table: string; divider: string; undo: string; redo: string };
  uploadImage: string;
  uploadImageInline: string;
  imageUrlPlaceholder: string;
  imageUrlPlaceholderInline: string;
  imageCaption: string;
  problemMark: string;
};

export function editorTextFrom(t: TextLookup): EditorText {
  const k = (key: string) => t(`editorText.${key}`);
  return {
    placeholder: k('placeholder'),
    paragraph: k('paragraph'),
    heading: level => t('editorText.heading', { level }),
    text: k('text'),
    lists: k('lists'),
    others: k('others'),
    bulletList: k('bulletList'),
    orderedList: k('orderedList'),
    taskList: k('taskList'),
    image: k('image'),
    codeBlock: k('codeBlock'),
    code: { copy: k('codeCopy'), preview: k('codePreview') },
    diagram: {
      label: k('diagram'),
      sample: k('diagramSample'),
      edit: k('diagramEdit'),
      show: k('diagramShow'),
      hint: k('diagramHint'),
      flowHint: k('diagramFlowHint'),
      templates: DIAGRAM_TEMPLATES.map(({ key, name, group, icon, since }) => ({
        key,
        group,
        icon,
        since,
        label: k(`diagram${name}`),
        sample: k(key === 'flow' ? 'diagramSample' : `diagramSample${name}`),
      })),
      gallery: {
        title: k('diagramGalleryTitle'),
        all: k('diagramGalleryAll'),
        search: k('diagramGallerySearch'),
        close: k('diagramGalleryClose'),
        groups: {
          flows: k('diagramGroupFlows'),
          structure: k('diagramGroupStructure'),
          planning: k('diagramGroupPlanning'),
          charts: k('diagramGroupCharts'),
          ideas: k('diagramGroupIdeas'),
        },
        sinceChip: since => t('editorText.diagramSinceChip', { since }),
        sinceTitle: since => t('editorText.diagramSinceTitle', { since }),
      },
      tooBig: k('diagramTooBig'),
      viewer: {
        open: k('diagramZoom'),
        title: k('diagramZoomTitle'),
        zoomIn: k('diagramZoomIn'),
        zoomOut: k('diagramZoomOut'),
        fit: k('diagramZoomFit'),
        actualSize: k('diagramZoomActual'),
        close: k('diagramGalleryClose'),
        help: k('diagramZoomHelp'),
      },
      sinceWarning: since =>
        since.startsWith('12') ? k('diagramMermaid12Warning') : t('editorText.diagramSinceWarning', { since }),
      error: line => (line ? t('editorText.diagramErrorLine', { line }) : k('diagramError')),
      bar: {
        step: k('diagramStepAfter'),
        decision: k('diagramAddDecision'),
        connect: k('diagramConnect'),
        remove: k('diagramDelete'),
        connectHint: k('diagramConnectHint'),
        dragHint: k('diagramDragHint'),
        failed: k('diagramEditFailed'),
      },
      words: { step: k('diagramNewStep'), decision: k('diagramNewDecision'), yes: k('diagramYes'), no: k('diagramNo') },
    },
    table: k('table'),
    quote: k('quote'),
    divider: k('divider'),
    bold: k('bold'),
    italic: k('italic'),
    strikethrough: k('strikethrough'),
    inlineCode: k('inlineCode'),
    link: k('link'),
    linkPlaceholder: k('linkPlaceholder'),
    linkOutsideMenu: k('linkOutsideMenu'),
    topBar: {
      bold: k('topBar.bold'),
      italic: k('topBar.italic'),
      table: k('topBar.table'),
      divider: k('topBar.divider'),
      undo: k('topBar.undo'),
      redo: k('topBar.redo'),
    },
    uploadImage: k('uploadImage'),
    uploadImageInline: k('uploadImageInline'),
    imageUrlPlaceholder: k('imageUrlPlaceholder'),
    imageUrlPlaceholderInline: k('imageUrlPlaceholderInline'),
    imageCaption: k('imageCaption'),
    problemMark: k('problemMark'),
  };
}

/** Opções do seletor de título da barra fixa. */
export const headingOptions = (text: EditorText) => [
  { label: text.paragraph, level: null },
  ...[1, 2, 3, 4, 5, 6].map(level => ({ label: text.heading(level), level })),
];

/** Menu "/" (o filtro do menu usa estes nomes: "/tab" acha "Tabela"). */
export const slashMenu = (text: EditorText): BlockEditFeatureConfig => ({
  textGroup: {
    label: text.text,
    text: { label: text.text },
    h1: { label: text.heading(1) },
    h2: { label: text.heading(2) },
    h3: { label: text.heading(3) },
    h4: { label: text.heading(4) },
    h5: { label: text.heading(5) },
    h6: { label: text.heading(6) },
    quote: { label: text.quote },
    divider: { label: text.divider },
  },
  listGroup: {
    label: text.lists,
    bulletList: { label: text.bulletList },
    orderedList: { label: text.orderedList },
    taskList: { label: text.taskList },
  },
  advancedGroup: {
    label: text.others,
    image: { label: text.image },
    codeBlock: { label: text.codeBlock },
    table: { label: text.table },
  },
  // Os modelos de diagrama Mermaid (spec 06, M4, M11 e M21), um grupo do menu para cada tipo de assunto. O menu do
  // Crepe só filtra pelo nome: "Diagrama: …" faz "/diagrama" achar todos
  buildMenu: builder => {
    for (const group of DIAGRAM_GROUPS) {
      const added = builder.addGroup(`diagrams-${group}`, text.diagram.gallery.groups[group]);
      for (const template of text.diagram.templates.filter(t => t.group === group)) {
        added.addItem(`mermaid-${template.key}`, {
          label: template.label,
          icon: template.icon,
          onRun: ctx => {
            ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
            insertDiagram(ctx, template.sample);
          },
        });
      }
    }
  },
});

/** Toolbar que aparece sobre o texto selecionado. */
export const selectionToolbar = (text: EditorText): ToolbarFeatureConfig => ({
  boldLabel: text.bold,
  italicLabel: text.italic,
  strikethroughLabel: text.strikethrough,
  codeLabel: text.inlineCode,
  linkLabel: text.link,
});

/**
 * Nome de cada botão da barra fixa, na ordem em que aparecem (Crepe + topBar.ts). O Crepe não
 * aceita nome nesses botões: sem isto eram só ícones, sem dica ao passar o mouse nem nome para
 * leitor de tela.
 */
const topBarLabels = (text: EditorText) => [
  text.topBar.bold,
  text.topBar.italic,
  text.strikethrough,
  text.inlineCode,
  text.bulletList,
  text.orderedList,
  text.taskList,
  text.link,
  text.image,
  text.topBar.table,
  text.codeBlock,
  text.diagram.label,
  text.quote,
  text.topBar.divider,
  text.topBar.undo,
  text.topBar.redo,
];

/** Põe nome (title e aria-label) nos botões da barra fixa dentro de `root`. */
export function labelTopBar(root: HTMLElement, text: EditorText) {
  const labels = topBarLabels(text);
  root.querySelectorAll<HTMLElement>('.top-bar-item').forEach((button, i) => {
    const label = labels[i];
    if (label && button.title !== label) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  });
}

/** Textos da busca (Ctrl+F) e das marcas de problema da visão Markdown (frases do CodeMirror). */
export const markdownViewPhrases = (t: TextLookup): Record<string, string> => {
  const k = (key: string) => t(`markdownView.${key}`);
  return {
    Find: k('find'),
    Replace: k('replace'),
    next: k('next'),
    previous: k('previous'),
    all: k('all'),
    'match case': k('matchCase'),
    'by word': k('byWord'),
    regexp: k('regexp'),
    replace: k('replaceOne'),
    'replace all': k('replaceAll'),
    close: k('close'),
    'current match': k('currentMatch'),
    'on line': k('onLine'),
    'Go to line': k('goToLine'),
    go: k('go'),
    Diagnostics: k('diagnostics'),
    'No diagnostics': k('noDiagnostics'),
  };
};
