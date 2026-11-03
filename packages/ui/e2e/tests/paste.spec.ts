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

// Painel "info" do Confluence Data Center, com título e ícone
const CONFLUENCE_PANEL =
  '<div class="confluence-information-macro confluence-information-macro-information conf-macro output-block" data-hasbody="true" data-macro-name="info"><p class="title conf-macro-render">Version information</p><span role="presentation" class="aui-icon aui-icon-small aui-iconfont-info-filled confluence-information-macro-icon"></span><div class="confluence-information-macro-body"><p>REGEXP and RLIKE are <strong>non-reserved</strong> keywords (<a class="external-link" href="https://issues.apache.org/jira/browse/HIVE-11703" rel="nofollow">HIVE-11703</a>).</p><ul><li>um</li><li>dois</li></ul></div></div><p>Depois do painel.</p>';

// Painel "warning" do Confluence Cloud (sem título)
const CONFLUENCE_CLOUD_PANEL =
  '<div data-panel-type="warning" class="ak-editor-panel"><div class="ak-editor-panel__icon" data-panel-icon=""><svg></svg></div><div class="ak-editor-panel__content" data-panel-content=""><p>Cuidado com o <code>DROP</code>.</p></div></div><p>Depois do aviso.</p>';

// Avisos do Outline
const OUTLINE_NOTICES =
  '<div class="notice-block tip"><div class="content"><p dir="auto">This is a tip</p></div></div><div class="notice-block warning"><div class="content"><p dir="auto">This is a warning</p></div></div><p dir="auto">Depois dos avisos.</p>';

// Imagens: do Confluence (anexo, sem alt) e do Outline (S3 assinado, com legenda no title); uma sem acesso
const IMAGES =
  '<p><img src="https://cwiki.example.org/download/attachments/123/diagrama-de-rede.png?version=1&amp;api=v2"></p>' +
  '<p><img src="https://bucket.s3.amazonaws.com/uploads/abc/image.png?X-Amz-Expires=3600&amp;X-Amz-Signature=x" title="The share dialog"></p>' +
  '<p><img src="https://privado.example.org/sem-acesso/foto.png"></p><p>Depois das imagens.</p>';

// Começo de página do Confluence: sumário (macro toc) e título em negrito
const CONFLUENCE_TOC =
  '<div class="toc-macro client-side-toc-macro conf-macro output-block hidden-outline" data-headerelements="H1,H2" data-hasbody="false" data-macro-name="toc"><ul><li><span class="toc-item-body" data-outline="1"><a href="https://cwiki.example.org/confluence/spaces/X/pages/1/P#P-Status">Status</a></span></li></ul></div>' +
  '<h2 id="P-Status"><strong>Status</strong><span class="copy-heading-link-container"></span></h2><p>Aceito, com <strong>negrito</strong> no meio.</p><h3><span style="font-weight: bold;">Por estilo</span><span class="copy-heading-link-container"></span></h3><p>Fim.</p>';

// Outline: seções em H1 e imagem com a legenda repetida
const OUTLINE_SECTIONS =
  '<h1 dir="auto" class="heading-content">Publish to web</h1><p dir="auto">Texto.</p><div class="image"><img src="assets/share.png" alt="The share dialog"><p class="caption">The share dialog</p></div><h2 dir="auto">Custom link</h2><p dir="auto">Mais texto.</p><h1 dir="auto">Disabling sharing</h1><p dir="auto">Fim das seções.</p>';

// Tabela do Confluence com títulos dentro das células
const CONFLUENCE_TABLE_HEADINGS =
  '<table class="confluenceTable"><thead><tr><th class="confluenceTh">Version</th><th class="confluenceTh"><h3 id="x">Non-reserved Keywords</h3></th></tr></thead><tbody><tr><td class="confluenceTd">Hive 1.2.0</td><td class="confluenceTd"><h4>ALL</h4> e mais</td></tr></tbody></table><p>Depois da tabela.</p>';

// Tabela do Hive: a primeira linha é o título sobre as 3 colunas; e uma célula ocupando 2 linhas
const CONFLUENCE_MERGED =
  '<table class="confluenceTable"><thead><tr><th class="confluenceTh"><br></th><th class="confluenceTh" colspan="2"><h3>All Keywords</h3></th></tr></thead><tbody><tr><th class="confluenceTh">Version</th><th class="confluenceTh">Non-reserved</th><th class="confluenceTh">Reserved</th></tr>' +
  '<tr><td class="confluenceTd" rowspan="2">Hive 1.2.0</td><td class="confluenceTd">ADD</td><td class="confluenceTd">ALL</td></tr><tr><td class="confluenceTd">ADMIN</td><td class="confluenceTd">ALTER</td></tr></tbody></table><p>Depois da tabela mesclada.</p>';

