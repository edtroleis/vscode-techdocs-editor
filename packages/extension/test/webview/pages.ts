import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return path.endsWith('.md') ? [path] : [];
  });
}

export const FIXTURES = join(__dirname, '..', 'fixtures');

/** Páginas das wikis de teste: a ida e volta tem de ser byte a byte igual. */
export const wikiPages = () =>
  markdownFiles(FIXTURES).map(path => ({ name: relative(FIXTURES, path), text: readFileSync(path, 'utf8') }));
