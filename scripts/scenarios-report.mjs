// Junta os relatórios dos cenários (node_modules/.cache/scenarios/<cenário>/report.json + prints) numa página só,
// com os prints dentro: node_modules/.cache/scenarios/report.html.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'node_modules/.cache/scenarios');
if (!existsSync(DIR)) {
  console.log('Nenhum cenário rodou ainda.');
  process.exit(0);
}
const reports = readdirSync(DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(DIR, d.name, 'report.json')))
  .map(d => ({ dir: join(DIR, d.name), ...JSON.parse(readFileSync(join(DIR, d.name, 'report.json'), 'utf8')) }))
  .sort((a, b) => a.id.localeCompare(b.id));

const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LABEL = { bug: 'bug', suggestion: 'sugestão', outside: 'fora da extensão', ok: 'funcionou' };
const all = reports.flatMap(r => [...r.steps.flatMap(s => s.findings.map(f => ({ ...f, scenario: r, step: s.title }))), ...r.findings.map(f => ({ ...f, scenario: r, step: '' }))]);
const count = kind => all.filter(f => f.kind === kind).length;
const failed = r => r.steps.some(s => s.status === 'failed') || [...r.findings, ...r.steps.flatMap(s => s.findings)].some(f => f.kind === 'bug');
const image = (dir, name) => (name && existsSync(join(dir, name)) ? `data:image/jpeg;base64,${readFileSync(join(dir, name)).toString('base64')}` : '');

const findingList = (findings, withScenario) =>
  findings.length
    ? `<ul class="findings">${findings
        .map(f => `<li class="f ${f.kind}"><span class="chip ${f.kind}">${LABEL[f.kind]}</span><span>${esc(f.text)}${withScenario ? `<small>${esc(f.scenario.title)}${f.step ? ` · ${esc(f.step)}` : ''}</small>` : ''}</span></li>`)
        .join('')}</ul>`
    : '';

const scenarioHtml = r => `
  <section class="scenario" id="${esc(r.id)}">
    <header><span class="eyebrow">${esc(r.id)}</span><h2>${esc(r.title)}</h2><span class="chip ${failed(r) ? 'bug' : 'ok'}">${failed(r) ? 'com problemas' : 'passou'}</span></header>
    <p class="summary">${esc(r.summary)}</p>
    ${findingList(r.findings, false)}
    <ol class="steps">${r.steps
      .map(
        s => `<li class="${s.status}"><div class="step">
          <div class="head"><h3>${esc(s.title)}</h3><span class="time">${s.seconds}s</span>${s.status === 'failed' ? '<span class="chip bug">falhou</span>' : ''}</div>
          ${s.error ? `<pre>${esc(s.error)}</pre>` : ''}
          ${findingList(s.findings, false)}
          ${s.screenshot ? `<details><summary>Ver a tela</summary><img loading="lazy" alt="${esc(s.title)}" src="${image(r.dir, s.screenshot)}"></details>` : ''}
        </div></li>`,
      )
      .join('')}</ol>
  </section>`;

