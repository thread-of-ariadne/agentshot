// Pieces both platform helpers share.
import { spawn } from 'node:child_process';

// A long-running helper that takes one JSON command per stdin line and answers with one JSON
// line when the command is done. The first line it prints is {"ready":true}.
export function lineDriver(cmd, args) {
  const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let stderr = '';
  const waiting = [];
  p.stderr.on('data', (d) => (stderr += d));
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) waiting.shift()?.resolve(JSON.parse(line));
    }
  });
  const gone = (e) => {
    for (const w of waiting.splice(0)) w.reject(new Error(`driver exited: ${e?.message ?? stderr.slice(-500)}`));
  };
  p.on('exit', () => gone());
  p.on('error', gone);
  const next = () => new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  const ready = next();
  return {
    ready,
    async send(command) {
      const reply = next();
      p.stdin.write(JSON.stringify(command) + '\n');
      const r = await reply;
      if (!r.ok) throw new Error(`${command.op}: ${r.error}`);
      return r;
    },
    close() {
      p.stdin.end();
    },
  };
}

// Even pixel sizes for yuv420p.
export const even = (n) => n - (n % 2);
