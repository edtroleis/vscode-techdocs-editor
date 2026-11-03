import { $prose } from '@milkdown/kit/utils';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * HTML colado de outras ferramentas (spec 05), antes de o editor ler. Bloco de código do Confluence (C2): o atual
 * vem como `<span data-ds--code--code-block><code>`, sem `<pre>`, e o editor o lia como código inline numa linha
 * só; o antigo vem como `<pre class="syntaxhighlighter-pre">`, com a linguagem em `data-syntaxhighlighter-params`.
 * Os dois viram `<pre><code>` com o texto, as quebras de linha e a linguagem.
 */
export function cleanPastedHtml(html: string): string {
  if (!/data-ds--code--code-block|syntaxhighlighter-pre|<img|information-macro|data-panel-type|notice-block/.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
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
function admonition(doc: Document, panel: Element): HTMLElement {
  const titleEl = panel.querySelector(':scope > .title, :scope > .confluence-information-macro-title');
  const title = titleEl?.textContent?.trim();
  titleEl?.remove();
  const body = panel.querySelector('.confluence-information-macro-body, :scope > .content, [data-panel-content]') ?? panel;
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
    if (!(node instanceof Element)) return '';
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
      if (node instanceof Element && /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(node.tagName)) {
        flush();
        if (node.querySelector('p, ul, ol, pre, div')) walk(node);
        else line = [...node.childNodes].map(inline).join('');
        flush();
      } else if (node instanceof Element && /^(UL|OL)$/.test(node.tagName)) {
        flush();
        blocks.push([...node.children].map((li, i) => `${node.tagName === 'OL' ? `${i + 1}.` : '-'} ${[...li.childNodes].map(inline).join('').trim()}`).join('\n'));
      } else if (node instanceof Element && node.tagName === 'PRE') {
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

function codeBlock(doc: Document, text: string, language: string | undefined): HTMLElement {
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  const lang = language && !/^(text|none|plain)$/i.test(language) ? language.toLowerCase() : '';
  if (lang) {
    pre.dataset.language = lang;
    code.className = `language-${lang}`;
  }
  code.textContent = text.replace(/\n$/, '');
  pre.append(code);
  return pre;
}

/** Importa a imagem de fora para o repositório e devolve o link novo (undefined: fica o endereço de fora). */
export type ImportImage = (src: string) => Promise<string | undefined>;

/**
 * Colar HTML de outras ferramentas (spec 05). `importImage()`: quem baixa as imagens coladas (C3) — elas apontam
 * para a ferramenta de origem (que pede login, ou com endereço que expira) e no site quebrariam.
 */
export const pasteHtmlPlugin = (importImage: () => ImportImage | undefined) =>
  $prose(() => {
    const key = new PluginKey('docs-editor-paste-html');
    return new Plugin({
      key,
      props: {
        transformPastedHTML: cleanPastedHtml,
        // transformPasted e não handlePaste: o plugin de colagem do Milkdown trata o evento antes e encerra
        transformPasted(slice, view) {
          const importer = importImage();
          if (!importer) return slice;
          const remote = new Set<string>();
          slice.content.descendants((node: Node) => {
            if (node.type.name.startsWith('image') && /^https?:/i.test(node.attrs.src ?? '')) remote.add(node.attrs.src);
          });
          // A colagem segue normal; as imagens trocam de endereço quando o download termina
          for (const src of remote) {
            void importer(src).then(link => {
              if (!link || view.isDestroyed) return;
              const tr = view.state.tr;
              view.state.doc.descendants((node, pos) => {
                if (node.type.name.startsWith('image') && node.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: link });
              });
              if (tr.docChanged) view.dispatch(tr);
            });
          }
          return slice;
        },
      },
    });
  });
