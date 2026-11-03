import { Page, expect, test } from '@playwright/test';
import { editor, openEditor, saved } from './helpers';

/**
 * Colar do Confluence e do Outline (spec 05). O HTML é o que o Ctrl+C dessas ferramentas põe na área de
 * transferência, recortado das páginas públicas testadas (cwiki.apache.org, docs.getoutline.com), sem os estilos.
 */

/** Cola `html` no fim da página, como o Ctrl+V (o evento de colar com o HTML e o texto puro). */
async function paste(page: Page, html: string) {
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await editor(page).evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

/** O Markdown salvo, depois que o editor avisa a mudança. */
const savedWith = (page: Page, text: string) =>
  expect.poll(async () => ((await saved(page)) ?? '').includes(text), { timeout: 10_000 }).toBe(true).then(() => saved(page));

const PAGE = '# Página\n\nTexto.\n';

// Macro "code" do Confluence atual: <code> dentro de um <span>, sem <pre>, com os botões de copiar
const CONFLUENCE_CODE =
  '<p>Antes do código.</p><div class="code panel pdl conf-macro output-block" data-hasbody="true" data-macro-name="code"><div class="codeContent panelContent pdl"><div class="codeBlockContainer_tQ9A7sKgq0BEjnPL"><div class="buttonContainer__laYV6y2wlg6PNDw"><button type="button"></button></div>' +
  '<span data-code-lang="sql" data-ds--code--code-block="" class="prismjs css-nc0a95"><code class="language-sql"><span class="">CREATE </span><span class="token punctuation">[</span><span class="">REMOTE</span><span class="token punctuation">]</span><span class=""> DATABASE database_name\n</span><span class="">  </span><span class="token punctuation">[</span><span class="">COMMENT database_comment</span><span class="token punctuation">]</span><span class="">\n</span><span class="">  </span><span class="token punctuation">[</span><span class="">LOCATION hdfs_path</span><span class="token punctuation">]</span><span class="token punctuation">;</span><span class="">\n</span></code></span></div></div></div><p>Depois do código.</p>';

// Macro "code" das versões antigas do Confluence
const CONFLUENCE_OLD_CODE =
  '<div class="code panel pdl"><div class="codeContent panelContent pdl"><pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: java; gutter: false; theme: Confluence" data-theme="Confluence">public class A {\n  int x = 1;\n}</pre></div></div>';

// Outline: e-mail no texto e imagem com endereço do S3 com parâmetros
const OUTLINE_LINKS =
  '<p dir="auto">Reach out to <strong>hello@getoutline.com</strong> to setup.</p><p dir="auto">Veja <a href="https://example.com/doc?x=1&amp;y=2">o guia</a>.</p>';

test.describe('colar do Confluence e do Outline (spec 05)', () => {
  test('C2: bloco de código do Confluence atual vira bloco de código, com as linhas e a linguagem', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_CODE);
    const md = await savedWith(page, 'Depois do código.');
    expect(md).toContain('```sql\nCREATE [REMOTE] DATABASE database_name\n  [COMMENT database_comment]\n  [LOCATION hdfs_path];\n```');
    expect(md).not.toMatch(/`CREATE/);
  });

  test('C2: bloco de código do Confluence antigo (syntaxhighlighter) mantém a linguagem', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_OLD_CODE);
    const md = await savedWith(page, 'int x = 1;');
    expect(md).toContain('```java\npublic class A {\n  int x = 1;\n}\n```');
  });

  test('C1: e-mail e link com & colados saem sem as barras que o MkDocs não entende', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, OUTLINE_LINKS);
    const md = await savedWith(page, 'o guia');
    expect(md).toContain('**hello@getoutline.com**');
    expect(md).toContain('[o guia](https://example.com/doc?x=1&y=2)');
  });
});
