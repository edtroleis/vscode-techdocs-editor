// Relatório da vitrine no Backstage: resumo, sugestões tiradas do que a conferência achou e a captura de cada página
// com os problemas dela. Uma página HTML sem dependências, com as capturas ao lado (shots/).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Tipos de diagrama que o addon do Mermaid do Backstage (Mermaid 11) não desenha. */
const NOT_IN_BACKSTAGE = /^(usecase|agentflow|zenuml)$/;
/** A palavra que abre o diagrama, sem o front matter e os comentários (como o diagramKind do editor). */
const kindOf = code => {
  const body = String(code ?? '').replace(/^\s*---\r?\n[\s\S]*?\r?\n---[^\n]*\n/, '');
  const line = body.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%')) ?? '';
  return (/^[A-Za-z0-9]+/.exec(line)?.[0] ?? '').toLowerCase().replace(/beta$/, '');
};

/** Os problemas de uma página, em linguagem simples, com a gravidade. */
export function problemsOf(r) {
  const list = [];
  const add = (level, text) => list.push({ level, text });
  if (r.failure) add('erro', `A página não abriu no Backstage: ${r.failure}`);
  else if (!r.loaded) add('erro', 'O TechDocs não mostrou o conteúdo');
  const diagrams = r.diagrams ?? [];
  const errors = diagrams.filter(d => d.error).length;
  const drawn = diagrams.filter(d => d.drawn).length;
  if (errors) add('erro', `${errors} de ${diagrams.length} diagramas com erro de sintaxe no Mermaid do Backstage`);
  const missing = r.loaded ? r.expectedDiagrams - drawn - errors : 0;
  if (missing > 0) {
    // Tipos que o Mermaid do Backstage não tem: o editor já avisa (M23, M32); não é erro da página
    const known = diagrams.filter(d => !d.drawn && !d.error && NOT_IN_BACKSTAGE.test(kindOf(d.raw))).length;
    if (missing - known > 0) add('erro', `${missing - known} de ${r.expectedDiagrams} diagramas não desenhados (ficou o código ou nada)`);
    if (known) add('aviso', `${known} diagramas de tipos que o Mermaid do Backstage não tem (Mermaid 12 ou ZenUML): o editor avisa ao escrever`);
  }
  const small = diagrams.filter(d => d.drawn && d.scale < 0.6).length;
  if (small) add('aviso', `${small} diagramas encolhidos para caber (texto menor que 60%): difíceis de ler no Backstage, que não tem zoom`);
  const wide = diagrams.filter(d => d.overflow).length;
  if (wide) add('aviso', `${wide} diagramas mais largos que a página: precisam de rolagem lateral`);
  if (r.wideTables) add('aviso', `${r.wideTables} tabelas mais largas que a página`);
  for (const p of r.placeholders ?? []) add('erro', `Campo de template sem valor na página: ${p}`);
  for (const t of r.raw ?? []) add('erro', `Markdown que não virou formatação: "${t}"`);
  for (const src of r.images ?? []) add('erro', `Imagem quebrada: ${src}`);
  if (r.seconds > 15) add('aviso', `Demorou ${r.seconds.toFixed(0)} s para abrir e desenhar`);
  for (const c of (r.console ?? []).slice(0, 3)) add('info', `Erro no console do navegador: ${c}`);
  return list;
}

/** O que cada achado do Conferir da extensão quer dizer, para quem lê o relatório. */
const FINDING_TEXT = {
  'site-name-missing': 'mkdocs.yml sem site_name',
  'techdocs-plugin-missing': 'mkdocs.yml sem o plugin techdocs-core',
  'docs-dir-missing': 'o diretório das páginas não existe',
  'index-missing': 'sem página inicial (index.md)',
  'nav-page-missing': 'o menu aponta para uma página que não existe',
  'page-not-in-nav': 'página fora do menu',
  'catalog-missing': 'sem catalog-info.yaml',
  'catalog-ref-missing': 'catalog-info.yaml sem a anotação do TechDocs',
  'lint-config-missing': 'sem o arquivo de regras do markdownlint',
  'lint-problems': 'problemas de formatação',
  'broken-link': 'link quebrado',
  'missing-image': 'imagem que não existe',
  'local-portal-link': 'link com o endereço do Backstage da máquina (localhost): o Conferir corrige com um clique',
  'mermaid-config-missing': 'diagramas sem a configuração do Mermaid no mkdocs.yml',
  'mermaid-too-big': 'diagrama maior que o limite do Mermaid',
};

