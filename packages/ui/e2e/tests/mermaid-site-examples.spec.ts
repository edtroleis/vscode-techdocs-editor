import { expect, test } from '@playwright/test';
import site from '../fixtures/mermaid-site-examples.json';
import { editor, expectSaved, openEditor } from './helpers';

/**
 * Todos os exemplos da documentação do Mermaid (mermaid.js.org, cópia em fixtures/, atualizada por
 * `npm run sync-mermaid-examples`) abertos no editor visual: cada um aparece desenhado e o Markdown volta igual.
 * Um teste por página do site. Roda sozinho com `npm run test:mermaid-examples`.
 */

/** Tipos que o Mermaid da extensão não desenha, com o motivo. Se um passar a desenhar, o teste pede para tirar daqui. */
const NOT_SUPPORTED: Record<string, string> = {
  zenuml: 'ZenUML é um plugin à parte (@mermaid-js/mermaid-zenuml), fora do pacote',
  agentflow: 'Agentflow só existe a partir do Mermaid 12.3',
};
const diagramType = (code: string) =>
  code
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^\s*%%.*\n/gm, '')
    .trim()
    .split(/[\s-]/)[0]
    ?.toLowerCase() ?? '';

const pages = new Map<string, { n: number; code: string }[]>();
for (const e of site.examples) pages.set(e.page, [...(pages.get(e.page) ?? []), e]);

for (const [name, examples] of pages) {
  test(`${name}: ${examples.length} exemplos desenhados e o Markdown igual`, async ({ page }) => {
    test.setTimeout(30_000 + examples.length * 1_500);
    const md = `# Exemplos\n\n${examples.map(e => `\`\`\`mermaid\n${e.code}\n\`\`\`\n`).join('\n')}`;
    const { errors } = await openEditor(page, md);
    const blocks = page.locator('.milkdown-code-block');
    await expect(blocks).toHaveCount(examples.length);

    const failed: string[] = [];
    for (const [i, e] of examples.entries()) {
      const block = blocks.nth(i);
      // O Crepe só monta a prévia dos blocos perto da tela
      await block.scrollIntoViewIfNeeded();
      const result = block.locator('.mermaid-diagram svg, .mermaid-error');
      await expect(result.first(), `exemplo ${e.n}`).toBeVisible({ timeout: 10_000 });
      const drawn = await block.locator('.mermaid-diagram svg').count();
      const reason = NOT_SUPPORTED[diagramType(e.code)];
      if (reason && drawn) failed.push(`#${e.n}: "${diagramType(e.code)}" já desenha, tirar de NOT_SUPPORTED`);
      if (!reason && !drawn) failed.push(`#${e.n}: ${(await block.locator('.mermaid-error').innerText()).slice(0, 200)}\n${e.code}`);
    }
    expect(failed, failed.join('\n\n')).toEqual([]);

    // Editar o título faz o editor gravar a página inteira: os blocos têm de voltar como estavam
    await editor(page).locator('h1').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expectSaved(page, md.replace('# Exemplos', '# Exemplos!'));
    expect(errors).toEqual([]);
  });
}
