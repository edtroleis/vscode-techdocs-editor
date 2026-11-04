import type { Mermaid } from 'mermaid';

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
};

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
  // strict: rótulos sem HTML e `click` sem javascript:
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, suppressErrorRendering: true });

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then(module => {
    configure(module.default);
    return module.default;
  });
  return loading;
}

/** Roda `task` depois dos desenhos já pedidos. */
function enqueue<T>(task: (mermaid: Mermaid) => Promise<T>): Promise<T> {
  const run = queue.then(() => load()).then(task);
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

async function draw(mermaid: Mermaid, code: string): Promise<string> {
  const id = `techdocs-mermaid-${++renders}`;
  try {
    const { svg } = await mermaid.render(id, code);
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

function diagramElement(svg: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'mermaid-diagram';
  element.innerHTML = svg;
  return element;
}

function errorElement(text: DiagramText, message: string, code: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'mermaid-error';
  element.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = text.error(errorLine(message, code));
  const detail = document.createElement('pre');
  detail.textContent = errorDetail(message);
  element.append(title, detail);
  return element;
}

/** Desenha (ou explica o erro de) um diagrama. */
async function render(mermaid: Mermaid, code: string, text: DiagramText): Promise<HTMLElement> {
  try {
    // Valida antes: o render de um texto com erro desenha a "bomba" de erro do Mermaid
    await mermaid.parse(code);
  } catch (error) {
    return errorElement(text, error instanceof Error ? error.message : String(error), code);
  }
  try {
    return diagramElement(await draw(mermaid, code));
  } catch (error) {
    return errorElement(text, error instanceof Error ? error.message : String(error), code);
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
    enqueue(mermaid => render(mermaid, content, text)).then(apply, () => apply(null));
    return undefined;
  };

/** Troca o tema dos diagramas e redesenha os que estão na tela. */
export function setMermaidTheme(next: MermaidTheme) {
  if (next === theme) return;
  theme = next;
  if (!loading) return;
  void enqueue(async mermaid => {
    configure(mermaid);
    const shown = new Set<string>();
    for (const svg of document.querySelectorAll<SVGElement>('.mermaid-diagram > svg[id]')) {
      const code = sources.get(svg.id);
      if (code === undefined) continue;
      try {
        const next = await draw(mermaid, code);
        const holder = svg.parentElement;
        if (holder) holder.innerHTML = next;
        shown.add(holder?.firstElementChild?.id ?? '');
      } catch {
        // O texto já tinha desenhado com o outro tema: fica o desenho anterior
        shown.add(svg.id);
      }
    }
    // Esquece os diagramas que saíram da página
    for (const id of sources.keys()) if (!shown.has(id)) sources.delete(id);
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
        const message = error instanceof Error ? error.message : String(error);
        const line = errorLine(message, block.code);
        errors.push({ line: block.line + (line ? line - 1 : 0), message: message.split('\n')[0] + (errorDetail(message) ? `\n${errorDetail(message)}` : '') });
      }
    }
    return errors;
  });
}