/** O resultado da validação de uma doc em números. */
export function validationSummary(v) {
  const findings = (v.findings ?? []).filter(f => f.severity !== 'hint');
  const errors = findings.filter(f => f.severity === 'error').length;
  const roundtrip = v.roundtrip ?? [];
  // Mudou o que o Backstage mostra (o HTML do MkDocs), ou o editor mandou edição só de abrir: erro. Só o texto: formatação
  const broken = roundtrip.filter(r => r.edits || r.failure || r.sameHtml === false).length;
  const formatted = roundtrip.filter(r => !r.same && !r.edits && !r.failure && r.sameHtml !== false).length;
  return { findings, errors, warnings: findings.length - errors, lint: (v.lint ?? []).length, changed: broken, formatted, pages: roundtrip.length };
}

function validationSuggestions(validation) {
  if (!validation) return [];
  const out = [];
  const all = validation.map(v => ({ v, s: validationSummary(v) }));
  const changed = all.filter(x => x.s.changed);
  if (changed.length)
    out.push({
      title: 'Páginas que o editor visual muda no Backstage',
      text: `${changed.reduce((n, x) => n + x.s.changed, 0)} páginas em ${changed.length} docs ficariam diferentes no Backstage depois de abrir e salvar no editor visual (o HTML do MkDocs muda, com o mkdocs.yml do site). Ver o antes e depois em "Validação na extensão".`,
    });
  const lint = all.filter(x => x.s.lint);
  if (lint.length)
    out.push({
      title: 'Problemas de formatação nas docs publicadas',
      text: `${lint.reduce((n, x) => n + x.s.lint, 0)} problemas do markdownlint em ${lint.length} docs. A maioria o botão "Corrigir automaticamente" resolve; a extensão pode oferecer corrigir a doc inteira de uma vez ao abrir o site.`,
    });
  const codes = new Map();
  for (const { v } of all) for (const f of v.findings ?? []) if (f.severity !== 'hint' && f.code !== 'lint-problems') codes.set(f.code, (codes.get(f.code) ?? 0) + 1);
  if (codes.size)
    out.push({
      title: 'O que o Conferir aponta nas docs do catálogo',
      text: [...codes].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${FINDING_TEXT[code] ?? code}: ${n}`).join(' · '),
    });
  const skipped = validation.filter(v => v.reason);
  if (skipped.length) out.push({ title: 'Docs que não deu para validar', text: skipped.map(v => `${v.name}: ${v.reason}`).join(' · ') });
  return out;
}

function validationSection(validation) {
  if (!validation) return '';
  const rows = validation
    .map(v => {
      const s = validationSummary(v);
      const status = v.reason || v.failure ? 'warn' : s.errors || s.changed ? 'bad' : s.warnings || s.lint ? 'warn' : 'good';
      const details = [
        ...s.findings.map(f => `<li class="${f.severity === 'error' ? 'erro' : 'aviso'}">${esc(FINDING_TEXT[f.code] ?? f.code)}${f.target ? `: ${esc(f.target)}` : ''} <span class="muted">(${esc(f.file)}${f.line ? `:${f.line}` : ''})</span></li>`),
        ...(v.roundtrip ?? [])
          .filter(r => r.edits || r.failure || r.sameHtml === false)
          .map(r => `<li class="erro">Muda no Backstage ao salvar no editor: ${esc(r.page)} — ${esc(r.failure ?? (r.edits ? `${r.edits} edições só de abrir` : r.diff))}${r.before ? `<br><span class="muted">antes: ${esc(r.before)}<br>depois: ${esc(r.after)}</span>` : ''}</li>`),
        ...(v.roundtrip ?? [])
          .filter(r => !r.same && !r.edits && !r.failure && r.sameHtml !== false)
          .map(r => `<li class="info">${r.spacingOnly ? 'Muda só o espaço entre os itens de uma lista no Backstage (o editor separa os itens com linha em branco)' : 'Só a formatação do arquivo muda ao salvar (o Backstage mostra igual)'}: ${esc(r.page)} — ${esc(r.diff)}${r.renderError ? ` (sem comparar o HTML: ${esc(r.renderError)})` : ''}</li>`),
        ...(v.lint ?? []).slice(0, 30).map(l => `<li class="info">${esc(l.page)}:${l.line} ${esc(l.rule)} ${esc(l.message)}</li>`),
        ...((v.lint ?? []).length > 30 ? [`<li class="info">… e mais ${(v.lint ?? []).length - 30}</li>`] : []),
      ];
      return `<tr class="${status}"><td>${esc(v.title)}${v.showcase ? ' <span class="muted">(vitrine)</span>' : ''}<br><span class="muted">${esc(v.site ?? v.reason ?? '')}</span></td>
        <td>${v.reason ? '—' : s.errors}</td><td>${v.reason ? '—' : s.warnings}</td><td>${v.reason ? '—' : s.lint}</td><td>${v.reason ? '—' : `${s.pages - s.changed}/${s.pages}${s.formatted ? ` <span class="muted">(${s.formatted} só formatação)</span>` : ''}`}</td>
        <td>${details.length ? `<details><summary>${details.length} itens</summary><ul>${details.join('')}</ul></details>` : v.reason ? esc(v.reason) : '<span class="ok">ok</span>'}</td></tr>`;
    })
    .join('');
  return `<h2 id="validacao">Validação na extensão</h2>
  <p class="muted">Todas as docs do catálogo do Backstage, pelo código da extensão: o "Conferir a documentação" (o mesmo da árvore e do painel Problemas) e a ida e volta no editor visual (abrir e salvar sem mudar nada).</p>
  <div class="scroll"><table class="validation"><tr><th>Doc</th><th>Erros</th><th>Avisos</th><th>Formatação</th><th>Iguais no Backstage após salvar</th><th>Detalhes</th></tr>${rows}</table></div>`;
}

/** Sugestões: o que se repete nas páginas vira uma proposta para a extensão ou para os templates. */
function suggestions(results) {
  const pages = results.map(r => ({ r, problems: problemsOf(r) }));
  const count = test => pages.filter(p => p.problems.some(x => test(x.text))).length;
  const out = [];
  const syntax = results.filter(r => r.diagrams?.some(d => d.error));
  if (syntax.length)
    out.push({
      title: 'Diagramas que o Mermaid do Backstage não entende',
      text: `${syntax.reduce((n, r) => n + r.diagrams.filter(d => d.error).length, 0)} diagramas em ${syntax.length} páginas dão erro de sintaxe no Backstage. O editor já desenha com o Mermaid dele; vale o Conferir apontar, antes de publicar, os tipos e a sintaxe que o addon do Backstage (a versão configurada) ainda não tem, com o nome do diagrama e a linha, e a galeria esconder ou marcar esses modelos.`,
      pages: syntax.map(r => r.url),
    });
  const missing = count(t => t.includes('não desenhados'));
  if (missing)
    out.push({
      title: 'Diagramas que não aparecem',
      text: `Em ${missing} páginas algum diagrama não foi desenhado (nem erro, nem desenho). Conferir se o mkdocs.yml tem o fence do Mermaid e se o addon carrega; a extensão pode avisar quando o site não tem a configuração.`,
    });
  const small = count(t => t.includes('encolhidos'));
  if (small)
    out.push({
      title: 'Diagramas grandes ficam ilegíveis',
      text: `Em ${small} páginas há diagramas encolhidos para caber na largura (a página do TechDocs tem a largura da janela menos uns 814 px). No Backstage não há zoom. O editor avisa ao escrever (M32), mostra o desenho na largura do TechDocs e vira o fluxograma de cima para baixo com um clique; nos exemplos daqui, dividir em dois ou desenhar de cima para baixo.`,
    });
  const wide = count(t => t.includes('mais largos') || t.includes('tabelas'));
  if (wide)
    out.push({
      title: 'Conteúdo mais largo que a página',
      text: `${wide} páginas têm diagramas ou tabelas que pedem rolagem lateral. Para quem lê, a rolagem escondida passa despercebida: sugerir quebrar tabelas largas e diagramas LR longos.`,
    });
  const raw = count(t => t.startsWith('Markdown que não virou') || t.startsWith('Campo de template'));
  if (raw)
    out.push({
      title: 'Texto técnico aparecendo para o leitor',
      text: `${raw} páginas mostram marcação crua ou campos {{ }} sem valor. O editor deve impedir publicar assim: avisar no Conferir e no painel de publicação.`,
    });
  const slow = count(t => t.startsWith('Demorou'));
  if (slow) out.push({ title: 'Páginas lentas', text: `${slow} páginas levaram mais de 15 s. Páginas com muitos diagramas (como os exemplos do mermaid.js.org) poderiam ser divididas.` });
  if (!out.length) out.push({ title: 'Nada se repetiu', text: 'Todas as páginas abriram e todos os diagramas foram desenhados.' });
  return out;
}

/** As docs do catálogo publicadas como o editor gravaria, comparadas com o original no Backstage. */
function editedSection(edited) {
  if (!edited) return '';
  const different = edited.filter(e => !e.same);
  const rows = different
    .map(
      e => `<article class="card bad"><div class="pair"><a class="shot" href="${esc(e.before)}" target="_blank"><img loading="lazy" src="${esc(e.before)}" alt="Antes"></a><a class="shot" href="${esc(e.after)}" target="_blank"><img loading="lazy" src="${esc(e.after)}" alt="Depois"></a></div>
      <div class="body"><h4><a href="${esc(e.url)}" target="_blank">${esc(e.title)} · ${esc(e.page)}</a></h4><ul>
      ${e.failure ? `<li class="erro">${esc(e.failure)}</li>` : ''}${e.shape.map(s => `<li class="erro">${esc(s)}</li>`).join('')}
      ${e.textDiff ? `<li class="aviso">Texto antes: “${esc(e.textDiff.before)}”<br>depois: “${esc(e.textDiff.after)}”</li>` : ''}</ul></div></article>`,
    )
    .join('');
  const docs = new Set(edited.map(e => e.doc)).size;
  return `<h2 id="editadas">Editadas no editor e publicadas</h2>
  <p class="muted">As ${docs} docs do catálogo que o editor muda ao salvar, publicadas no Backstage como estão e como o editor gravaria; as ${edited.length} páginas abertas nas duas versões e comparadas pelo que a pessoa vê (texto, títulos, listas, tabelas, avisos, abas, diagramas, imagens, links). No fim, o original foi publicado de novo.</p>
  ${different.length ? `<div class="grid">${rows}</div>` : `<p class="ok">As ${edited.length} páginas aparecem iguais no Backstage.</p>`}`;
}

export function writeReport({ out, manifest, entities, results, validation, editedPublished, frontend, elapsed }) {
  const byEntity = entities.map(e => ({ e, rows: results.filter(r => r.entity === e.name) }));
  const all = results.map(r => ({ r, problems: problemsOf(r) }));
  const diagrams = {
    expected: results.reduce((n, r) => n + (r.expectedDiagrams ?? 0), 0),
    ok: results.reduce((n, r) => n + (r.diagrams?.filter(d => d.drawn).length ?? 0), 0),
    errors: results.reduce((n, r) => n + (r.diagrams?.filter(d => d.error).length ?? 0), 0),
  };
  const withProblems = all.filter(p => p.problems.some(x => x.level === 'erro')).length;
  const card = ({ r, problems }) => `
    <article class="card ${problems.some(p => p.level === 'erro') ? 'bad' : problems.length ? 'warn' : 'good'}" data-level="${problems.some(p => p.level === 'erro') ? 'erro' : problems.length ? 'aviso' : 'ok'}">
      <a class="shot" href="${esc(r.shot)}" target="_blank"><img loading="lazy" src="${esc(r.shot)}" alt="Captura de ${esc(r.title)}"></a>
      <div class="body">
        <h4><a href="${esc(r.url)}" target="_blank">${esc(r.title)}</a></h4>
        <p class="path">${esc(r.path)} · ${r.expectedDiagrams ? `${r.diagrams?.filter(d => d.drawn).length ?? 0}/${r.expectedDiagrams} diagramas · ` : ''}${r.seconds.toFixed(1)} s</p>
        ${problems.length ? `<ul>${problems.map(p => `<li class="${p.level}">${esc(p.text)}</li>`).join('')}</ul>` : '<p class="ok">Sem problemas</p>'}
      </div>
    </article>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vitrine no Backstage</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--muted:#5b6475;--line:#dde1e8;--bad:#c62828;--warn:#b26a00;--good:#2e7d32;--accent:#0b6bcb}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--fg:#e6e9ef;--muted:#9aa3b2;--line:#2e343e;--bad:#ef6b6b;--warn:#f0b454;--good:#6cc070;--accent:#6aa9ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header,main{max-width:1280px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left))}
h1{font-size:28px;margin:0 0 4px}h2{margin:32px 0 12px;font-size:21px}h3{margin:28px 0 8px;font-size:17px}
.muted{color:var(--muted)}.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}.stat b{display:block;font-size:24px}
.sugg{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:12px 16px;margin:10px 0}
.sugg h4{margin:0 0 4px}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}
.filters button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:16px;padding:4px 12px;cursor:pointer}
.filters button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--good);border-radius:8px;overflow:hidden;min-width:0}
.card.warn{border-top-color:var(--warn)}.pair{display:grid;grid-template-columns:1fr 1fr;gap:2px}.card.bad{border-top-color:var(--bad)}
.shot{display:block;height:180px;overflow:hidden;border-bottom:1px solid var(--line)}.shot img{width:100%;display:block}
.body{padding:10px 12px}.body h4{margin:0;font-size:15px}.body a{color:var(--accent)}.path{margin:2px 0 6px;color:var(--muted);font-size:13px;word-break:break-all}
ul{margin:0;padding-left:18px;font-size:13px}li.erro{color:var(--bad)}li.aviso{color:var(--warn)}li.info{color:var(--muted)}.ok{color:var(--good);font-size:13px;margin:0}
table{border-collapse:collapse;width:100%;background:var(--card)}tr.bad td:first-child{border-left:4px solid var(--bad)}tr.warn td:first-child{border-left:4px solid var(--warn)}tr.good td:first-child{border-left:4px solid var(--good)}details summary{cursor:pointer}td,th{border:1px solid var(--line);padding:6px 10px;text-align:left}.scroll{overflow-x:auto}
</style></head><body>
<header>
  <h1>Vitrine no Backstage</h1>
  <p class="muted">Templates ${esc(manifest.templates.ref)} e diagramas publicados no Backstage local (${esc(frontend)}) e abertos como uma pessoa abriria. Rodada em ${esc(new Date().toLocaleString('pt-BR'))}, em ${esc(elapsed)}.</p>
  <div class="stats">
    <div class="stat"><b>${entities.length}</b>docs</div>
    <div class="stat"><b>${results.length}</b>páginas</div>
    <div class="stat"><b style="color:var(--bad)">${withProblems}</b>páginas com erro</div>
    <div class="stat"><b>${diagrams.ok}/${diagrams.expected}</b>diagramas desenhados</div>
    <div class="stat"><b style="color:var(--bad)">${diagrams.errors}</b>diagramas com erro</div>
    ${validation ? `<div class="stat"><b>${validation.length}</b><a href="#validacao">docs do catálogo validadas</a></div>` : ''}
    ${editedPublished ? `<div class="stat"><b>${editedPublished.filter(e => !e.same).length}/${editedPublished.length}</b><a href="#editadas">páginas diferentes depois do editor</a></div>` : ''}
  </div>
