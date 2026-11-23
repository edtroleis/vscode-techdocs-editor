import { isMap, isScalar, isSeq, parseDocument, type Document, type Node, type YAMLMap, type YAMLSeq } from 'yaml';

/** Bloco de diagrama Mermaid de uma página: o código e a linha (1-based) em que ele começa no arquivo. */
export type MermaidBlock = { line: number; code: string };

/** Blocos cercados com a linguagem `mermaid` (crases ou tis), fora de outros blocos de código. */
export function mermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: string | undefined;
  let current: { line: number; code: string[] } | undefined;
  lines.forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        if (current) blocks.push({ line: current.line, code: current.code.join('\n') });
        fence = undefined;
        current = undefined;
      } else {
        current?.code.push(line);
      }
    } else if (marker) {
      fence = marker[1];
      if (/^mermaid(\s|$)/i.test(marker[2].trim())) current = { line: index + 2, code: [] };
    }
  });
  return blocks;
}

const SUPERFENCES = 'pymdownx.superfences';

/** Entrada do `custom_fences` (spec 06), com as linhas a partir da coluna 0. */
const MERMAID_FENCE = ['- name: mermaid', '  class: mermaid', '  format: !!python/name:pymdownx.superfences.fence_code_format'];

const indent = (lines: string[], spaces: number) => lines.map(l => ' '.repeat(spaces) + l).join('\n') + '\n';

/** Item `pymdownx.superfences` (texto puro ou mapa) da lista `markdown_extensions`. */
function superfencesItem(seq: YAMLSeq): Node | undefined {
  return seq.items.find(item => {
    if (isScalar(item)) return item.value === SUPERFENCES;
    return isMap(item) && item.has(SUPERFENCES);
  }) as Node | undefined;
}

/** O `markdown_extensions` tem o bloco personalizado `mermaid` no `pymdownx.superfences`. */
function hasFence(doc: Document): boolean {
  const extensions = doc.get('markdown_extensions', true);
  if (!isSeq(extensions)) return false;
  const item = superfencesItem(extensions);
  if (!isMap(item)) return false;
  const options = item.get(SUPERFENCES, true);
  const fences = isMap(options) ? options.get('custom_fences', true) : undefined;
  return isSeq(fences) && fences.items.some(f => isMap(f) && f.get('name') === 'mermaid');
}

export const hasMermaidFence = (yml: string): boolean => hasFence(parseDocument(yml));

/** Coluna do começo da linha em que `offset` está. */
const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
/** Coluna de `offset` na linha dele. */
const column = (text: string, offset: number) => offset - lineStart(text, offset);
/** Começo da linha depois do conteúdo que termina em `offset` (o fim do texto, com uma quebra, se for a última). */
function afterLine(text: string, offset: number): { text: string; at: number } {
  const newline = text.indexOf('\n', Math.max(offset - 1, 0));
  if (newline === -1) return { text: `${text}\n`, at: text.length + 1 };
  return { text, at: newline + 1 };
}
const insertAt = (text: string, offset: number, piece: string) => {
  const target = afterLine(text, offset);
  return target.text.slice(0, target.at) + piece + target.text.slice(target.at);
};

/**
 * Acrescenta ao `mkdocs.yml` a configuração do Mermaid da spec 06 (o bloco `mermaid` do `pymdownx.superfences`).
 * Mexe só no trecho novo: o resto do texto (comentários, tags do MkDocs) fica igual. Aplicar de novo não muda nada.
 */
