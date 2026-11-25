import { parseGitHubRemote } from '@edtroleis/techdocs-editor-core';

/**
 * Os clones que a extensão fez (spec 09, tela A): `dono/repo` → diretório no disco. O link do Backstage abre a
 * cópia em vez de clonar de novo. Sem `vscode` aqui: o `Memento` e a leitura do `origin` chegam de fora.
 */

const KEY = 'techdocsEditor.clones';

type Memento = { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> | Promise<void> };
/** O `origin` do repositório no diretório; undefined se o diretório (ou o Git dele) não existe mais. */
type OriginOf = (path: string) => Promise<string | undefined>;

const keyOf = (host: string, slug: string) => `${host.toLowerCase()}/${slug.toLowerCase()}`;

export class KnownClones {
  constructor(
    private readonly state: Memento,
    private readonly originOf: OriginOf,
  ) {}

  private all(): Record<string, string> {
    return { ...(this.state.get<Record<string, string>>(KEY) ?? {}) };
  }

  /** O diretório do clone, conferido: existe e o `origin` ainda é o mesmo repositório. */
  async find(host: string, slug: string): Promise<string | undefined> {
    const all = this.all();
    const key = keyOf(host, slug);
    const path = all[key];
    if (!path) return undefined;
    const origin = await this.originOf(path).catch(() => undefined);
    const remote = origin ? parseGitHubRemote(origin) : undefined;
    if (remote && keyOf(remote.host, remote.slug) === key) return path;
    delete all[key];
    await this.state.update(KEY, all);
    return undefined;
  }

  async remember(host: string, slug: string, path: string): Promise<void> {
    await this.state.update(KEY, { ...this.all(), [keyOf(host, slug)]: path });
  }
}

/** Onde clonar: o diretório da configuração (`~` é o diretório pessoal) mais o nome do repositório. */
export function suggestedFolder(setting: string, repo: string, home: string): string {
  const base = (setting.trim() || '~/Documents/TechDocs').replace(/^~(?=$|[\\/])/, home).replace(/[\\/]+$/, '');
  return `${base}/${repo}`;
}