</header>
<main>
  <h2>Sugestões</h2>
  ${[...suggestions(results), ...validationSuggestions(validation)].map(s => `<div class="sugg"><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p></div>`).join('')}
  ${validationSection(validation)}
  ${editedSection(editedPublished)}
  <h2>Docs no Backstage</h2>
  <div class="scroll"><table><tr><th>Doc</th><th>Páginas</th><th>Com erro</th><th>Diagramas</th></tr>
  ${byEntity.map(({ e, rows }) => `<tr><td><a href="#${esc(e.name)}">${esc(e.title)}</a></td><td>${rows.length}</td><td>${rows.filter(r => problemsOf(r).some(p => p.level === 'erro')).length}</td><td>${rows.reduce((n, r) => n + (r.diagrams?.filter(d => d.drawn).length ?? 0), 0)}/${rows.reduce((n, r) => n + r.expectedDiagrams, 0)}</td></tr>`).join('')}
  </table></div>
  <div class="filters" role="group" aria-label="Mostrar">
    <button type="button" data-show="all" aria-pressed="true">Todas</button><button type="button" data-show="erro" aria-pressed="false">Só com erro</button><button type="button" data-show="aviso" aria-pressed="false">Com aviso</button>
  </div>
  ${byEntity.map(({ e, rows }) => `<h3 id="${esc(e.name)}">${esc(e.title)} <a class="muted" href="${esc(`${frontend}/docs/default/component/${e.name}/`)}" target="_blank">abrir no Backstage</a></h3><div class="grid">${rows.map(r => card({ r, problems: problemsOf(r) })).join('')}</div>`).join('')}
</main>
<script>
document.querySelector('.filters').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  for (const b of document.querySelectorAll('.filters button')) b.setAttribute('aria-pressed', String(b === button));
  const show = button.dataset.show;
  for (const card of document.querySelectorAll('.card')) card.hidden = show !== 'all' && card.dataset.level !== show;
});
</script>
</body></html>`;
  const path = join(out, 'index.html');
  writeFileSync(path, html);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
  return { path, pages: results.length, withProblems, diagrams };
}