export function addMermaidFence(yml: string): string {
  const doc = parseDocument(yml);
  if (hasFence(doc)) return yml;
  const extensions = doc.get('markdown_extensions', true);
  const entry = (spaces: number) => indent(MERMAID_FENCE, spaces);
  const superfences = (spaces: number) =>
    indent([`- ${SUPERFENCES}:`, '    custom_fences:'], spaces) + entry(spaces + 6);

  // Sem a chave: ela inteira no fim
  if (!doc.has('markdown_extensions')) return `${yml && !yml.endsWith('\n') ? `${yml}\n` : yml}markdown_extensions:\n${superfences(2)}`;
  if (!isSeq(extensions) || !extensions.items.length || extensions.flow) return rewrite(doc);

  const dash = (node: Node) => column(yml, node.range![0]) - 2;
  const first = extensions.items[0] as Node;
  const item = superfencesItem(extensions);

  // Sem o superfences: um item novo no fim da lista
  if (!item) return insertAt(yml, extensions.range![1], superfences(dash(first)));

  // `- pymdownx.superfences` sem opções: a linha vira o item com as opções
  if (isScalar(item)) {
    const start = lineStart(yml, item.range![0]);
    const end = afterLine(yml, item.range![1]);
    return end.text.slice(0, start) + superfences(dash(item)) + end.text.slice(end.at);
  }

  const options = (item as YAMLMap).get(SUPERFENCES, true);
  if (isMap(options) && !options.flow && options.items.length) {
    const fences = options.get('custom_fences', true);
    // Já tem outros blocos: a entrada no fim da lista
    if (isSeq(fences) && !fences.flow && fences.items.length) {
      return insertAt(yml, fences.range![1], entry(column(yml, (fences.items[0] as Node).range![0]) - 2));
    }
    // Outras opções, sem custom_fences: a chave no fim do mapa
    if (!options.has('custom_fences')) {
      const key = options.items[0].key as Node;
      const spaces = column(yml, key.range![0]);
      return insertAt(yml, options.range![1], indent(['custom_fences:'], spaces) + entry(spaces + 2));
    }
  }

  return rewrite(doc);
}

/** Formas raras (listas numa linha, valores vazios): acerta pela árvore do `yaml` e reescreve o arquivo. */
function rewrite(doc: Document): string {
  let extensions: unknown = doc.get('markdown_extensions', true);
  if (!isSeq(extensions)) {
    extensions = doc.createNode([]) as YAMLSeq;
    doc.set('markdown_extensions', extensions);
  }
  const seq = extensions as YAMLSeq;
  let item = superfencesItem(seq);
  if (!isMap(item)) {
    const fresh = doc.createNode({ [SUPERFENCES]: null }) as YAMLMap;
    if (item) seq.items[seq.items.indexOf(item as never)] = fresh as never;
    else seq.items.push(fresh as never);
    item = fresh;
  }
  const map = item as YAMLMap;
  let options: unknown = map.get(SUPERFENCES, true);
  if (!isMap(options)) {
    options = doc.createNode({}) as YAMLMap;
    map.set(SUPERFENCES, options);
  }
  let list: unknown = (options as YAMLMap).get('custom_fences', true);
  if (!isSeq(list)) {
    list = doc.createNode([]) as YAMLSeq;
    (options as YAMLMap).set('custom_fences', list);
  }
  const format = doc.createNode('');
  (format as { tag?: string }).tag = 'tag:yaml.org,2002:python/name:pymdownx.superfences.fence_code_format';
  (list as YAMLSeq).items.push(doc.createNode({ name: 'mermaid', class: 'mermaid', format }) as never);
  // Em bloco, como o resto do arquivo costuma estar (o `yaml` mantém a forma de uma linha se ela já era assim)
  for (const node of [seq, ...seq.items]) if (isMap(node) || isSeq(node)) node.flow = false;
  return doc.toString().replace(/(!!python\/name:[\w.]+) ""/g, '$1');
}

/**
 * Cores dos diagramas no site (spec 06, M25): o MkDocs Material desenha com o Mermaid que a página já tiver carregado
 * (senão baixa o 11) e com as cores dele. O site carrega o mesmo Mermaid do editor e um script que troca as cores do
 * Material pelos temas coloridos do editor (`redux-color`, `redux-dark-color`). No Backstage os scripts do site não
 * rodam: lá as cores vêm do addon de Mermaid (`techdocs.addons.mermaid` no app-config.yaml).
 */
/** O mesmo Mermaid do editor visual (o teste confere com a versão do pacote `ui`). */
export const MERMAID_SCRIPT_URL = 'https://unpkg.com/mermaid@12.2.0/dist/mermaid.min.js';
/** O script das cores, relativo ao `docs_dir`. */
export const MERMAID_COLORS_FILE = 'javascripts/techdocs-mermaid.js';

