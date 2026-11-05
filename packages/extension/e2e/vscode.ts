/**
 * VS Code de verdade controlado pelo Playwright (Electron): abre o workspace de teste com a extensão
 * em desenvolvimento, e os testes clicam e digitam dentro do webview como uma pessoa.
 */
import { _electron, expect, FrameLocator, Page, test as base } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { cursorToEnd } from '../test/webview/editing';
import { dirname, join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWorkspace, extensionRoot } = require('../test/vscode/workspace.cjs');

export const ROOT = join(__dirname, '..', '..', '..');

type VsCode = {
  page: Page;
  /** Pasta do workspace (cópia de test/fixtures). */
  workspace: string;
  /** Conteúdo do arquivo no disco. */
  file: (path: string) => string;
  /** Quando o VS Code foi aberto (o vídeo começa aí). */
  startedAt: number;
};

type Options = {
  theme: string;
  /** Configurações a mais do usuário (os vídeos do README ligam `openVisualByDefault`). */
  settings: Record<string, unknown>;
  /** Pasta onde gravar o vídeo da janela (e2e/videos); sem ela, não grava. */
  recordDir: string | undefined;
  windowSize: { width: number; height: number };
  /** Pasta a abrir no lugar do workspace de teste (os cenários de usuário montam a sua). */
  folder: string | undefined;
  /** Língua do VS Code (`--locale`); a extensão segue ela nos textos. */
  locale: string | undefined;
};

