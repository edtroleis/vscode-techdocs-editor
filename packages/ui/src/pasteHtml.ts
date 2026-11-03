import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * HTML colado de outras ferramentas (spec 05), antes de o editor ler. Bloco de código do Confluence (C2): o atual
 * vem como `<span data-ds--code--code-block><code>`, sem `<pre>`, e o editor o lia como código inline numa linha
 * só; o antigo vem como `<pre class="syntaxhighlighter-pre">`, com a linguagem em `data-syntaxhighlighter-params`.
 * Os dois viram `<pre><code>` com o texto, as quebras de linha e a linguagem.
 */
export function cleanPastedHtml(html: string): string {
  if (!/data-ds--code--code-block|syntaxhighlighter-pre/.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
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
  return doc.body.innerHTML;
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

export const pasteHtmlPlugin = $prose(
  () => new Plugin({ key: new PluginKey('docs-editor-paste-html'), props: { transformPastedHTML: cleanPastedHtml } }),
);