export const MERMAID_COLORS_SCRIPT = `// TechDocs Editor: diagramas Mermaid como no editor visual.
// O MkDocs Material usa o Mermaid carregado antes deste arquivo (extra_javascript do mkdocs.yml) e chama
// initialize com as cores dele: aqui elas dão lugar ao tema colorido (redux-color e redux-dark-color), claro ou
// escuro como a página, com a fonte da página. Um diagrama largo não encolhe abaixo de 60% (o texto fica legível)
// e rola para o lado. O botão Ampliar abre o desenho numa janela com zoom (roda do mouse), arrastar para mover,
// Ajustar e 100%.
(() => {
  const mermaid = window.mermaid;
  if (!mermaid || mermaid.techdocsEditorColors) return;
  const pt = /^pt/i.test(document.documentElement.lang);
  const T = pt
    ? { open: 'Ampliar', title: 'Diagrama', zoomIn: 'Aumentar (+)', zoomOut: 'Diminuir (−)', fit: 'Ajustar', one: 'Tamanho real (1)', close: 'Fechar (Esc)',
        help: 'Roda do mouse: zoom · arrastar: mover · setas: mover · + e −: zoom · 0: ajustar · Esc: fechar' }
    : { open: 'Enlarge', title: 'Diagram', zoomIn: 'Zoom in (+)', zoomOut: 'Zoom out (−)', fit: 'Fit', one: 'Actual size (1)', close: 'Close (Esc)',
        help: 'Mouse wheel: zoom · drag: move · arrows: move · + and −: zoom · 0: fit · Esc: close' };
  const initialize = mermaid.initialize.bind(mermaid);
  const scheme = () => document.body.getAttribute('data-md-color-scheme');
  let saved;
  const configure = () => {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    initialize({ ...saved, fontFamily, theme: scheme() === 'slate' ? 'redux-dark-color' : 'redux-color' });
  };
  mermaid.initialize = ({ themeCSS, ...config } = {}) => {
    saved = config;
    configure();
  };

  // Dentro do desenho (o Material o põe num shadow root fechado, que chega aqui pelo fn do render)
  const INNER = ':host { display: block; }' +
    '.tde-bar { display: flex; justify-content: flex-end; height: 1.6rem; }' +
    '.tde-bar button { font: 600 .7rem/1 var(--md-text-font-family, sans-serif); padding: .3rem .7rem; border: 0; border-radius: 100px; cursor: pointer;' +
    ' color: var(--md-default-fg-color--light); background: var(--md-default-fg-color--lightest); opacity: 0; transition: opacity .2s; }' +
    ':host(:hover) .tde-bar button, .tde-bar.big button, .tde-bar button:focus-visible { opacity: 1; }' +
    '.tde-bar button:focus-visible { outline: 2px solid var(--md-accent-fg-color); }' +
    '.tde-scroll { overflow-x: auto; text-align: center; }';
  const decorate = (shadow, source) => {
    const svg = shadow.querySelector('svg');
    if (!svg) return;
    const box = svg.viewBox.baseVal;
    const style = document.createElement('style');
    style.textContent = INNER;
    const bar = document.createElement('div');
    bar.className = 'tde-bar' + (box && (box.width > 900 || box.height > 600) ? ' big' : '');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = T.open;
    button.addEventListener('click', () => openViewer(source, box, button));
    bar.append(button);
    const scroll = document.createElement('div');
    scroll.className = 'tde-scroll';
    scroll.append(svg);
    shadow.prepend(style, bar);
    shadow.append(scroll);
  };

  const readable = source => {
    const width = Number(/<svg[^>]*\\sviewBox="[-\\d.]+ [-\\d.]+ ([\\d.]+) [\\d.]+"/.exec(source)?.[1]);
    const min = width ? 'min-width: ' + Math.round(width * 0.6) + 'px;' : '';
    return min ? source.replace(/<svg([^>]*?)\\sstyle="/, '<svg$1 style="' + min + ' ') : source;
  };
  // Os desenhos da página, para redesenhar quando a pessoa troca entre claro e escuro
  let drawn = [];
  const render = mermaid.render.bind(mermaid);
  mermaid.render = async (id, code, ...rest) => {
    const result = await render(id, code, ...rest);
    const fn = result.fn;
    return {
      ...result,
      svg: readable(result.svg),
      fn: shadow => {
        if (fn) fn(shadow);
        decorate(shadow, result.svg);
        drawn.push({ shadow, code });
      },
    };
  };
  let redraws = 0;
  let last = scheme();
  new MutationObserver(async () => {
    if (scheme() === last || !saved) return;
    last = scheme();
    configure();
    drawn = drawn.filter(d => d.shadow.host.isConnected);
    for (const d of drawn) {
      try {
        const { svg } = await render('tde-redraw-' + ++redraws, d.code);
        d.shadow.innerHTML = readable(svg);
        decorate(d.shadow, svg);
      } catch {
        // Fica o desenho anterior
      }
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });

  // A janela de zoom, por cima da página
  const OUTER = '.tde-viewer { position: fixed; inset: 0; z-index: 10; display: flex; padding: 24px; background: rgba(0, 0, 0, .55); }' +
    '.tde-frame { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; border-radius: 8px;' +
    ' background: var(--md-default-bg-color); color: var(--md-default-fg-color); font: .75rem var(--md-text-font-family, sans-serif); box-shadow: 0 12px 40px rgba(0, 0, 0, .35); }' +
    '.tde-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--md-default-fg-color--lightest); }' +
    '.tde-top strong { margin-right: auto; padding-left: 4px; }' +
    '.tde-top button { min-width: 30px; height: 28px; padding: 0 9px; font: inherit; color: inherit; background: transparent; cursor: pointer;' +
    ' border: 1px solid var(--md-default-fg-color--lighter); border-radius: 4px; }' +
    '.tde-top button:hover { background: var(--md-default-fg-color--lightest); }' +
    '.tde-top button:focus-visible { outline: 2px solid var(--md-accent-fg-color); }' +
    '.tde-pct { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; opacity: .75; }' +
    '.tde-stage { position: relative; flex: 1; overflow: hidden; cursor: grab; touch-action: none; }' +
    '.tde-stage.dragging { cursor: grabbing; }' +
    '.tde-canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }' +
    '.tde-canvas svg { display: block; max-width: none; }' +
    '.tde-canvas foreignObject p { margin: 0; }' +
    '.tde-help { padding: 6px 12px; border-top: 1px solid var(--md-default-fg-color--lightest); opacity: .75; }' +
    '@media (max-width: 600px) { .tde-viewer { padding: 0; } .tde-frame { border-radius: 0; } }';
  const style = document.createElement('style');
  style.textContent = OUTER;
  document.head.append(style);

  const openViewer = (source, box, opener) => {
    const width = (box && box.width) || 800;
    const height = (box && box.height) || 600;
    const viewer = document.createElement('div');
    viewer.className = 'tde-viewer';
    const frame = document.createElement('div');
    frame.className = 'tde-frame';
    frame.setAttribute('role', 'dialog');
    frame.setAttribute('aria-modal', 'true');
    frame.setAttribute('aria-label', T.title);
    const top = document.createElement('div');
    top.className = 'tde-top';
    const title = document.createElement('strong');
    title.textContent = T.title;
    const pct = document.createElement('span');
    pct.className = 'tde-pct';
    pct.setAttribute('aria-live', 'polite');
    const button = (action, label, hint) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = action;
      b.textContent = label;
      b.title = hint;
      b.setAttribute('aria-label', hint);
      return b;
    };
    const fitButton = button('fit', T.fit, T.fit);
    top.append(title, button('out', '−', T.zoomOut), pct, button('in', '+', T.zoomIn), fitButton, button('one', '100%', T.one), button('close', '×', T.close));
    const stage = document.createElement('div');
    stage.className = 'tde-stage';
    const canvas = document.createElement('div');
    canvas.className = 'tde-canvas';
    canvas.innerHTML = source;
    const svg = canvas.querySelector('svg');
    if (svg) {
      svg.removeAttribute('style');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
    }
    stage.append(canvas);
    const help = document.createElement('div');
    help.className = 'tde-help';
    help.textContent = T.help;
    frame.append(top, stage, help);
    viewer.append(frame);
    document.body.append(viewer);

    let s = 1, x = 0, y = 0;
    const apply = () => {
      canvas.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + s + ')';
      pct.textContent = Math.round(s * 100) + '%';
    };
    const zoomAt = (f, cx, cy) => {
      const n = Math.min(4, Math.max(0.05, s * f));
      x = cx - ((cx - x) * n) / s;
      y = cy - ((cy - y) * n) / s;
      s = n;
      apply();
    };
    const cx = () => stage.clientWidth / 2;
    const cy = () => stage.clientHeight / 2;
    const fit = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      s = Math.min(1, (w - 48) / width, (h - 48) / height);
      // Muito largo: ajusta pela altura, a partir da esquerda, para o texto continuar legível
      if (s < 0.35) { s = Math.min(1, (h - 48) / height, 0.8); x = 24; } else x = (w - width * s) / 2;
      y = height * s > h ? 24 : (h - height * s) / 2;
      apply();
    };
    const one = () => zoomAt(1 / s, cx(), cy());
    fit();
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      drag = { px: e.clientX, py: e.clientY, x, y };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      x = drag.x + e.clientX - drag.px;
      y = drag.y + e.clientY - drag.py;
      apply();
    });
    const end = () => { drag = null; stage.classList.remove('dragging'); };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    const close = () => {
      viewer.remove();
      document.removeEventListener('keydown', onKey, true);
      opener.focus();
    };
    top.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'in') zoomAt(1.25, cx(), cy());
      else if (action === 'out') zoomAt(0.8, cx(), cy());
      else if (action === 'fit') fit();
      else if (action === 'one') one();
      else if (action === 'close') close();
    });
    viewer.addEventListener('mousedown', e => { if (e.target === viewer) close(); });
    const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    // Em captura: os atalhos do Material (busca, páginas) não recebem as teclas enquanto a janela está aberta
    const onKey = e => {
      const k = e.key;
      let handled = true;
      if (k === 'Escape') close();
      else if (k === 'Tab') {
        const buttons = [...top.querySelectorAll('button')];
        const at = buttons.indexOf(document.activeElement);
        buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      } else if (k === '+' || k === '=') zoomAt(1.25, cx(), cy());
      else if (k === '-') zoomAt(0.8, cx(), cy());
      else if (k === '0') fit();
      else if (k === '1') one();
      else if (moves[k]) { x += moves[k][0]; y += moves[k][1]; apply(); }
      else handled = k !== 'Enter' && k !== ' ' ? null : false;
      if (handled) e.preventDefault();
      if (handled !== false) e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    fitButton.focus();
  };
  mermaid.techdocsEditorColors = true;
})();
`;

