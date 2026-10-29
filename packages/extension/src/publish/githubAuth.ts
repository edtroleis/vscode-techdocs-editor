import * as vscode from 'vscode';
import { apiBaseUrlFor, GitHubClient, GitHubError, GitHubTransport, TokenSource, userTransport } from '@edtroleis/techdocs-editor-core';

/** Provedor de login do VS Code: `github` no github.com, `github-enterprise` num GitHub Enterprise Server (A-2). */
export const authProviderFor = (host: string) => (host === 'github.com' ? 'github' : 'github-enterprise');

/** Escopos pedidos ao login (A-3): `techdocsEditor.github.scopes`, `repo` por padrão. */
export function configuredScopes(): string[] {
  const scopes = vscode.workspace.getConfiguration('techdocsEditor').get<string[]>('github.scopes');
  return scopes?.length ? scopes : ['repo'];
}

/**
 * Token do GitHub da sessão do VS Code, lido a cada chamada (A-4, A-6: nunca guardado pela extensão).
 * Num 401, o cliente pede `renew`: sessão nova e uma nova tentativa.
 */
export function sessionTokenSource(host: string, scopes = configuredScopes()): TokenSource {
  const provider = authProviderFor(host);
  return async ({ renew }) => {
    const session = renew
      ? await vscode.authentication.getSession(provider, scopes, {
          forceNewSession: { detail: vscode.l10n.t('GitHub did not accept the saved sign-in. Sign in again to continue.') },
        })
      : await vscode.authentication.getSession(provider, scopes, { createIfNone: true });
    return session?.accessToken;
  };
}

/** Já há login no GitHub, sem pedir nada (A-1: o login só é pedido quando a pessoa age). */
export async function hasSession(host: string, scopes = configuredScopes()): Promise<boolean> {
  return Boolean(await vscode.authentication.getSession(authProviderFor(host), scopes, { silent: true }));
}

/** Transporte para os testes de integração: o GitHub simulado no lugar da API de verdade. */
let testTransport: ((host: string) => GitHubTransport) | undefined;
export function useTestTransport(factory: ((host: string) => GitHubTransport) | undefined) {
  testTransport = factory;
}

/** Os testes estão usando o GitHub simulado (com login: não há sessão do VS Code para conferir). */
export const usingTestTransport = () => Boolean(testTransport);

export function clientFor(host: string, slug: string, extraScopes: string[] = []): GitHubClient {
  const transport =
    testTransport?.(host) ?? userTransport(sessionTokenSource(host, [...configuredScopes(), ...extraScopes]), apiBaseUrlFor(host));
  return new GitHubClient(transport, slug);
}

/** Cliente sem login, para ler um repositório público (templates centrais, TA3): nada é pedido à pessoa. */
export function anonymousClientFor(host: string, slug: string): GitHubClient {
  const transport = testTransport?.(host);
  return new GitHubClient(
    transport ? { ...transport, headers: {} } : { baseUrl: apiBaseUrlFor(host), fetch: (input, init) => fetch(input, init), headers: {} },
    slug,
  );
}

/** O que a pessoa lê quando uma chamada ao GitHub falha (A-5): o que fazer, não o código HTTP. */
export function gitHubErrorText(error: unknown, l10n: { t: typeof vscode.l10n.t }): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GitHubError) {
    if (/SAML|single sign-on/i.test(message)) {
      return l10n.t('The organization requires single sign-on (SAML). Authorize your GitHub sign-in for the organization on github.com and try again.');
    }
    if (/OAuth App access restrictions/i.test(message)) {
      return l10n.t('The organization restricts OAuth apps. Ask an organization owner to approve "Visual Studio Code" in the organization settings.');
    }
    if (error.status === 401) return l10n.t('GitHub did not accept the sign-in. Sign in again and try once more.');
    if (error.status === 403 || error.status === 404) {
      return l10n.t('GitHub refused the request ({0}). Check that you have write access to the repository.', message);
    }
  }
  return message;
}
