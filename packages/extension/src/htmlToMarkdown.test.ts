import { htmlToMarkdown } from './htmlToMarkdown';

// Recortes do que o Ctrl+C do Confluence e do Outline põe na área de transferência (spec 05)
const CONFLUENCE_CODE =
  '<div class="code panel pdl conf-macro output-block" data-macro-name="code"><div class="codeContent panelContent pdl"><div><div><button type="button"></button></div><span data-code-lang="sql" data-ds--code--code-block="" class="prismjs"><code class="language-sql"><span>CREATE DATABASE db\n</span><span>  [COMMENT c];\n</span></code></span></div></div></div>';
const CONFLUENCE_PANEL =
  '<div class="confluence-information-macro confluence-information-macro-information" data-macro-name="info"><p class="title">Version information</p><span class="aui-icon confluence-information-macro-icon"></span><div class="confluence-information-macro-body"><p>Since <strong>Hive 2.0</strong> (<a href="https://issues.apache.org/jira/browse/HIVE-1?a=1&amp;b=2">HIVE-1</a>).</p></div></div>';
const CONFLUENCE_TABLE =
  '<table><tbody><tr><th><br></th><th colspan="2"><h3>All Keywords</h3></th></tr><tr><th>Version</th><th>Non-reserved</th><th>Reserved</th></tr><tr><td>Hive 1.2.0</td><td>ADD</td><td>ALL</td></tr></tbody></table>';
const OUTLINE =
  '<div class="toc-macro" data-macro-name="toc"><ul><li><a href="https://x/#a">A</a></li></ul></div><h1 dir="auto">Publish</h1><p>Reach out to <strong>hello@getoutline.com</strong>.</p><div class="notice-block tip"><div class="content"><p>This is a tip</p></div></div><div class="image"><img src="https://s3.example.com/u/diagrama-de-rede.png?X-Amz-Expires=3600&amp;s=1"><p class="caption">Rede</p></div>';

describe('htmlToMarkdown (Colar como Markdown, spec 05 C12)', () => {
  it('bloco de código do Confluence vira bloco cercado com a linguagem', async () => {
    expect(await htmlToMarkdown(CONFLUENCE_CODE)).toBe('```sql\nCREATE DATABASE db\n  [COMMENT c];\n```\n');
  });

  it('painel do Confluence vira aviso do MkDocs, e o & do link sai sem barra', async () => {
    expect(await htmlToMarkdown(CONFLUENCE_PANEL)).toBe(
      '!!! info "Version information"\n    Since **Hive 2.0** ([HIVE-1](https://issues.apache.org/jira/browse/HIVE-1?a=1&b=2)).\n',
    );
  });

  it('tabela com título mesclado fica inteira, com o título antes', async () => {
    const md = await htmlToMarkdown(CONFLUENCE_TABLE);
    expect(md).toContain('**All Keywords**:\n\n|');
    expect(md).toMatch(/\| Version +\| Non-reserved +\| Reserved +\|/);
    expect(md).toMatch(/\| Hive 1\.2\.0 +\| ADD +\| ALL +\|/);
  });

  it('Outline: sem sumário, título um nível abaixo, e-mail sem barra, aviso e imagem trazida ao repositório', async () => {
    const asked: string[] = [];
    const md = await htmlToMarkdown(OUTLINE, {
      pageHasTitle: true,
      importImage: async src => (asked.push(src), 'assets/1-diagrama-de-rede.png'),
    });
    expect(md).not.toContain('https://x/#a');
    expect(md).toContain('## Publish\n');
    expect(md).toContain('**hello@getoutline.com**');
    expect(md).toContain('!!! tip\n    This is a tip\n');
    expect(md).toContain('![diagrama de rede](assets/1-diagrama-de-rede.png)');
    expect(md).not.toMatch(/^Rede$/m);
    expect(asked).toEqual(['https://s3.example.com/u/diagrama-de-rede.png?X-Amz-Expires=3600&s=1']);
  });
});
