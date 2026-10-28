import { parseRepoConfig } from '@edtroleis/techdocs-editor-core';
import { publishConfig } from './publishConfig';

const settings = (values: Record<string, unknown>) => ({
  get: <T>(key: string, fallback: T) => (key in values ? (values[key] as T) : fallback),
});

describe('configuração do painel', () => {
  it('padrões da spec 02', () => {
    expect(publishConfig(settings({}), undefined, 'en')).toEqual({
      branchPattern: 'docs/{login}/{path}',
      skipCi: true,
      verificationMode: 'auto',
      startTimeoutMs: 120_000,
      pollMs: 8000,
      idlePollMs: 60_000,
      checkHelp: {},
      language: 'en',
    });
  });

  it('o .techdocs-editor.yaml do repositório vence as settings; checkHelp soma', () => {
    const repo = parseRepoConfig(
      'verification:\n  mode: editor\n  startTimeoutSeconds: 30\n  checkHelp:\n    Links: "Do repositório"\n',
    );
    const config = publishConfig(
      settings({ 'verification.mode': 'pipeline', 'verification.startTimeoutSeconds': 300, 'verification.checkHelp': { Links: 'Das settings', Build: 'Montagem' } }),
      repo,
      'en',
    );
    expect(config.verificationMode).toBe('editor');
    expect(config.startTimeoutMs).toBe(30_000);
    expect(config.checkHelp).toEqual({ Links: 'Do repositório', Build: 'Montagem' });
  });

  it('valor inválido nas settings volta ao padrão', () => {
    const config = publishConfig(
      settings({ 'verification.mode': 'sempre', 'polling.intervalSeconds': 'rápido', 'polling.idleIntervalSeconds': 1, branchPattern: 'docs/{login}', 'verification.checkHelp': ['x'] }),
      undefined,
      'en',
    );
    expect(config).toMatchObject({ verificationMode: 'auto', pollMs: 8000, idlePollMs: 10_000, branchPattern: 'docs/{login}/{path}', checkHelp: {} });
  });
});
