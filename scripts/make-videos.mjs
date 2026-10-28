#!/usr/bin/env node
// Grava os vídeos curtos do README no VS Code de verdade e converte em GIF (docs/media/*.gif), que o
// GitHub e o Marketplace mostram direto no README. Precisa do ffmpeg. Como o make-videos do plugin.
//
// Uso: npm run record:videos
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const raw = join(root, 'node_modules/.cache/editor-videos');
const out = join(root, 'docs/media');

rmSync(raw, { recursive: true, force: true });
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
execFileSync('npx', ['playwright', 'test', '-c', 'packages/extension/e2e/videos/playwright.config.ts'], {
  cwd: root,
  stdio: 'inherit',
});

const starts = JSON.parse(readFileSync(join(raw, 'starts.json'), 'utf8'));
mkdirSync(out, { recursive: true });
for (const name of readdirSync(raw).filter(entry => statSync(join(raw, entry)).isDirectory())) {
  const [video] = readdirSync(join(raw, name)).filter(file => file.endsWith('.webm'));
  if (!video) continue;
  const gif = join(out, `${name}.gif`);
  // 960 px de largura e 10 quadros por segundo, com paleta própria: legível e com poucos MB
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', String(Math.max(0, (starts[name] ?? 0) - 0.3)),
    '-i', join(raw, name, video),
    '-vf', 'fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0',
    gif,
  ]);
  console.log(`docs/media/${name}.gif (${(statSync(gif).size / 1024 / 1024).toFixed(1)} MB)`);
}
