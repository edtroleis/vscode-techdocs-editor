import type { Mermaid } from 'mermaid';
import { type DiagramViewerText, openDiagramViewer } from './diagramViewer';
import { diagramKind, diagramSince } from './diagramTemplates';
import { isFlowchart } from './flowchartEdit';

/** Tipos que o Mermaid só desenha com um complemento à parte, que nem o editor nem o Backstage carregam (M32). */
const UNSUPPORTED: Record<string, string> = { zenuml: 'ZenUML' };

/**
 * Diagramas Mermaid no editor visual (spec 06): a prévia do bloco de código do Crepe desenha os blocos
 * `mermaid`. A biblioteca é grande e só é carregada no primeiro diagrama (import dinâmico: o pacote da
 * abertura não muda). Os desenhos saem um de cada vez, na ordem pedida: uma página com muitos diagramas
 * não trava a digitação, e o último texto de um bloco é sempre o último desenhado.
 */

export type MermaidTheme = 'dark' | 'default';

/** Textos da prévia, no idioma da pessoa. */
export type DiagramText = {
  /** Título do erro de sintaxe; `line` é a linha no código do diagrama, quando o Mermaid diz. */
  error: (line?: number) => string;
  /** Dica embaixo do desenho (M10). */
  hint: string;
  /** Dica dos fluxogramas, que também têm a barra do nó (M12). */
  flowHint: string;
  /** Aviso dos tipos novos do Mermaid, que o TechDocs só desenha numa versão mais nova (M23). */
  sinceWarning: (since: string) => string;
  /** Diagrama maior que os limites do Mermaid (M27). */
  tooBig: string;
  /** Diagrama largo para a página do TechDocs (M32). */
  wide: WideDiagramText;
  /** Tipo que nem o editor nem o Backstage desenham, como o ZenUML (M32). */
  unsupported: (kind: string) => string;
  /** Botão Ampliar e janela de zoom (M28). */
  viewer: DiagramViewerText;
  /** Botão que apaga o bloco do diagrama (M30). */
  remove: string;
};

/** Aviso do diagrama largo para o TechDocs e os botões dele (M32). */
export type WideDiagramText = {
  warning: (percent: number) => string;
  /** Mostra o desenho na largura da página do TechDocs, e volta. */
  asTechdocs: string;
  asEditor: string;
  /** Troca `LR`/`RL` por `TD` no fluxograma. */
  turn: string;
};

/**
 * Largura do texto da página do TechDocs no Backstage (M32): a janela menos uns 814 px dos menus (466 px numa tela de
 * 1280, 626 em 1440, 1106 em 1920; medido na vitrine, spec 03). 700 é uma janela de uns 1500 px. O addon do Mermaid
 * encolhe o desenho até caber, e o Backstage não tem zoom.
 */
export const TECHDOCS_WIDTH = 700;
/** Abaixo desta escala no TechDocs o texto do diagrama fica pequeno (16 px viram menos de 11). */
const TECHDOCS_MIN_SCALE = 0.7;

/** Quanto do tamanho o diagrama de largura natural `width` tem no TechDocs (1 se cabe). */
export const techdocsScale = (width: number) => Math.min(1, TECHDOCS_WIDTH / width);

/** Fluxograma desenhado da esquerda para a direita (ou ao contrário): dá para virar com um clique. */
export const sidewaysFlowchart = (code: string) =>
  /^\s*(?:---\r?\n[\s\S]*?\r?\n---[^\n]*\n)?(?:\s*%%[^\n]*\n)*\s*(?:flowchart|graph)[ \t]+(?:LR|RL)\b/i.test(code);

/** O código com o fluxograma de cima para baixo (só a direção da primeira linha do diagrama). */
export const turnTopDown = (code: string) => code.replace(/^(\s*(?:---\r?\n[\s\S]*?\r?\n---[^\n]*\n)?(?:\s*%%[^\n]*\n)*\s*(?:flowchart|graph)[ \t]+)(?:LR|RL)\b/i, '$1TD');

/** Aviso do diagrama largo, com os botões; o clique é tratado em diagramWide.ts (o Crepe copia a prévia sem listeners). */
function wideWarning(text: DiagramText, width: number, code: string): HTMLElement | undefined {
  const scale = techdocsScale(width);
  if (scale >= TECHDOCS_MIN_SCALE) return undefined;
  const warning = document.createElement('div');
  warning.className = 'mermaid-warning mermaid-wide';
  const message = document.createElement('p');
  message.textContent = `⚠ ${text.wide.warning(Math.round(scale * 100))}`;
  const actions = document.createElement('p');
  actions.className = 'mermaid-wide-actions';
  const size = document.createElement('button');
  size.type = 'button';
  size.className = 'mermaid-wide-size';
  size.textContent = text.wide.asTechdocs;
  size.dataset.asTechdocs = text.wide.asTechdocs;
  size.dataset.asEditor = text.wide.asEditor;
  actions.append(size);
  if (sidewaysFlowchart(code)) {
    const turn = document.createElement('button');
    turn.type = 'button';
    turn.className = 'mermaid-wide-turn';
    turn.textContent = text.wide.turn;
    actions.append(turn);
  }
  warning.append(message, actions);
  return warning;
}

