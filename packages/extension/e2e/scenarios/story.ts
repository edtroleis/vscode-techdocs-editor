/**
 * Cenários de usuário: uma pessoa que não conhece Markdown nem Backstage cria e ajusta documentação no VS Code de
 * verdade, com a extensão em desenvolvimento. Cada passo põe uma legenda na tela, tira um print e anota o que foi
 * achado: bug (o teste continua, mas a rodada fica vermelha no relatório), sugestão, passo feito fora da extensão.
 * O relatório (report.json + prints) vai para node_modules/.cache/scenarios/<cenário>; scripts/scenarios-report.mjs
 * junta tudo numa página.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { caption, clickLike, overlay } from '../human';
import { expect, ROOT, test as vscodeTest } from '../vscode';

export const REPORT_DIR = join(ROOT, 'node_modules/.cache/scenarios');
/** FAST=1: sem as pausas de pessoa (para rodar depressa, sem assistir). */
export const FAST = Boolean(process.env.FAST);

export type FindingKind = 'bug' | 'suggestion' | 'outside' | 'ok';
type Finding = { kind: FindingKind; text: string };
type StepRecord = { title: string; status: 'passed' | 'failed'; screenshot?: string; findings: Finding[]; seconds: number; error?: string };

export class Story {
  private readonly steps: StepRecord[] = [];
  private current: StepRecord | undefined;
  private readonly loose: Finding[] = [];
  private shots = 0;

  constructor(
    readonly page: Page,
    private readonly dir: string,
    private readonly meta: { id: string; title: string; summary: string },
  ) {}

  /** Um passo da pessoa: legenda na tela, o que ela faz, e o print do resultado. */
  async step(title: string, body: () => Promise<void>) {
    const record: StepRecord = { title, status: 'passed', findings: [], seconds: 0 };
    this.current = record;
    this.steps.push(record);
    const started = Date.now();
    await caption(this.page, title).catch(() => undefined);
    try {
      await vscodeTest.step(title, body);
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message.split('\n').slice(0, 6).join('\n') : String(error);
      throw error;
    } finally {
      record.seconds = Math.round((Date.now() - started) / 100) / 10;
      record.screenshot = await this.shot();
      this.current = undefined;
      this.write();
    }
  }

  /** Algo errado que a pessoa encontraria: anotado no relatório; o cenário continua. */
  bug(text: string) {
    this.note('bug', text);
  }

  /** O que faltou ou atrapalhou, sem ser erro. */
  suggest(text: string) {
    this.note('suggestion', text);
  }

  /** Um passo que a pessoa teve de fazer fora da extensão (terminal, site do GitHub). */
  outside(text: string) {
    this.note('outside', text);
  }

  /** O que funcionou bem e vale guardar como garantia. */
  ok(text: string) {
    this.note('ok', text);
  }

  /** Confere sem parar o cenário: se não bate, vira bug no relatório (e a rodada falha no fim). */
  async check(description: string, assertion: () => Promise<unknown>) {
    try {
      await assertion();
    } catch (error) {
      this.bug(`${description}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      vscodeTest.info().annotations.push({ type: 'bug', description });
    }
  }

  /** Bugs anotados até agora (o teste falha no fim se houver). */
  bugs() {
    return [...this.loose, ...this.steps.flatMap(s => s.findings)].filter(f => f.kind === 'bug');
  }

  private note(kind: FindingKind, text: string) {
    (this.current?.findings ?? this.loose).push({ kind, text });
    this.write();
  }

  private async shot() {
    const name = `${String(++this.shots).padStart(2, '0')}.jpg`;
    try {
      // JPEG: o relatório leva todos os prints dentro da página
      await this.page.screenshot({ path: join(this.dir, name), type: 'jpeg', quality: 70 });
      return name;
    } catch {
      return undefined;
    }
  }

  write() {
    writeFileSync(
      join(this.dir, 'report.json'),
      JSON.stringify({ ...this.meta, finishedAt: new Date().toISOString(), steps: this.steps, findings: this.loose }, null, 2),
    );
  }
}

/** Copia uma fixture para uma pasta nova (fora do repositório), como a pasta da pessoa. */
export function folderFrom(fixture: string | undefined, name: string): string {
  const folder = join(mkdtempSync(join(tmpdir(), 'cenario-')), name);
  mkdirSync(folder, { recursive: true });
  if (fixture) cpSync(join(__dirname, 'fixtures', fixture), folder, { recursive: true });
  return folder;
}

type Fixtures = { story: Story; scenario: { id: string; title: string; summary: string } };

export const test = vscodeTest.extend<Fixtures>({
  scenario: [{ id: 'cenario', title: 'Cenário', summary: '' }, { option: true }],
  story: async ({ vscode: { page }, scenario }, use) => {
    const dir = join(REPORT_DIR, scenario.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await overlay(page);
    const story = new Story(page, dir, scenario);
    story.write();
    await use(story);
    story.write();
    expect(story.bugs().map(b => b.text), 'bugs anotados no cenário').toEqual([]);
  },
});

export { expect };

/**
 * Clique de pessoa (o cursor desenhado vai até o alvo); FAST=1 clica direto, mas espera um instante depois, como
 * a mão indo do mouse para o teclado (a tecla no mesmo instante do clique num webview pode se perder).
 */
export const click = async (page: Page, target: Locator) => {
  if (!FAST) return clickLike(page, target);
  await target.click();
  await page.waitForTimeout(150);
};

/** Digitação de pessoa: ~15 letras por segundo; FAST=1, quase instantânea. */
export const type = (page: Page, text: string) => page.keyboard.type(text, { delay: FAST ? 5 : 45 });

/** Pausa para quem assiste ler a tela. */
export const pause = (page: Page, ms = 1_200) => (FAST ? Promise.resolve() : page.waitForTimeout(ms));