/** Caminho de uma entrada do `extra_javascript` (texto, ou mapa com `path`). */
const scriptPath = (item: unknown): string | undefined => {
  if (isScalar(item)) return String(item.value ?? '');
  if (isMap(item)) return String(item.get('path') ?? '');
  return undefined;
};

/** Entradas do `extra_javascript`. */
const extraScripts = (doc: Document): string[] => {
  const list = doc.get('extra_javascript', true);
  return isSeq(list) ? list.items.map(scriptPath).filter((p): p is string => !!p) : [];
};

/** O `extra_javascript` já carrega o script das cores. */
export const hasMermaidColors = (yml: string): boolean => extraScripts(parseDocument(yml)).includes(MERMAID_COLORS_FILE);

/**
 * Acrescenta ao `extra_javascript` o Mermaid (se nenhum outro já é carregado) e o script das cores, nessa ordem.
 * Mexe só no trecho novo; aplicar de novo não muda nada.
 */
export function addMermaidColors(yml: string): string {
  const doc = parseDocument(yml);
  const present = extraScripts(doc);
  if (present.includes(MERMAID_COLORS_FILE)) return yml;
  const wanted = [...(present.some(p => /mermaid(@[^/]*)?\/dist\/|mermaid(\.min)?\.js$/.test(p)) ? [] : [MERMAID_SCRIPT_URL]), MERMAID_COLORS_FILE];
  const list = doc.get('extra_javascript', true);
  if (!doc.has('extra_javascript')) {
    const base = yml && !yml.endsWith('\n') ? `${yml}\n` : yml;
    return `${base}extra_javascript:\n${indent(wanted.map(w => `- ${w}`), 2)}`;
  }
  if (isSeq(list) && !list.flow && list.items.length) {
    const first = list.items[0] as Node;
    return insertAt(yml, list.range![1], indent(wanted.map(w => `- ${w}`), column(yml, first.range![0]) - 2));
  }
  // Lista numa linha ou vazia: pela árvore do `yaml`
  const seq = isSeq(list) ? list : (doc.createNode([]) as YAMLSeq);
  for (const w of wanted) seq.items.push(doc.createNode(w) as never);
  seq.flow = false;
  doc.set('extra_javascript', seq);
  return doc.toString();
}

/** Tudo do Mermaid no `mkdocs.yml`: o bloco do superfences (M6) e as cores do editor (M25). */
export const addMermaidConfig = (yml: string): string => addMermaidColors(addMermaidFence(yml));

/**
 * Diagrama acima dos limites do Mermaid (M27): mais de 50 mil caracteres, ou um fluxograma com mais de 500 ligações
 * (conta as setas; `A & B --> C` conta como uma, então o número é o mínimo). O site não desenha esses diagramas.
 */
export function mermaidTooBig(code: string): boolean {
  if (code.length > 50_000) return true;
  if (!/^\s*(flowchart|graph)\b/m.test(code)) return false;
  return (code.match(/-{2,}>|={2,}>|-\.+->|-{3,}|={3,}|-\.+-|~{3,}/g) ?? []).length > 500;
}
