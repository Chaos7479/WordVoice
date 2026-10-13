import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.side_panel.default_path,
  manifest.options_ui.page,
  ...manifest.content_scripts.flatMap((s) => [...s.js, ...(s.css || [])]),
  ...Object.values(manifest.icons),
])
  await access(file);
for (const dir of ['background', 'content', 'lib', 'offscreen', 'options', 'popup', 'sidepanel']) {
  for (const file of await readdir(dir))
    if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
  for (const file of await readdir(dir))
    if (file.endsWith('.html')) {
      const html = await readFile(`${dir}/${file}`, 'utf8');
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(ids.length, new Set(ids).size, `${file}: duplicate IDs`);
      assert(!/\son\w+=/.test(html), `${file}: inline event handler violates extension CSP`);
    }
}
assert(manifest.permissions.includes('offscreen'));
console.log('Manifest references, JavaScript syntax, HTML IDs and CSP checks passed.');
