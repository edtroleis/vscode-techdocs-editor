/**
 * Ponte entre o Markdown do MkDocs e o editor visual.
 *
 * O editor entende CommonMark + GFM. Sintaxe própria do MkDocs, como admonitions
 * (`!!! tip "Dica"` com corpo indentado) e abas (`=== "Aba"`), seria achatada num parágrafo
 * comum e quebraria a página.
 * Por isso, no editor, cada aviso, recolhível ou aba vira uma citação cuja primeira linha é o cabeçalho em código
 * (`` > `!!! tip "Dica"` ``) e o resto é o corpo, sem o recuo: o editor mostra o componente (spec 01, M1) e edita o
 * corpo como o resto da página. Ao salvar, volta ao formato do MkDocs, com o corpo recuado em 4 espaços. O front
 * matter entra como bloco de código com a linguagem `mkdocs` (texto cru).
 */

const RAW_LANG = 'mkdocs';

/**
 * Estilo do Markdown gerado pelo editor, o que as docs já usam: `-` em listas e `---` na linha
 * horizontal. O padrão do editor (`*` e `***`) mudaria o arquivo todo e geraria diffs enormes nos
 * PRs, e o lint reprova estilos misturados na mesma página (MD004, MD035).
 */
export const STRINGIFY_OPTIONS = { bullet: '-', rule: '-' } as const;

// Abertura de admonition/details ("!!! tipo", "??? tipo", "???+ tipo") ou de aba ('=== "Título"')
const BLOCK_START = /^(!!!|\?\?\?\+?|===\+?)\s+\S/;
// Abertura da grade de cards do Material ('<div class="grid cards" markdown>'), fechada pelo '</div>' na coluna 0
const CARDS_START = /^<div\s+class="grid cards"[^>]*\smarkdown(="[^"]*")?[^>]*>\s*$/;
const CARDS_END = /^<\/div>\s*$/;

/** O cabeçalho em código: a cerca de crases maior que qualquer sequência dentro dele. */
function quoteHeader(header: string): string {
  const longest = Math.max(0, ...(header.match(/`+/g) ?? []).map(m => m.length));
  const fence = '`'.repeat(longest + 1);
  return longest ? `${fence} ${header} ${fence}` : `${fence}${header}${fence}`;
}

/** Os avisos, recolhíveis e abas (na coluna 0, fora de blocos de código) viram citações com o cabeçalho em código. */
function blocksToEditor(lines: string[]): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence || marker) {
      if (!fence) fence = marker![1];
      else if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      out.push(lines[i++]);
      continue;
    }
    const cards = CARDS_START.test(line) && lines.slice(i + 1).some(l => CARDS_END.test(l));
    if (!BLOCK_START.test(line) && !cards) {
      out.push(lines[i++]);
      continue;
    }
    const header = lines[i++].replace(/\s+$/, '');
    if (cards) {
      // Os cards: a lista até o </div>, sem recuo
      const body: string[] = [];
      while (!CARDS_END.test(lines[i])) body.push(lines[i++]);
      i++;
      while (body.length && !body[0].trim()) body.shift();
      while (body.length && !body[body.length - 1].trim()) body.pop();
      if (out.length && out[out.length - 1].trim()) out.push('');
      out.push(`> ${quoteHeader(header)}`);
      const inner = blocksToEditor(body);
      if (inner.length) out.push('>', ...inner.map(l => (l ? `> ${l}` : '>')));
      if (i < lines.length && lines[i].trim()) out.push('');
      continue;
    }
    // Corpo: linhas indentadas (ou em branco seguidas de mais corpo indentado), sem o recuo
    const body: string[] = [];
    while (i < lines.length) {
      if (/^( {4}|\t)/.test(lines[i])) body.push(lines[i++].replace(/^( {4}|\t)/, ''));
      else if (lines[i].trim() === '' && i + 1 < lines.length && /^( {4}|\t)/.test(lines[i + 1])) {
        body.push('');
        i++;
      } else break;
    }
    while (body.length && !body[0].trim()) body.shift();
    // A citação precisa de uma linha em branco antes (senão continua o parágrafo de cima)
    if (out.length && out[out.length - 1].trim()) out.push('');
    out.push(`> ${quoteHeader(header)}`);
    const inner = blocksToEditor(body);
    if (inner.length) out.push('>', ...inner.map(l => (l ? `> ${l}` : '>')));
    // E uma depois, para o que vem em seguida não entrar na citação
    if (i < lines.length && lines[i].trim()) out.push('');
  }
  return out;
}

