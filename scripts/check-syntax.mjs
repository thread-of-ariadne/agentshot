// `node --check` on every .mjs in bin/, lib/ and scripts/ (the Node side has no build step).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.mjs')) files.push(p);
  }
};
for (const d of ['bin', 'lib', 'scripts']) walk(path.join(root, d));

const failed = files.filter((f) => {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) process.stderr.write(r.stderr);
  return r.status !== 0;
});
console.log(JSON.stringify({ ok: !failed.length, checked: files.length, failed: failed.map((f) => path.relative(root, f)) }));
process.exit(failed.length ? 1 : 0);