export const TRASH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

/**
 * Os botões do desenho (M28): Ampliar, se há desenho. O Excluir (M30) fica na barra do bloco, ao lado do Editar e do
 * Ver diagrama (diagramDelete.ts).
 */
function blockActions(text: DiagramText, zoom: boolean): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'mermaid-actions';
  if (zoom) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mermaid-zoom';
    open.textContent = text.viewer.open;
    open.title = text.viewer.open;
    actions.append(open);
  }
  return actions;
}

/** Desenho maior que isto (largura ou altura natural) não cabe bem no bloco: o botão Ampliar fica sempre à vista. */
const BIG_WIDTH = 900;
const BIG_HEIGHT = 600;

/**
 * O botão Ampliar (M28) por delegação: o Crepe copia a prévia como HTML (`innerHTML`), sem os listeners. O texto é o
 * da última prévia criada (um editor por página).
 */
let viewerText: DiagramViewerText | undefined;
let zoomListening = false;
function listenZoom() {
  if (zoomListening || typeof document === 'undefined') return;
  zoomListening = true;
  const target = (event: Event) =>
    event.target instanceof Element ? event.target.closest<HTMLElement>('.milkdown .mermaid-zoom') : null;
  // Sem o mousedown, o ProseMirror põe o cursor no bloco
  document.addEventListener(
    'mousedown',
    event => {
      if (!target(event)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  document.addEventListener(
    'click',
    event => {
      const zoom = target(event);
      if (!zoom || !viewerText) return;
      event.preventDefault();
      event.stopPropagation();
      const drawn = zoom.closest('.mermaid-view')?.querySelector<SVGSVGElement>('.mermaid-diagram > svg');
      if (drawn) openDiagramViewer(drawn, viewerText, zoom);
    },
    true,
  );
}

/**
 * Limites do Mermaid (os padrões, que o site também usa): acima de 50 mil caracteres ele desenha um aviso no lugar do
 * diagrama, e acima de 500 ligações dá erro ao desenhar (M27).
 */
export const MAX_DIAGRAM_TEXT = 50_000;
const TOO_BIG = 'techdocs:diagram-too-big';
const isTooBig = (message: string) => message === TOO_BIG || /^Edge limit exceeded/.test(message);

/**
 * Menor escala de um desenho largo (M27): abaixo dela o texto fica pequeno demais para ler, e o bloco rola para o
 * lado. O `min-width` vai no SVG (a largura natural vem do `viewBox`).
 */
export const MIN_DIAGRAM_SCALE = 0.6;
export function readableSvg(svg: string): string {
  const width = Number(/<svg[^>]*\sviewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/.exec(svg)?.[1]);
  if (!width) return svg;
  const min = `min-width: ${Math.round(width * MIN_DIAGRAM_SCALE)}px;`;
  return /<svg[^>]*\sstyle="/.test(svg.slice(0, svg.indexOf('>') + 1))
    ? svg.replace(/(<svg[^>]*\sstyle=")/, `$1${min} `)
    : svg.replace('<svg', `<svg style="${min}"`);
}

/** Erro de sintaxe de um bloco: a linha no arquivo e a mensagem do Mermaid. */
export type DiagramError = { line: number; message: string };

let theme: MermaidTheme = 'default';
let loading: Promise<Mermaid> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let renders = 0;
/**
 * Código de cada diagrama desenhado, pelo `id` do SVG, para redesenhar na troca de tema. Não dá para guardar num
 * atributo do elemento: o Crepe passa a prévia pelo DOMPurify, que tira atributos com `-->` (setas do Mermaid).
 */
const sources = new Map<string, string>();

const configure = (mermaid: Mermaid) =>
  mermaid.initialize({
    startOnLoad: false,
    // strict: rótulos sem HTML e `click` sem javascript:
    securityLevel: 'strict',
    // Os temas coloridos do mermaid.js.org (M24), no claro e no escuro
    theme: theme === 'dark' ? 'redux-dark-color' : 'redux-color',
    // A fonte do editor (no VS Code, a da interface): a dos temas redux não vem no webview, e o texto media errado
    ...(typeof document !== 'undefined' && document.body && { fontFamily: getComputedStyle(document.body).fontFamily }),
    suppressErrorRendering: true,
  });

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then(
    module => {
      configure(module.default);
      return module.default;
    },
    error => {
      // Sem cache da falha: o próximo diagrama tenta carregar de novo
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** Tempo máximo de um desenho ou validação: um que nunca termina não pode travar os seguintes. */
const TASK_TIMEOUT_MS = 10_000;

/**
 * Roda `task` depois dos pedidos já feitos. Antes de cada um, devolve a vez ao navegador (o desenho do Mermaid é
 * trabalho síncrono: em sequência, sem pausa, as teclas digitadas esperariam a fila inteira).
 */
function enqueue<T>(task: (mermaid: Mermaid) => Promise<T>): Promise<T> {
  const run = queue
    .then(() => new Promise(resolve => setTimeout(resolve)))
    .then(() => load())
    .then(mermaid => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mermaid: tempo esgotado')), TASK_TIMEOUT_MS);
      });
      return Promise.race([task(mermaid), timeout]).finally(() => clearTimeout(timer));
    });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Linha do erro no código do diagrama ("Parse error on line 3"). Um erro no fim do texto vem com a linha
 * seguinte à última: fica a última.
 */
const errorLine = (message: string, code: string) => {
  const match = /line (\d+)/i.exec(message);
  return match ? Math.min(Number(match[1]), code.trimEnd().split('\n').length) : undefined;
};

/** As linhas do erro que mostram onde o Mermaid parou (sem a primeira, "Parse error on line N:"). */
const errorDetail = (message: string) => {
  const lines = message.split('\n');
  return (/^Parse error/i.test(lines[0]) ? lines.slice(1, 3) : lines.slice(0, 2)).join('\n');
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Últimos desenhos, por tema e código: voltar a um texto (desfazer, um bloco remontado ao rolar) não redesenha. */
const drawn = new Map<string, { id: string; svg: string }>();
const DRAWN_LIMIT = 50;

/** Valida e desenha o diagrama (ou devolve o desenho já feito com o mesmo tema e código). */
async function drawCached(mermaid: Mermaid, code: string): Promise<string> {
  const key = `${theme}\n${code}`;
  const cached = drawn.get(key);
  if (cached) {
    // O código pode ter saído do mapa enquanto o desenho estava fora da página
    sources.set(cached.id, code);
    return cached.svg;
  }
  // Acima do limite o Mermaid desenha um aviso dele, em inglês, no lugar do diagrama
  if (code.length > MAX_DIAGRAM_TEXT) throw new Error(TOO_BIG);
  // Valida antes: o render de um texto com erro desenha a "bomba" de erro do Mermaid
  await mermaid.parse(code);
  const id = `techdocs-mermaid-${++renders}`;
  try {
    const { svg } = await mermaid.render(id, code);
    drawn.set(key, { id, svg });
    if (drawn.size > DRAWN_LIMIT) drawn.delete(drawn.keys().next().value!);
    sources.set(id, code);
    // Cada redesenho (a cada tecla no código) gera um id novo: esquece os que já saíram da página
    if (sources.size > 100) for (const old of sources.keys()) if (old !== id && !document.getElementById(old)) sources.delete(old);
    return svg;
  } finally {
    // O Mermaid desenha num elemento temporário do body; se falhar no meio, ele fica para trás
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

function diagramElement(svg: string, text: DiagramText, code: string): HTMLElement {
  // O botão fica fora do .mermaid-diagram, que rola para o lado: assim ele não sai do canto
  const view = document.createElement('div');
  view.className = 'mermaid-view';
  const element = document.createElement('div');
  element.className = 'mermaid-diagram';
  element.innerHTML = readableSvg(svg);
  const size = /<svg[^>]*\sviewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (size && (Number(size[1]) > BIG_WIDTH || Number(size[2]) > BIG_HEIGHT)) view.classList.add('mermaid-big');
  view.append(blockActions(text, true), element);
  const hint = document.createElement('p');
  hint.className = 'mermaid-hint';
  hint.textContent = isFlowchart(code) ? text.flowHint : text.hint;
  element.append(hint);
  const wide = size ? wideWarning(text, Number(size[1]), code) : undefined;
  if (wide) {
    view.classList.add('mermaid-wide-view');
    element.append(wide);
  }
  const since = diagramSince(code);
  if (since) {
    const warning = document.createElement('p');
    warning.className = 'mermaid-warning';
    warning.textContent = `⚠ ${text.sinceWarning(since)}`;
    element.append(warning);
  }
  return view;
}

function errorElement(text: DiagramText, message: string, code: string): HTMLElement {
  // Um diagrama com erro também pode ser excluído
  const view = document.createElement('div');
  view.className = 'mermaid-view';
  const element = document.createElement('div');
  element.className = 'mermaid-error';
  element.setAttribute('role', 'alert');
  view.append(blockActions(text, false), element);
  const title = document.createElement('strong');
  if (isTooBig(message)) {
    title.textContent = text.tooBig;
    element.append(title);
    return view;
  }
  // Tipo que é um complemento à parte (ZenUML): o Mermaid diz só "nenhum tipo de diagrama achado"
  const unsupported = UNSUPPORTED[diagramKind(code)];
  if (unsupported) {
    title.textContent = text.unsupported(unsupported);
    element.append(title);
    return view;
  }
  title.textContent = text.error(errorLine(message, code));
  const detail = document.createElement('pre');
  detail.textContent = errorDetail(message);
  element.append(title, detail);
  return view;
}

/** Desenha (ou explica o erro de) um diagrama. */
async function render(mermaid: Mermaid, code: string, text: DiagramText): Promise<HTMLElement> {
  try {
    return diagramElement(await drawCached(mermaid, code), text, code);
  } catch (error) {
    return errorElement(text, messageOf(error), code);
  }
}

/**
 * O `renderPreview` do bloco de código do Crepe: só os blocos `mermaid` com código têm prévia (`null` nos
 * outros); o desenho chega depois, por `apply`.
 */
export const mermaidPreview =
  (text: DiagramText) =>
  (language: string, content: string, apply: (value: null | string | HTMLElement) => void): null | undefined => {
    if (language.trim().toLowerCase() !== 'mermaid' || !content.trim()) return null;
    viewerText = text.viewer;
    listenZoom();
    enqueue(mermaid => render(mermaid, content, text)).then(apply, () => apply(null));
    return undefined;
  };

/** Miniaturas da galeria (M22), por tema e código: à parte, para não tirar do cache os desenhos da página. */
const thumbnails = new Map<string, Promise<string>>();
/** Uma miniatura por vez na fila dos desenhos: os diagramas da página pedidos no meio passam na frente das outras. */
let thumbnailTurn: Promise<unknown> = Promise.resolve();

/** Desenha `code` fora de um bloco (miniatura da galeria): o SVG, ou erro se o código não for válido. */
export function drawThumbnail(code: string): Promise<string> {
  const key = `${theme}\n${code}`;
  const cached = thumbnails.get(key);
  if (cached) return cached;
  const run = thumbnailTurn.then(() =>
    enqueue(async mermaid => {
      const id = `techdocs-mermaid-thumb-${++renders}`;
      try {
        return (await mermaid.render(id, code)).svg;
      } finally {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    }),
  );
  thumbnailTurn = run.catch(() => undefined);
  thumbnails.set(key, run);
  run.catch(() => thumbnails.delete(key));
  return run;
}

/** Troca o tema dos diagramas e redesenha os que estão na tela, um por vez na fila. */
export function setMermaidTheme(next: MermaidTheme) {
  if (next === theme) return;
  theme = next;
  if (!loading) return;
  void enqueue(async mermaid => configure(mermaid));
  for (const svg of document.querySelectorAll<SVGElement>('.mermaid-diagram > svg[id]')) {
    const code = sources.get(svg.id);
    if (code === undefined) continue;
    // Se falhar, fica o desenho com o tema anterior
    void enqueue(async mermaid => {
      const redrawn = await drawCached(mermaid, code);
      // Só o SVG: a dica embaixo dele fica
      if (svg.isConnected && svg.parentElement) svg.outerHTML = readableSvg(redrawn);
    }).catch(() => undefined);
  }
}

/** Se o código é um diagrama que o Mermaid aceita (pela fila, como os desenhos). */
export function isValidDiagram(code: string): Promise<boolean> {
  return enqueue(async mermaid => {
    try {
      await mermaid.parse(code);
      return true;
    } catch {
      return false;
    }
  });
}

/** Erros de sintaxe dos blocos, com a linha no arquivo (a do bloco + a linha do erro no diagrama). */
export function diagramErrors(blocks: { line: number; code: string }[]): Promise<DiagramError[]> {
  return enqueue(async mermaid => {
    const errors: DiagramError[] = [];
    for (const block of blocks) {
      if (!block.code.trim()) continue;
      try {
        await mermaid.parse(block.code);
      } catch (error) {
        const message = messageOf(error);
        const line = errorLine(message, block.code);
        const detail = errorDetail(message);
        errors.push({ line: block.line + (line ? line - 1 : 0), message: [message.split('\n')[0], detail].filter(Boolean).join('\n') });
      }
    }
    return errors;
  });
}
