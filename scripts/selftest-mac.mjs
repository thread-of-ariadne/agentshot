// Self-test for macOS: builds the helper, checks permissions, then exercises windows, snap,
// a desktop scenario (TextEdit: click, type non-ASCII text, waitStill, shot), manual record, frames,
// inspect and, if a simulator is booted, sim snap / a short sim scenario. Prints one JSON summary;
// look at the files it lists. Usage: node scripts/selftest-mac.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const shot = (...args) => {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'agentshot.mjs'), ...args], { encoding: 'utf8', cwd: root });
  const line = r.stdout.trim().split('\n').pop() || '{}';
  try {
    return JSON.parse(line);
  } catch {
    return { ok: false, error: r.stderr || r.stdout };
  }
};
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  process.stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${name}\n`);
  return ok;
};

if (process.platform !== 'darwin') {
  console.log(JSON.stringify({ ok: false, error: 'run this on a Mac' }));
  process.exit(1);
}

const doc = shot('doctor');
check('doctor: macOS 14+', doc.macosOk, doc.macos);
check('doctor: swiftc + helper built', doc.helper, doc.helperError);
check('doctor: Screen Recording permission', doc.screenRecording, doc.hint);
check('doctor: Accessibility permission', doc.accessibility, doc.hint);
check('doctor: ffmpeg', doc.ffmpeg);
if (!doc.helper || !doc.screenRecording || !doc.accessibility) {
  console.log(JSON.stringify({ ok: false, checks, next: 'node bin/agentshot.mjs doctor --request, grant both, restart the terminal app' }));
  process.exit(1);
}

// A TextEdit window with a known document, away from the user's own apps.
const docFile = path.join(os.tmpdir(), 'shot-selftest.txt');
fs.writeFileSync(docFile, 'shot self-test\n');
spawnSync('open', ['-a', 'TextEdit', docFile]);
spawnSync('sleep', ['2']);

const wins = shot('windows');
const te = wins.windows?.find((w) => /shot-selftest/.test(w.title) || w.process === 'TextEdit');
check('windows: TextEdit listed with title and scale', te && te.scale >= 1, te);
check('windows: titles visible (Screen Recording works)', te && /shot-selftest/.test(te.title), te?.title);

const snap = shot('snap', '--window', 'shot-selftest', '--name', 'mac-selftest-snap');
check('snap: window PNG', snap.ok && fs.existsSync(snap.file ?? ''), snap.error ?? snap.file);

const scenario = path.join(os.tmpdir(), 'shot-selftest-scenario.json');
fs.writeFileSync(
  scenario,
  JSON.stringify({
    name: 'mac-selftest-desktop',
    window: 'shot-selftest',
    track: { text: [40, 80, 300, 120] },
    steps: [
      { shot: 'before' },
      { click: 'text', duration: 0.6 },
      { press: 'mod+a' },
      { type: 'Grüße, café! Hello 123', cps: 16 },
      { press: 'enter' },
      { waitStill: 0.4, change: false },
      { wheel: 2, at: 'text' },
      { shot: 'after' },
    ],
  }),
);
const run = shot('capture', scenario);
check('desktop scenario ran', run.ok, run.error);
if (run.ok) {
  check('desktop scenario: timeline has every step', run.timeline?.length === 8, run.timeline);
  check('desktop scenario: shots before/after', run.shots?.includes('before') && run.shots?.includes('after'));
  const ins = shot('inspect', 'mac-selftest-desktop');
  check('inspect: clicks logged', ins.ok && ins.clicks?.length >= 1, ins.clicks);
  const after = ins.shots?.after?.file;
  const probe = after && spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'json', after], { encoding: 'utf8' });
  const px = probe && JSON.parse(probe.stdout).streams[0].width;
  check('stills are viewport x scale pixels', px && Math.abs(px - ins.viewport.width * ins.scale) <= 2, { px, viewport: ins.viewport, scale: ins.scale });
  const fr = shot('frames', 'mac-selftest-desktop');
  check('frames: contact sheet', fr.ok && fs.existsSync(fr.file ?? ''), fr.file ?? fr.error);
}

const rec = shot('record', '--name', 'mac-selftest-record', '--window', 'shot-selftest', '--duration', '3');
check('record --duration 3', rec.ok && Math.abs((rec.duration ?? 0) - 3) < 1, rec.error ?? rec.duration);

// iOS Simulator, if one is running
const sims = shot('sim', 'devices');
if (sims.ok && sims.devices?.length) {
  const s = shot('sim', 'snap', '--name', 'mac-selftest-sim', '--clean-status-bar');
  check('sim snap (clean status bar)', s.ok, s.error ?? s.file);
  const simScenario = path.join(os.tmpdir(), 'shot-selftest-sim.json');
  const steps = [{ shot: 'a' }, { wait: 1 }, { waitStill: 0.5, change: false }, { shot: 'b' }];
  if (doc.idb) steps.splice(1, 0, { swipe: [200, 600], to: [200, 300], duration: 0.4 });
  fs.writeFileSync(simScenario, JSON.stringify({ name: 'mac-selftest-simrun', simulator: 'booted', steps }));
  const sr = shot('capture', simScenario);
  check(`sim scenario${doc.idb ? ' with idb swipe' : ' (no idb: waits and shots only)'}`, sr.ok, sr.error ?? sr.timeline);
} else checks.push({ name: 'sim: skipped (no booted simulator)', ok: true });

const failed = checks.filter((c) => !c.ok);
console.log(
  JSON.stringify({
    ok: failed.length === 0,
    failed: failed.map((c) => c.name),
    checks,
    // shot-after must read "Grüße, café! Hello 123": typing and non-ASCII text work
    look: [snap.file, 'public/captures/mac-selftest-desktop/shot-after.png', 'node bin/agentshot.mjs frames mac-selftest-desktop'],
  }),
);