const html = `<title>Cenários do TechDocs Editor</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: uma coluna; resumo dos achados no topo, depois cada cenário com os passos e o print de cada um */
:root { --bg:#f5f6f4; --surface:#fff; --fg:#1f2421; --muted:#5f6a64; --line:#d8ddd9; --accent:#0f6b55;
  --ok:#1f7a43; --ok-bg:#e3f3e8; --bug:#a1261d; --bug-bg:#f9e1de; --sug:#8a5a00; --sug-bg:#fbefd4; --out:#3d5a9a; --out-bg:#e4eafa;
  --font-body:"IBM Plex Sans","Segoe UI",system-ui,sans-serif; --font-mono:"IBM Plex Mono",ui-monospace,monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#131816; --surface:#1b211f; --fg:#e3e8e5; --muted:#9aa6a0; --line:#2e3734;
  --accent:#4fc3a1; --ok:#6fd394; --ok-bg:#1d3326; --bug:#ff8f84; --bug-bg:#3d2220; --sug:#f0c060; --sug-bg:#3a2f17; --out:#9db7ff; --out-bg:#1f2840; color-scheme:dark; } }
:root[data-theme="dark"] { --bg:#131816; --surface:#1b211f; --fg:#e3e8e5; --muted:#9aa6a0; --line:#2e3734;
  --accent:#4fc3a1; --ok:#6fd394; --ok-bg:#1d3326; --bug:#ff8f84; --bug-bg:#3d2220; --sug:#f0c060; --sug-bg:#3a2f17; --out:#9db7ff; --out-bg:#1f2840; color-scheme:dark; }
* { box-sizing:border-box; }
body { background:var(--bg); color:var(--fg); font-family:var(--font-body); font-size:16px; line-height:1.55;
  padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px)); padding-block:40px 80px; }
.wrap { max-width:980px; margin:0 auto; display:flex; flex-direction:column; gap:48px; }
h1,h2,h3 { margin:0; line-height:1.25; text-wrap:balance; }
h1 { font-size:2rem; } h2 { font-size:1.4rem; } h3 { font-size:1rem; font-weight:600; }
p { margin:0; max-width:70ch; }
.eyebrow { font-size:.76rem; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600; }
.top { display:flex; flex-direction:column; gap:12px; }
.counts { display:flex; flex-wrap:wrap; gap:8px 20px; color:var(--muted); font-size:.95rem; }
.counts b { color:var(--fg); font-variant-numeric:tabular-nums; }
.toc { display:flex; flex-wrap:wrap; gap:8px; } .toc a { color:var(--accent); }
.chip { display:inline-flex; align-items:center; font-size:.72rem; font-weight:600; letter-spacing:.04em; text-transform:uppercase; padding:2px 8px; border-radius:999px; white-space:nowrap; }
.chip.ok { color:var(--ok); background:var(--ok-bg); } .chip.bug { color:var(--bug); background:var(--bug-bg); }
.chip.suggestion { color:var(--sug); background:var(--sug-bg); } .chip.outside { color:var(--out); background:var(--out-bg); }
.findings { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.f { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; align-items:baseline; }
.f small { display:block; color:var(--muted); font-size:.82rem; }
.panel { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:18px; display:flex; flex-direction:column; gap:14px; }
.scenario { display:flex; flex-direction:column; gap:16px; }
.scenario > header { display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; }
.scenario > header .eyebrow { width:100%; }
.steps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; counter-reset:s; }
.steps > li { counter-increment:s; display:grid; grid-template-columns:36px minmax(0,1fr); gap:12px; }
.steps > li::before { content:counter(s); font-family:var(--font-mono); color:var(--accent); border:1.5px solid var(--accent); border-radius:50%; width:28px; height:28px; display:grid; place-items:center; font-size:.85rem; }
.steps > li.failed::before { color:var(--bug); border-color:var(--bug); }
.step { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.head { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:baseline; }
.time { color:var(--muted); font-size:.82rem; font-family:var(--font-mono); }
details summary { cursor:pointer; color:var(--accent); font-size:.9rem; }
details img { margin-top:8px; width:100%; border:1px solid var(--line); border-radius:6px; }
pre { margin:0; background:var(--bug-bg); color:var(--fg); border-radius:6px; padding:10px; overflow-x:auto; font-family:var(--font-mono); font-size:.8rem; white-space:pre-wrap; }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
</style>
<div class="wrap">
  <header class="top">
    <span class="eyebrow">Cenários de usuário · ${esc(new Date().toLocaleString('pt-BR'))}</span>
    <h1>Cenários do TechDocs Editor</h1>
    <p>O VS Code de verdade, com a extensão em desenvolvimento, dirigido como uma pessoa que não conhece Markdown nem Backstage. Os cenários ficam em <code>packages/extension/e2e/scenarios</code> e rodam com <code>npm run test:scenarios</code>.</p>
    <div class="counts"><span>Cenários <b>${reports.length}</b></span><span>Bugs <b>${count('bug')}</b></span><span>Sugestões <b>${count('suggestion')}</b></span><span>Passos fora da extensão <b>${count('outside')}</b></span></div>
    <nav class="toc">${reports.map(r => `<a href="#${esc(r.id)}">${esc(r.title)}</a>`).join(' · ')}</nav>
  </header>
  ${count('bug') + count('suggestion') + count('outside') ? `<section class="panel"><h2>O que achamos</h2>${findingList(all.filter(f => f.kind !== 'ok').sort((a, b) => ['bug', 'suggestion', 'outside'].indexOf(a.kind) - ['bug', 'suggestion', 'outside'].indexOf(b.kind)), true)}</section>` : ''}
  ${reports.map(scenarioHtml).join('')}
</div>`;
writeFileSync(join(DIR, 'report.html'), html);
console.log(`Relatório: ${join(DIR, 'report.html')} (${reports.length} cenários, ${count('bug')} bugs, ${count('suggestion')} sugestões)`);
