#!/usr/bin/env node
// Grava os vídeos curtos do README no VS Code de verdade e converte em GIF (docs/media/*.gif), que o
// GitHub e o Marketplace mostram direto no README, e junta as cenas do passo a passo, da instalação ao uso, no
// vídeo completo (docs/media/walkthrough.mp4). Precisa do ffmpeg. Como o make-videos do plugin.
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

// O vídeo completo: as cenas do passo a passo (e2e/videos/walkthrough.spec.ts), na ordem, sem a abertura do VS Code
const WALKTHROUGH = ['install', 'sidebar', 'blank-page', 'new-page', 'visual-editor', 'mermaid', 'lint-and-fix'];
const scenes = WALKTHROUGH.map(name => {
  const [video] = readdirSync(join(raw, name)).filter(file => file.endsWith('.webm'));
  if (!video) throw new Error(`sem o vídeo da cena ${name}`);
  return { file: join(raw, name, video), start: Math.max(0, (starts[name] ?? 0) - 0.3) };
});
const mp4 = join(out, 'walkthrough.mp4');
// H.264 (toca no GitHub e em qualquer navegador): o libx264 quando o ffmpeg tem; senão o libopenh264 (o ffmpeg do
// Fedora vem só com ele), por taxa de bits
const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString();
const h264 = /\blibx264\b/.test(encoders)
  ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', '28']
  : ['-c:v', 'libopenh264', '-b:v', '900k', '-maxrate', '1500k'];
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  ...scenes.flatMap(scene => ['-ss', String(scene.start), '-i', scene.file]),
  '-filter_complex',
  scenes.map((_, i) => `[${i}:v]fps=25,scale=1280:800:flags=lanczos,setsar=1[v${i}]`).join(';') +
    ';' + scenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${scenes.length}:v=1:a=0[out]`,
  '-map', '[out]',
  ...h264, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  mp4,
]);
const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString());
console.log(`docs/media/walkthrough.mp4 (${(statSync(mp4).size / 1024 / 1024).toFixed(1)} MB, ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')})`);
if (seconds > 240) throw new Error('o vídeo completo passou de 4 minutos');

// A capa do vídeo no README (o Marketplace não toca vídeo): o editor visual com o texto ao lado, com a legenda
const poster = join(out, 'walkthrough.jpg');
const editor = scenes[WALKTHROUGH.indexOf('visual-editor')];
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(editor.start + 16.3), '-i', editor.file, '-frames:v', '1', '-q:v', '3', poster]);
console.log(`docs/media/walkthrough.jpg (${(statSync(poster).size / 1024).toFixed(0)} KB)`);