/** Markdown do repositório → Markdown para o editor. */
export function toEditor(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let start = 0;
  // Front matter (`---` na 1ª linha até o próximo `---`): o editor faria dele uma linha horizontal e um parágrafo
  // ("title: … tags:"); entra protegido, como texto cru
  const frontEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (frontEnd > 1 && /^[\w-]+:/.test(lines[1])) {
    out.push('```' + RAW_LANG, ...lines.slice(0, frontEnd + 1), '```');
    start = frontEnd + 1;
  }
  out.push(...blocksToEditor(lines.slice(start)));
  // Blocos sem linguagem já aparecem como `text` no editor (o mesmo que será salvo)
  return defaultCodeLanguage(out.join('\n'));
}

/** Linguagem dada a blocos de código sem linguagem (o markdownlint exige uma: MD040). */
export const DEFAULT_CODE_LANG = 'text';

type LineContext = {
  /** Linha que abre um bloco de código, e o que vem depois da cerca (linguagem). */
  opensCode?: { info: string };
  /** Linha dentro de um bloco de código (inclui a cerca de fechamento). */
  inCode: boolean;
  /** Última linha já emitida. */
  previous?: string;
};

/** Linha de texto e o índice (0-based) da linha de origem no Markdown do editor. */
type Line = { text: string; origin: number };

const toLines = (markdown: string): Line[] => markdown.split('\n').map((text, origin) => ({ text, origin }));
const joinLines = (lines: Line[]) => lines.map(l => l.text).join('\n');

/** Reescreve as linhas sabendo quais estão em blocos de código; `null` remove a linha. */
function mapLines(lines: Line[], fn: (line: string, ctx: LineContext) => string | null): Line[] {
  const out: Line[] = [];
  let fence: string | undefined;
  for (const { text: line, origin } of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    let ctx: LineContext;
    if (fence) {
      ctx = { inCode: true };
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined;
      }
    } else if (marker) {
      fence = marker[1];
      ctx = { inCode: false, opensCode: { info: marker[2].trim() } };
    } else {
      ctx = { inCode: false };
    }
    const mapped = fn(line, { ...ctx, previous: out[out.length - 1]?.text });
    if (mapped !== null) out.push({ text: mapped, origin });
  }
  return out;
}

const withDefaultCodeLanguage = (lines: Line[]) =>
  mapLines(lines, (line, { opensCode }) =>
    opensCode && !opensCode.info ? `${line}${DEFAULT_CODE_LANG}` : line,
  );

/** Bloco de código sem linguagem ganha `text`. */
export function defaultCodeLanguage(markdown: string) {
  return joinLines(withDefaultCodeLanguage(toLines(markdown)));
}

/**
 * Ajustes no Markdown que o editor gera, fora dos blocos de código:
 * - bloco de código sem linguagem ganha `text`;
 * - linhas só com `<br />` (Enter em linha vazia) saem;
 * - imagens sem endereço (bloco de imagem deixado vazio) saem;
 * - espaços no fim da linha saem (o lint reprova, MD009; quebra de linha do editor sai como `\`);
 * - marcador de lista sempre `-` e `1.`: com duas listas seguidas, o editor usa `*` e `1)` na
 *   segunda para não juntá-las, e o lint reprova estilos misturados (MD004). As listas se juntam;
 * - mais de uma linha em branco seguida vira uma.
 */
/**
 * Tira as barras que o editor põe antes de `&` e de `@` (`?a=1\&b=2`, `hello\@x.com`): no CommonMark são
 * escapes, mas o Python-Markdown do MkDocs não os conhece e mantém a barra, e o link, a imagem ou o e-mail quebram.
 * O `&` que forma uma entidade (`\&amp;`) continua escapado; dentro de código (`` `…` ``) nada muda.
 * Também a barra que ele põe no ponto depois de um `w` (`flow\.html`, `treeView\.html`), por cautela com os links
 * `www.` do GFM: só `www.` vira link, e esse continua escapado.
 */
