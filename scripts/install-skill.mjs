// Copies skill/agentshot into ~/.claude/skills/agentshot so Claude Code can use agentshot from any project.
// The skill names the tool's location as /path/to/agentshot; it is rewritten to where this checkout lives.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'skill', 'agentshot');
const dest = path.join(os.homedir(), '.claude', 'skills', 'agentshot');
const here = root.split(path.sep).join('/');
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) {
  const text = fs.readFileSync(path.join(src, f), 'utf8');
  fs.writeFileSync(path.join(dest, f), text.replaceAll('/path/to/agentshot', here));
}
console.log(JSON.stringify({ ok: true, installed: dest, tool: here }));