test.describe('colar do Confluence e do Outline (spec 05)', () => {
  test('C8: células mescladas: o título da tabela vira parágrafo e a tabela fica inteira', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_MERGED);
    const md = await savedWith(page, 'Depois da tabela mesclada.');
    expect(md).toContain('**All Keywords**:\n\n|');
    expect(md).toMatch(/\| Version +\| Non-reserved +\| Reserved +\|/);
    expect(md).toMatch(/\| Hive 1\.2\.0 +\| ADD +\| ALL +\|\n\| +\| ADMIN +\| ALTER +\|/);
  });

  test('C7: títulos dentro das células da tabela viram o texto da célula, e a tabela fica inteira', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_TABLE_HEADINGS);
    const md = await savedWith(page, 'Depois da tabela.');
    expect(md).toMatch(/\| Version +\| Non-reserved Keywords +\|/);
    expect(md).toMatch(/\| Hive 1\.2\.0 +\| \*\*ALL\*\* e mais +\|/);
    expect(md).not.toMatch(/^#+ .*Keywords/m);
  });

  test('C5 e C7: o sumário do Confluence sai e o título perde o negrito', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_TOC);
    const md = await savedWith(page, 'Aceito');
    expect(md).not.toContain('cwiki.example.org');
    expect(md).toContain('## Status\n');
    expect(md).toContain('Aceito, com **negrito** no meio.');
    expect(md).toContain('### Por estilo\n');
  });

  test('C9 e C10: seções do Outline descem um nível (a página já tem título) e a legenda não se repete', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, OUTLINE_SECTIONS);
    const md = await savedWith(page, 'Fim das seções.');
    expect(md).toContain('## Publish to web\n');
    expect(md).toContain('### Custom link\n');
    expect(md).toContain('## Disabling sharing\n');
    expect(md.match(/^# /gm)).toHaveLength(1);
    expect(md.match(/The share dialog/g)?.length).toBeLessThanOrEqual(2);
    expect(md).not.toMatch(/^The share dialog$/m);
  });

  test('C4: painel do Confluence Data Center vira aviso do MkDocs, com título, negrito, link e lista', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_PANEL);
    const md = await savedWith(page, 'Depois do painel.');
    expect(md).toContain(
      '!!! info "Version information"\n    REGEXP and RLIKE are **non-reserved** keywords ([HIVE-11703](https://issues.apache.org/jira/browse/HIVE-11703)).\n\n    - um\n    - dois\n',
    );
  });

  test('C4: painel do Confluence Cloud vira aviso do MkDocs', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, CONFLUENCE_CLOUD_PANEL);
    const md = await savedWith(page, 'Depois do aviso.');
    expect(md).toContain('!!! warning\n    Cuidado com o `DROP`.\n');
  });

  test('C4: avisos do Outline viram avisos do MkDocs', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, OUTLINE_NOTICES);
    const md = await savedWith(page, 'Depois dos avisos.');
    expect(md).toContain('!!! tip\n    This is a tip\n');
    expect(md).toContain('!!! warning\n    This is a warning\n');
  });

  test('C3: imagens coladas vão para o repositório, com texto alternativo; sem acesso, fica o endereço', async ({ page }) => {
    await openEditor(page, PAGE);
    await paste(page, IMAGES);
    await expect.poll(async () => ((await saved(page)) ?? '').includes('](assets/image.png'), { timeout: 10_000 }).toBe(true);
    const md = (await saved(page))!;
    // O editor repete o texto alternativo como título (a dica da imagem no site)
    expect(md).toMatch(/!\[diagrama de rede\]\(assets\/diagrama-de-rede\.png( "diagrama de rede")?\)/);
    expect(md).toMatch(/!\[The share dialog\]\(assets\/image\.png( "The share dialog")?\)/);
    expect(md).toMatch(/!\[foto\]\(https:\/\/privado\.example\.org\/sem-acesso\/foto\.png( "foto")?\)/);
    expect(await page.evaluate(() => window.harness.imports.length)).toBe(3);
  });

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