const unescapeForMkdocs = (line: string) =>
  line
    .split(/(`+[^`]*?`+)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\\&(?!#?\w+;)/g, '&').replace(/\\@/g, '@').replace(/(?<!ww)(?<=w)\\\./gi, '.')))
    .join('');

const tidy = (lines: Line[]) =>
  mapLines(withDefaultCodeLanguage(lines), (original, { inCode, opensCode, previous }) => {
    if (inCode || opensCode) return original;
    let line = original.replace(/[ \t]+$/, '');
    // "* * *" é linha horizontal, não lista
    if (!/^\s*(\*\s*){3,}$/.test(line)) {
      line = line.replace(/^(\s*(?:>\s*)*)\*(\s+)(?=\S)/, '$1-$2').replace(/^(\s*(?:>\s*)*\d+)\)(\s)/, '$1.$2');
    }
    line = unescapeForMkdocs(line);
    if (line.trim() === '<br />') return null;
    // Bloco de imagem inserido e deixado sem imagem
    if (/^!\[[^\]]*\]\(\s*\)$/.test(line.trim())) return null;
    if (line.trim() === '' && previous !== undefined && previous.trim() === '') return null;
    return line;
  });

/**
 * Numera em sequência os itens de cada lista numerada. Duas listas numeradas seguidas no editor
 * viram uma só no arquivo (ver tidy), e a numeração recomeçava no meio (1, 2, 1, 2): o lint reprova
 * (MD029). Cada lista continua a partir do primeiro número dela; lista escrita só com "1." (o
 * segundo item repete o número do primeiro) continua assim, que também é válido.
 */
const renumberOrderedLists = (lines: Line[]) => {
  // Listas abertas, da mais externa para a mais interna: recuo e próximo número
  const open: Array<{ indent: number; first: number; next: number; same?: boolean }> = [];
  return mapLines(lines, (line, { inCode, opensCode }) => {
    if (inCode || opensCode || line.trim() === '') return line;
    const item = line.match(/^(\s*)(\d+)\.(\s.*)$/);
    const indent = (item ? item[1] : line.match(/^\s*/)![0]).length;
    // Uma linha com recuo menor ou igual ao de uma lista termina essa lista (a não ser o próprio item)
    while (open.length && (open[open.length - 1].indent > indent || (!item && open[open.length - 1].indent >= indent))) {
      open.pop();
    }
    if (!item) return line;
    const current = open[open.length - 1];
    if (current?.indent === indent) {
      // O segundo item define o estilo: repetir o número ou contar
      current.same ??= Number(item[2]) === current.first;
      const number = current.same ? current.first : current.next++;
      return `${item[1]}${number}.${item[3]}`;
    }
    open.push({ indent, first: Number(item[2]), next: Number(item[2]) + 1 });
    return line;
  });
};

/** Tira as cercas `mkdocs` que protegiam admonitions/abas no editor, devolvendo o texto original. */
function restoreRawBlocks(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].text.match(new RegExp(`^(\`{3,})${RAW_LANG}$`));
    const close = open && lines.findIndex((l, j) => j > i && l.text === open[1]);
    if (open && close && close > 0) {
      out.push(...lines.slice(i + 1, close));
      i = close;
    } else {
      out.push(lines[i]);
    }
  }
  return out;
}

/** A linha de cabeçalho de um aviso, recolhível ou aba no editor: `` > `!!! tip "Dica"` ``. */
const QUOTED_HEADER = /^> ?(`+) ?((?:!!!|\?\?\?\+?|===\+?)\s+\S.*?|<div\s+class="grid cards"[^`]*>) ?\1\s*$/;

/**
 * As citações com cabeçalho voltam ao formato do MkDocs: o cabeçalho e o corpo recuado em 4 espaços (as de dentro,
 * antes). `process` ajusta o resto do texto (tidy e companhia), em cada nível, fora dos componentes.
 */
function restoreComponents(lines: Line[], process: (lines: Line[]) => Line[]): Line[] {
  const out: Line[] = [];
  let plain: Line[] = [];
  let fence: string | undefined;
  const flush = () => {
    out.push(...process(plain));
    plain = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const { text } = lines[i];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence || marker) {
      if (!fence) fence = marker![1];
      else if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      plain.push(lines[i]);
      continue;
    }
    const header = QUOTED_HEADER.exec(text);
    if (!header) {
      plain.push(lines[i]);
      continue;
    }
    flush();
    let end = i + 1;
    while (end < lines.length && lines[end].text.startsWith('>')) end++;
    const body = lines.slice(i + 1, end).map(l => ({ ...l, text: l.text.replace(/^> ?/, '') }));
    while (body.length && !body[0].text.trim()) body.shift();
    const inner = restoreComponents(body, process);
    while (inner.length && !inner[inner.length - 1].text.trim()) inner.pop();
    if (header[2].startsWith('<div')) {
      // Os cards: o <div>, a lista (como o editor a grava: "- " e o card recuado em 2, que o techdocs-core aceita e
      // o lint pede) e o </div>. As linhas novas não têm origem no editor: não mudam os números de linha
      out.push({ ...lines[i], text: header[2] }, { text: '', origin: -1 }, ...inner);
      out.push({ text: '', origin: -1 }, { text: '</div>', origin: -1 });
      i = end - 1;
      continue;
    }
    // As abas levam uma linha em branco entre o título e o corpo, como na documentação do pymdownx
    const tab = header[2].startsWith('===');
    out.push({ ...lines[i], text: header[2] });
    // (a linha nova aponta para o corpo, que vem logo depois: o título continua na linha dele)
    if (tab && inner.length) out.push({ text: '', origin: inner[0].origin });
    out.push(...inner.map(l => ({ ...l, text: l.text.trim() ? `    ${l.text}` : '' })));
    i = end - 1;
  }
  flush();
  return out;
}

