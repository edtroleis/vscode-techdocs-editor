/**
 * Limpeza do HTML colado de outras ferramentas (spec 05), antes de virar Markdown: no editor visual (antes de o
 * Milkdown ler) e no editor de texto (Colar como Markdown, C12). Usa só o DOM comum: na extensão, o do `linkedom`.
 */

export type CleanOptions = {
  /** A página onde se cola já tem título de nível 1 (C9). */
  pageHasTitle?: boolean;
  /** Lê o HTML (padrão: o `DOMParser` do navegador). */
  parse?: (html: string) => Document;
};

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');
/** Sem `instanceof Element`: no DOM leve não há a classe global. */
const isElement = (node: Node): node is Element => node.nodeType === 1;

/**
 * HTML colado de outras ferramentas (spec 05), antes de o editor ler. Bloco de código do Confluence (C2): o atual
 * vem como `<span data-ds--code--code-block><code>`, sem `<pre>`, e o editor o lia como código inline numa linha
 * só; o antigo vem como `<pre class="syntaxhighlighter-pre">`, com a linguagem em `data-syntaxhighlighter-params`.
 * Os dois viram `<pre><code>` com o texto, as quebras de linha e a linguagem.
 */
export function cleanPastedHtml(html: string, { pageHasTitle = false, parse = parseHtml }: CleanOptions = {}): string {
  if (!/data-ds--code--code-block|syntaxhighlighter-pre|<img|information-macro|data-panel-type|notice-block|<h[1-6]|toc-macro|data-macro-name/.test(html)) return html;
  const doc = parse(html);
  // C5: o sumário do Confluence (o MkDocs gera o dele)
  doc.querySelectorAll('.toc-macro, [data-macro-name="toc"]').forEach(e => e.remove());
  // C10: a legenda da imagem do Outline repete o texto alternativo
  doc.querySelectorAll('.image > .caption').forEach(e => e.remove());
  // C8: células mescladas não existem no Markdown (a tabela saía partida)
  doc.querySelectorAll('table').forEach(table => unmergeCells(doc, table));
  const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  // C7: título dentro de célula de tabela (Confluence) não cabe no Markdown: o título saltava para fora e a tabela
  // ficava vazia. Vira o texto da célula (o cabeçalho já é negrito; na célula comum, negrito)
  for (const heading of [...doc.querySelectorAll(['td', 'th'].flatMap(cell => HEADINGS.map(h => `${cell} ${h}`)).join(', '))]) {
    const text = doc.createElement(heading.closest('th') ? 'span' : 'strong');
    text.append(...heading.childNodes);
    heading.replaceWith(text);
  }
  // C7: título inteiro em negrito (Confluence): o negrito sai, o título já se destaca
  for (const heading of [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')]) {
    // Negrito por estilo (`<span style="font-weight: bold">`, no Confluence) também vira negrito no editor
    heading.querySelectorAll('[style]').forEach(e => e.removeAttribute('style'));
    // Sem contar os vazios (o botão de copiar o link do título, no Confluence)
    const filled = [...heading.children].filter(e => e.textContent?.trim());
    const [only] = filled;
    if (filled.length === 1 && /^(STRONG|B)$/.test(only.tagName) && only.textContent?.trim() === heading.textContent?.trim()) only.replaceWith(...only.childNodes);
  }
  // C9: seções do Outline são H1; a página já tem o seu (ou vêm vários): todos os títulos descem um nível
  const h1s = doc.querySelectorAll('h1').length;
  if (h1s && (pageHasTitle || h1s > 1)) {
    for (const heading of [...doc.querySelectorAll('h1, h2, h3, h4, h5')]) {
      const lower = doc.createElement(`h${Number(heading.tagName[1]) + 1}`);
      lower.append(...heading.childNodes);
      heading.replaceWith(lower);
    }
  }
  // C3: imagem sem texto alternativo leva a legenda (title) ou o nome do arquivo
  for (const img of [...doc.querySelectorAll('img')]) {
    if (!img.getAttribute('alt')?.trim()) img.setAttribute('alt', img.getAttribute('title')?.trim() || nameOfImage(img.getAttribute('src') ?? ''));
  }
  for (const block of [...doc.querySelectorAll('[data-ds--code--code-block]')]) {
    const code = block.querySelector('code');
    const language = block.getAttribute('data-code-lang') || code?.className.match(/language-(\S+)/)?.[1];
    // O painel inteiro (com os botões de copiar e o título), quando há
    (block.closest('.code.panel') ?? block).replaceWith(codeBlock(doc, (code ?? block).textContent ?? '', language));
  }
  for (const pre of [...doc.querySelectorAll('pre.syntaxhighlighter-pre')]) {
    const language = pre.getAttribute('data-syntaxhighlighter-params')?.match(/brush:\s*([\w+#-]+)/)?.[1];
    (pre.closest('.code.panel') ?? pre).replaceWith(codeBlock(doc, pre.textContent ?? '', language));
  }
  // C4 depois do C2: o código dentro de um painel já é <pre> e vai para o corpo do aviso
  for (const panel of [...doc.querySelectorAll(PANELS)]) panel.replaceWith(admonition(doc, panel));
  return doc.body.innerHTML;
}

/**
 * C8: tira as células mescladas. A linha de cima com uma célula só com texto, mesclada sobre as outras colunas (o
 * título da tabela no Confluence), vira um parágrafo em negrito antes dela; as outras células mescladas ficam na primeira posição e as
 * posições que ocupavam viram células vazias.
 */
function unmergeCells(doc: Document, table: Element) {
  // Sem `rows`/`cells`/`colSpan`: o DOM leve da extensão (linkedom) não tem
  const rows = [...table.querySelectorAll('tr')].filter(tr => tr.closest('table') === table);
  const cellsOf = (row: Element) => [...row.children].filter(c => /^(TD|TH)$/.test(c.tagName));
  const span = (cell: Element, name: 'colspan' | 'rowspan') => Math.max(1, Number(cell.getAttribute(name)) || 1);
  if (!rows.some(r => cellsOf(r).some(c => span(c, 'colspan') > 1 || span(c, 'rowspan') > 1))) return;
  // A grade com as posições ocupadas por cada célula
  const grid: (Element | null)[][] = rows.map(() => []);
  rows.forEach((row, r) => {
    let col = 0;
    for (const cell of cellsOf(row)) {
      while (grid[r][col] !== undefined) col++;
      for (let dr = 0; dr < span(cell, 'rowspan'); dr++) {
        for (let dc = 0; dc < span(cell, 'colspan'); dc++) {
          if (grid[r + dr]) grid[r + dr][col + dc] = dr === 0 && dc === 0 ? cell : null;
        }
      }
      col += span(cell, 'colspan');
    }
  });
  const width = Math.max(...grid.map(g => g.length));
  // A linha de título: uma célula só com texto, mesclada sobre as outras colunas (ao lado, só células vazias)
  const filled = cellsOf(rows[0]).filter(c => c.textContent?.trim());
  if (rows.length > 1 && filled.length === 1 && span(filled[0], 'colspan') > 1 && span(filled[0], 'rowspan') <= 1) {
    const title = doc.createElement('p');
    const strong = doc.createElement('strong');
    strong.textContent = filled[0].textContent?.trim() ?? '';
    // Com os dois-pontos fora do negrito: um parágrafo só de negrito o lint toma por título (MD036)
    title.append(strong, ':');
    table.before(title);
    rows[0].remove();
    rows.shift();
    grid.shift();
  }
  // Colunas vazias em todas as linhas (sobras das células mescladas) saem
  const used = Array.from({ length: width }, (_, c) => grid.some(g => g[c]?.textContent?.trim()));
  rows.forEach((row, r) => {
    const cells = [...grid[r]];
    while (cells.length < width) cells.push(null);
    for (let c = width - 1; c >= 0; c--) if (!used[c]) cells.splice(c, 1);
    while (row.firstChild) row.firstChild.remove();
    row.append(
      ...cells.map(cell => {
        if (cell) {
          cell.removeAttribute('colspan');
          cell.removeAttribute('rowspan');
          return cell;
        }
        return doc.createElement(row.querySelector('th') && !row.querySelector('td') ? 'th' : 'td');
      }),
    );
  });
}

/** Painéis do Confluence (Data Center e Cloud) e avisos do Outline. */
const PANELS = '.confluence-information-macro, [data-panel-type], .notice-block';

/** O tipo do aviso do MkDocs para o painel. */
function admonitionType(panel: Element): string {
  const kind =
    panel.getAttribute('data-panel-type') ??
    panel.className.match(/confluence-information-macro-(information|note|warning|tip)\b/)?.[1] ??
    panel.className.match(/\bnotice-block\s+(\w+)/)?.[1] ??
    'info';
  return ({ information: 'info', error: 'danger', custom: 'note' } as Record<string, string>)[kind] ?? kind;
}

/**
 * C4: o painel vira o aviso do MkDocs (`!!! note "Título"` e o corpo com 4 espaços), no bloco `mkdocs` em que o
 * editor mostra os avisos (ver `toEditor`).
 */
function admonition(doc: Document, panel: Element): Element {
  const child = (...classes: string[]) => [...panel.children].find(c => classes.some(k => c.classList.contains(k)));
  const titleEl = child('title', 'confluence-information-macro-title');
  const title = titleEl?.textContent?.trim();
  titleEl?.remove();
  const body = panel.querySelector('.confluence-information-macro-body, [data-panel-content]') ?? child('content') ?? panel;
  // Os ícones do painel (svg, span de ícone) ficam de fora
  body.querySelectorAll('svg, .aui-icon, [data-panel-icon], .confluence-information-macro-icon').forEach(e => e.remove());
  const text = toMarkdown(body).trim();
  const head = `!!! ${admonitionType(panel)}${title ? ` "${title.replace(/"/g, "'")}"` : ''}`;
  const lines = text ? text.split('\n').map(l => (l ? `    ${l}` : '')) : [];
  return codeBlock(doc, [head, ...lines].join('\n'), 'mkdocs');
}

/** Markdown simples do corpo de um painel: parágrafos, listas, código, negrito, itálico e links. */
function toMarkdown(el: Element): string {
  const blocks: string[] = [];
  const inline = (node: ChildNode): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
    if (!isElement(node)) return '';
    const inner = [...node.childNodes].map(inline).join('');
    switch (node.tagName) {
      case 'STRONG':
      case 'B':
        return inner.trim() ? `**${inner.trim()}**` : '';
      case 'EM':
      case 'I':
        return inner.trim() ? `*${inner.trim()}*` : '';
      case 'CODE':
        return `\`${node.textContent ?? ''}\``;
      case 'A':
        return node.getAttribute('href') ? `[${inner.trim()}](${node.getAttribute('href')})` : inner;
      case 'BR':
        return '\n';
      case 'IMG':
        return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`;
      default:
        return inner;
    }
  };
  const walk = (parent: Element) => {
    let line = '';
    const flush = () => {
      if (line.trim()) blocks.push(line.trim());
      line = '';
    };
    for (const node of [...parent.childNodes]) {
      if (isElement(node) && /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(node.tagName)) {
        flush();
        if (node.querySelector('p, ul, ol, pre, div')) walk(node);
        else line = [...node.childNodes].map(inline).join('');
        flush();
      } else if (isElement(node) && /^(UL|OL)$/.test(node.tagName)) {
        flush();
        blocks.push([...node.children].map((li, i) => `${node.tagName === 'OL' ? `${i + 1}.` : '-'} ${[...li.childNodes].map(inline).join('').trim()}`).join('\n'));
      } else if (isElement(node) && node.tagName === 'PRE') {
        flush();
        const lang = node.getAttribute('data-language') ?? '';
        blocks.push(`\`\`\`${lang || 'text'}\n${node.textContent ?? ''}\n\`\`\``);
      } else {
        line += inline(node);
      }
    }
    flush();
  };
  walk(el);
  return blocks.join('\n\n');
}

/** Nome legível da imagem pelo arquivo do endereço: `diagrama-de-rede.png` → "diagrama de rede". */
export function nameOfImage(src: string): string {
  let file = '';
  try {
    file = decodeURIComponent(new URL(src, 'https://x/').pathname.split('/').pop() ?? '');
  } catch {
    return '';
  }
  const name = file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').trim();
  // Nomes genéricos (image.png, a.png) não dizem nada
  return /^(image|img|imagem|screenshot|\w)$/i.test(name) ? '' : name;
}

function codeBlock(doc: Document, text: string, language: string | undefined): Element {
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  const lang = language && !/^(text|none|plain)$/i.test(language) ? language.toLowerCase() : '';
  if (lang) {
    pre.setAttribute('data-language', lang);
    code.className = `language-${lang}`;
  }
  code.textContent = text.replace(/\n$/, '');
  pre.append(code);
  return pre;
}
