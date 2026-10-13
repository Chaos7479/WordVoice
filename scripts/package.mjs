import { mkdir, cp, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const name = `WordVoice-${version}`;
const root = path.resolve('dist', name);
await mkdir('dist', { recursive: true });
await rm(root, { recursive: true, force: true });
await mkdir(root);
for (const entry of [
  'manifest.json',
  'README.md',
  'LICENSE',
  'assets',
  'background',
  'content',
  'lib',
  'offscreen',
  'options',
  'popup',
  'sidepanel',
  'docs',
])
  await cp(entry, path.join(root, entry), { recursive: true });
await rm(`dist/${name}.zip`, { force: true });
const result = spawnSync('zip', ['-qr', `${name}.zip`, name], { cwd: 'dist', stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Created dist/${name}.zip (load the extracted ${name} folder in Chrome).`);