// tidy antes de restaurar: os blocos do MkDocs ainda estão protegidos dentro de cercas
/** Largura a partir da qual a tabela sai compacta (spec 05, C8). */
const WIDE_TABLE = 120;

/** As células de uma linha de tabela (`| a | b |`), sem cortar no `\|` escapado. */
const tableCells = (row: string) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());

/**
 * Tabela com alguma linha mais larga que `WIDE_TABLE` sai compacta: um espaço em volta de cada célula, em vez de
 * todas completadas até a maior (tabelas coladas do Confluence davam linhas de centenas de caracteres, difíceis de
 * ler e de revisar no PR). As estreitas continuam alinhadas, como o editor escreve.
 */
const compactWideTables = (lines: Line[]): Line[] => {
  const out = [...lines];
  let fence: string | undefined;
  for (let i = 0; i < out.length; i++) {
    const marker = out[i].text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = undefined;
      continue;
    }
    if (fence || !/^\s*\|/.test(out[i].text) || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(out[i + 1]?.text ?? '')) continue;
    let end = i + 2;
    while (end < out.length && /^\s*\|/.test(out[end].text)) end++;
    if (out.slice(i, end).some(l => l.text.length > WIDE_TABLE)) {
      for (let j = i; j < end; j++) {
        const cells = tableCells(out[j].text).map(c =>
          j === i + 1 ? (c.startsWith(':') ? ':' : '-') + '-' + (c.endsWith(':') ? ':' : '-') : c,
        );
        // Célula vazia com um espaço só (`| |`): com dois, o lint reclama do estilo (MD060)
        out[j] = { ...out[j], text: `|${cells.map(c => (c ? ` ${c} ` : ' ')).join('|')}|` };
      }
    }
    i = end - 1;
  }
  return out;
};

const toRepoLines = (markdown: string) =>
  restoreRawBlocks(restoreComponents(toLines(markdown), lines => compactWideTables(renumberOrderedLists(tidy(lines)))));

/** Markdown do editor → Markdown do repositório. */
export function fromEditor(markdown: string): string {
  const restored = joinLines(toRepoLines(markdown));
  return restored.endsWith('\n') ? restored : `${restored}\n`;
}

/**
 * Para cada linha do Markdown do editor (índice 0-based), a linha (1-based) correspondente no
 * arquivo. Linhas que não existem no arquivo apontam para a próxima que existe.
 * `saved: true` conta como o arquivo vai ficar ao salvar (com os ajustes); `false`, como está no
 * último commit (as linhas que a pipeline aponta).
 */
export function repoLineNumbers(markdown: string, { saved }: { saved: boolean }): number[] {
  const total = markdown.split('\n').length;
  const map = new Array<number>(total);
  const lines = saved ? toRepoLines(markdown) : restoreRawBlocks(restoreComponents(toLines(markdown), l => l));
  lines.forEach((line, index) => {
    map[line.origin] = index + 1;
  });
  let next = map.filter(Boolean).length + 1;
  for (let i = total - 1; i >= 0; i--) {
    if (map[i] === undefined) map[i] = next;
    else next = map[i];
  }
  return map;
}

/** Caminho relativo de `to` a partir da pasta `fromDir` (ambos relativos à raiz do repositório). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const target = to.split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++;
  return [...from.slice(common).map(() => '..'), ...target.slice(common)].join('/');
}

/** Resolve um caminho relativo (ex.: "../assets/x.png") a partir da pasta `dir`. */
export function resolvePath(dir: string, relative: string): string {
  const parts = dir.split('/').filter(Boolean);
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');

/**
 * Candidatos de arquivo para uma página do TechDocs, na ordem em que o MkDocs resolve.
 * `docsDir` é a pasta das docs no repositório (ex.: "docs"); `page` é o caminho da página
 * na URL do TechDocs (ex.: "guias/primeiros-passos").
 */
export function pageFileCandidates(docsDir: string, page: string): string[] {
  const clean = page.replace(/^\/+|\/+$/g, '');
  const base = docsDir.replace(/\/+$/, '');
  if (!clean) return [`${base}/index.md`, `${base}/README.md`];
  return [`${base}/${clean}.md`, `${base}/${clean}/index.md`, `${base}/${clean}/README.md`];
}

/** Lê `docs_dir` do mkdocs.yml (padrão do MkDocs: "docs"). */
export function docsDirFromMkdocs(mkdocsYml: string | undefined): string {
  const match = mkdocsYml?.match(/^docs_dir:\s*['"]?([^'"\n#]+?)['"]?\s*(#.*)?$/m);
  return match ? match[1] : 'docs';
}
