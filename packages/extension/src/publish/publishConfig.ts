import { DEFAULT_BRANCH_PATTERN, RepoConfig, VerificationMode } from '@edtroleis/techdocs-editor-core';
import type { PublishConfig } from './localPublisher';

type Settings = { get<T>(key: string, fallback: T): T };

const MODES: VerificationMode[] = ['auto', 'pipeline', 'editor'];

/**
 * Configuração do painel: as settings `techdocsEditor.*`, com `verification.*` do `.techdocs-editor.yaml`
 * do repositório vencendo (o `checkHelp` dos dois soma, o do repositório vence para o mesmo check).
 * Valor inválido nas settings volta ao padrão: um erro de digitação não trava o painel.
 */
export function publishConfig(settings: Settings, repo: RepoConfig | undefined, language: string): PublishConfig {
  const seconds = (key: string, fallback: number, min: number) => {
    const value = settings.get<unknown>(key, fallback);
    return (typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : fallback) * 1000;
  };
  const mode = settings.get<unknown>('verification.mode', 'auto');
  const branchPattern = settings.get<unknown>('branchPattern', DEFAULT_BRANCH_PATTERN);
  const help = settings.get<unknown>('verification.checkHelp', {});
  const settingsHelp = typeof help === 'object' && help !== null && !Array.isArray(help) ? (help as Record<string, string>) : {};
  return {
    branchPattern: typeof branchPattern === 'string' && branchPattern.includes('{path}') ? branchPattern : DEFAULT_BRANCH_PATTERN,
    skipCi: settings.get<unknown>('drafts.skipCi', true) !== false,
    verificationMode: repo?.verification.mode ?? (MODES.includes(mode as VerificationMode) ? (mode as VerificationMode) : 'auto'),
    startTimeoutMs:
      repo?.verification.startTimeoutSeconds !== undefined
        ? repo.verification.startTimeoutSeconds * 1000
        : seconds('verification.startTimeoutSeconds', 120, 10),
    pollMs: seconds('polling.intervalSeconds', 8, 2),
    idlePollMs: seconds('polling.idleIntervalSeconds', 60, 10),
    checkHelp: { ...settingsHelp, ...repo?.verification.checkHelp },
    language,
  };
}
