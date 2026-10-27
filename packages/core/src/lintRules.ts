/**
 * Problemas de formatação em linguagem simples, por regra do markdownlint (os mesmos do plugin, `lintRules`).
 * Regra sem texto aqui usa a descrição em inglês do markdownlint.
 */

const EN: Record<string, string> = {
  MD001: 'headings skip a level (e.g. from Heading 1 straight to Heading 3)',
  MD003: 'headings mix writing styles',
  MD004: 'the list mixes bullet styles',
  MD005: 'the list items are not aligned',
  MD007: 'the nested list has the wrong indentation',
  MD009: 'there are extra spaces at the end of the line',
  MD010: 'there is a tab instead of spaces',
  MD011: 'there is a link written backwards: (text)[address]',
  MD012: 'there are several blank lines in a row',
  MD018: 'a space is missing after the # of the heading',
  MD019: 'there are too many spaces after the # of the heading',
  MD022: 'a blank line is missing before or after a heading',
  MD023: 'the heading does not start at the beginning of the line',
  MD024: 'there are two headings with the same text',
  MD025: 'there is more than one Heading 1 on the page (Heading 1 is the page name; for sections, use Heading 2)',
  MD026: 'the heading ends with punctuation (e.g. ":" or ".")',
  MD027: 'there are too many spaces after the > of the quote',
  MD028: 'there is a blank line inside the quote',
  MD029: 'the list numbering is out of the standard',
  MD030: 'there are too many spaces after the list marker',
  MD031: 'a blank line is missing before or after a code block',
  MD032: 'a blank line is missing before or after a list',
  MD034: 'there is a bare address; turn it into a link',
  MD035: 'the horizontal lines mix styles',
  MD036: 'bold/italic text is used as a heading; use a real heading',
  MD037: 'there are spaces inside the bold/italic (e.g. "** text **")',
  MD038: 'there are spaces inside the inline code (e.g. "` code `")',
  MD039: 'there are spaces inside the link text (e.g. "[ text ]")',
  MD040: 'there is a code block without a language',
  MD041: 'the page does not start with a Heading 1',
  MD042: 'there is a link without an address',
  MD045: 'there is an image without alternative text',
  MD047: 'the file does not end with a blank line',
  MD049: 'the italic mixes styles (* and _)',
  MD050: 'the bold mixes styles (** and __)',
  MD051: 'there is a link to a section (#) that does not exist on the page',
  MD052: 'there is a link reference that was not defined',
  MD055: 'the | pipes of the table are out of the standard',
  MD056: 'a table row has a different number of columns than the header',
  MD058: 'a blank line is missing before or after a table',
};

const PT_BR: Record<string, string> = {
  MD001: 'os títulos pulam um nível (ex.: de Título 1 direto para Título 3)',
  MD003: 'os títulos misturam estilos de escrita',
  MD004: 'a lista mistura estilos de marcador',
  MD005: 'os itens da lista não estão alinhados',
  MD007: 'a lista dentro de outra lista está com recuo errado',
  MD009: 'há espaços sobrando no fim da linha',
  MD010: 'há tabulação (Tab) no lugar de espaços',
  MD011: 'há um link escrito ao contrário: (texto)[endereço]',
  MD012: 'há várias linhas em branco seguidas',
  MD018: 'falta um espaço depois do # do título',
  MD019: 'há espaços demais depois do # do título',
  MD022: 'falta uma linha em branco antes ou depois de um título',
  MD023: 'o título não começa no início da linha',
  MD024: 'há dois títulos com o mesmo texto',
  MD025: 'há mais de um Título 1 na página (o Título 1 é o nome da página; nas seções, use Título 2)',
  MD026: 'o título termina com pontuação (ex.: ":" ou ".")',
  MD027: 'há espaços demais depois do > da citação',
  MD028: 'há uma linha em branco dentro da citação',
  MD029: 'a numeração da lista está fora do padrão',
  MD030: 'há espaços demais depois do marcador da lista',
  MD031: 'falta uma linha em branco antes ou depois de um bloco de código',
  MD032: 'falta uma linha em branco antes ou depois de uma lista',
  MD034: 'há um endereço solto; transforme-o em link',
  MD035: 'as linhas horizontais misturam estilos',
  MD036: 'há um texto em negrito/itálico usado como título; use um título de verdade',
  MD037: 'há espaços dentro do negrito/itálico (ex.: "** texto **")',
  MD038: 'há espaços dentro do código no texto (ex.: "` código `")',
  MD039: 'há espaços dentro do texto do link (ex.: "[ texto ]")',
  MD040: 'há um bloco de código sem linguagem definida',
  MD041: 'a página não começa com um Título 1',
  MD042: 'há um link sem endereço',
  MD045: 'há uma imagem sem texto alternativo',
  MD047: 'o arquivo não termina com uma linha em branco',
  MD049: 'o itálico mistura estilos (* e _)',
  MD050: 'o negrito mistura estilos (** e __)',
  MD051: 'há um link para um trecho (#) que não existe na página',
  MD052: 'há uma referência de link que não foi definida',
  MD055: 'as barras | da tabela estão fora do padrão',
  MD056: 'uma linha da tabela tem número de colunas diferente do cabeçalho',
  MD058: 'falta uma linha em branco antes ou depois de uma tabela',
};

/** Textos de cada língua; `pt*` usa o português do Brasil, o resto o inglês. */
export const lintRuleTexts = (language: string): Record<string, string> =>
  language.toLowerCase().startsWith('pt') ? PT_BR : EN;

/** Texto do problema na língua da pessoa, ou `fallback` (a descrição do markdownlint) para regra sem texto. */
export function lintRuleText(rule: string, language: string, fallback: string): string {
  return lintRuleTexts(language)[rule] ?? fallback;
}
