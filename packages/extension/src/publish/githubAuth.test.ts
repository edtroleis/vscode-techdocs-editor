import { GitHubError } from '@edtroleis/techdocs-editor-core';

vi.mock('vscode', () => ({}));
const { authProviderFor, gitHubErrorText } = await import('./githubAuth');

const l10n = { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) };

describe('autenticação no GitHub', () => {
  it('provedor do VS Code pelo host (A-2)', () => {
    expect(authProviderFor('github.com')).toBe('github');
    expect(authProviderFor('ghe.empresa.com')).toBe('github-enterprise');
  });

  it('SSO e restrição de OAuth Apps dizem o que pedir (A-5)', () => {
    expect(gitHubErrorText(new GitHubError('Resource protected by organization SAML enforcement.', 403), l10n as never)).toContain(
      'single sign-on',
    );
    expect(
      gitHubErrorText(new GitHubError('Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions', 403), l10n as never),
    ).toContain('organization owner');
  });

  it('sem permissão de escrita', () => {
    expect(gitHubErrorText(new GitHubError('Resource not accessible by integration', 403), l10n as never)).toContain('write access');
  });

  it('erro que não é do GitHub passa como veio', () => {
    expect(gitHubErrorText(new Error('rede caiu'), l10n as never)).toBe('rede caiu');
  });
});