export const test = base.extend<Options & { vscode: VsCode }>({
  theme: ['Default Dark Modern', { option: true }],
  settings: [{}, { option: true }],
  recordDir: [undefined, { option: true }],
  windowSize: [{ width: 1600, height: 1000 }, { option: true }],
  folder: [undefined, { option: true }],
  locale: [undefined, { option: true }],
  vscode: async ({ theme, settings, recordDir, windowSize, folder, locale }, use, testInfo) => {
    const executablePath = await downloadAndUnzipVSCode({ cachePath: join(ROOT, '.vscode-test') });
    const workspace: string = folder ?? createWorkspace();
    const userData = mkdtempSync(join(tmpdir(), 'techdocs-editor-user-'));
    mkdirSync(join(userData, 'User'), { recursive: true });
    writeFileSync(
      join(userData, 'User', 'settings.json'),
      JSON.stringify({
        'workbench.colorTheme': theme,
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        'security.workspace.trust.enabled': false,
        'update.mode': 'none',
        'extensions.autoCheckUpdates': false,
        'telemetry.telemetryLevel': 'off',
        'chat.disableAIFeatures': true,
        'window.restoreWindows': 'none',
        'files.autoSave': 'off',
        // Sem lixeira no /tmp do teste: excluir apaga de vez (senão vem a caixa "Failed to delete using the Trash")
        'files.enableTrash': false,
        // O menu do botão direito desenhado pelo VS Code (o nativo o teste não alcança)
        'window.menuStyle': 'custom',
        ...settings,
      }),
    );
    // Outra língua: o VS Code só segue o --locale com o pacote de idioma instalado (baixado uma vez, em cache)
    if (locale && !locale.startsWith('en')) {
      const packs = join(ROOT, '.vscode-test', 'language-packs');
      const id = `MS-CEINTL.vscode-language-pack-${locale.replace(/-(\w+)$/, (_, r: string) => `-${r.toUpperCase()}`)}`;
      if (!existsSync(packs) || !readdirSync(packs).some(d => d.toLowerCase().startsWith(id.toLowerCase()))) {
        // O cli.js pelo Electron do VS Code de teste (o bin/code, no WSL, instalaria no VS Code do Windows)
        const cli = join(dirname(executablePath), 'resources', 'app', 'out', 'cli.js');
        spawnSync(executablePath, [cli, `--extensions-dir=${packs}`, `--user-data-dir=${join(packs, '.user-data')}`, '--install-extension', id], {
          stdio: 'inherit',
          timeout: 120_000,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
      }
      cpSync(packs, join(userData, 'extensions'), { recursive: true, filter: source => !source.includes('.user-data') });
      // O VS Code só lê o pacote no 2º início (monta o languagepacks.json no 1º): o arquivo já vai pronto
      const pack = readdirSync(packs).find(d => d.toLowerCase().startsWith(id.toLowerCase()));
      if (pack) {
        const manifest = JSON.parse(readFileSync(join(packs, pack, 'package.json'), 'utf8'));
        const language = manifest.contributes.localizations[0];
        const translations = Object.fromEntries(
          language.translations.map((t: { id: string; path: string }) => [t.id, join(userData, 'extensions', pack, t.path)]),
        );
        writeFileSync(
          join(userData, 'languagepacks.json'),
          JSON.stringify({
            [language.languageId]: {
              hash: `${manifest.version}-test`,
              extensions: [{ extensionIdentifier: { id: `${manifest.publisher}.${manifest.name}`.toLowerCase() }, version: manifest.version }],
              translations,
              label: language.localizedLanguageName ?? language.languageName,
            },
          }),
        );
      }
    }
    const startedAt = Date.now();
    const app = await _electron.launch({
      executablePath,
      args: [
        workspace,
        `--extensionDevelopmentPath=${extensionRoot}`,
        `--user-data-dir=${userData}`,
        `--extensions-dir=${join(userData, 'extensions')}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-gpu',
        ...(locale ? [`--locale=${locale}`] : []),
        // Sem janela na tela: renderiza fora dela (Chromium ozone headless)
        ...(process.env.HEADED ? [] : ['--ozone-platform=headless']),
      ],
      ...(recordDir ? { recordVideo: { dir: recordDir, size: windowSize } } : {}),
    });
    const page = await app.firstWindow();
    // E2E_LOG=1: mostra as mensagens da extensão (host e webview) na saída do teste
    if (process.env.E2E_LOG) {
      page.on('console', message => {
        const text = message.text();
        if (text.includes('techdocs-editor') || text.includes('TDE')) {
          console.log(text.replace(/%c|color: \w+;?|\(at .*\)|\[Extension Host\]/g, '').trim());
        }
      });
    }
    // A janela sem tela (headless) nasce pequena demais para o editor
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0]?.setSize(width, height),
      windowSize,
    );
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    await use({ page, workspace, startedAt, file: path => readFileSync(join(workspace, path), 'utf8') });
    if (testInfo.status !== testInfo.expectedStatus) {
      await page.screenshot({ path: testInfo.outputPath('vscode.png') }).catch(() => {});
    }
    await app.close();
  },
});

export { expect };

/** Roda um comando pela paleta (F1), pelo título em inglês. */
export async function runCommand(page: Page, title: string) {
  await page.keyboard.press('F1');
  const input = page.locator('.quick-input-widget input');
  await input.waitFor();
  await input.fill(`>${title}`);
  await page.locator('.quick-input-list .monaco-list-row', { hasText: title }).first().waitFor();
  await page.keyboard.press('Enter');
}

/** Abre o arquivo pelo Quick Open (Ctrl+P). */
export async function openFile(page: Page, path: string) {
  await page.keyboard.press('Control+P');
  const input = page.locator('.quick-input-widget input');
  await input.waitFor();
  await input.fill(path);
  await page.locator('.quick-input-list .monaco-list-row', { hasText: path.split('/').pop()! }).first().waitFor();
  await page.keyboard.press('Enter');
  await page.locator('.tab.active', { hasText: path.split('/').pop()! }).waitFor();
}

/** Conteúdo do webview do editor visual (iframe do VS Code → iframe da página). */
export const visual = (page: Page): FrameLocator =>
  page.frameLocator('iframe.webview.ready').last().frameLocator('iframe#active-frame');

export const prose = (page: Page) => visual(page).locator('.milkdown .ProseMirror');

/**
 * "TechDocs: Open in visual editor" pela paleta. O comando só aparece em página das docs, e a extensão liga esse
 * contexto um instante depois de a aba abrir: espera o botão do editor, senão a paleta abre sem o comando.
 */
export async function openVisualCommand(page: Page) {
  await page.getByRole('button', { name: 'Open in visual editor' }).first().waitFor({ timeout: 30_000 });
  await runCommand(page, 'TechDocs: Open in visual editor');
}

/** Abre o arquivo e muda para o editor visual pelo comando da extensão. */
export async function openVisual(page: Page, path: string) {
  await openFile(page, path);
  await openVisualCommand(page);
  await prose(page).waitFor({ timeout: 30_000 });
  await expect(visual(page).locator('.top-bar-item').first()).toBeVisible();
}

/** A aba ativa tem alteração não salva. */
export const activeTabDirty = (page: Page) => page.locator('.tab.active.dirty');

/** Clica no fim do primeiro parágrafo do editor visual. */
export async function cursorAtEndOfFirstParagraph(page: Page) {
  await cursorToEnd(page, prose(page).locator('> p').first());
}

/** Salva (Ctrl+S, com o foco onde estiver) e espera a aba ficar sem alteração. */
export async function save(page: Page) {
  await page.keyboard.press('Control+S');
  await expect(activeTabDirty(page)).toHaveCount(0);
}
