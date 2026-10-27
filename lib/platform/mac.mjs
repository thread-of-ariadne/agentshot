// macOS: recorder/mac.swift, compiled on first use into .cache/agentshot-mac. Coordinates are points
// (global display space, top-left origin); recordings and stills come at the display's pixel scale
// (2 on Retina), so captures carry scale 2 like browser captures.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ffmpeg, sleep } from '../util.mjs';
import { even, lineDriver } from './common.mjs';

const SRC = path.join(ROOT, 'recorder', 'mac.swift');
const BIN = path.join(ROOT, '.cache', 'agentshot-mac');

export const name = 'macos';

// Compiles the helper when it is missing or older than its source.
export function helper() {
  if (fs.existsSync(BIN) && fs.statSync(BIN).mtimeMs >= fs.statSync(SRC).mtimeMs) return BIN;
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const r = spawnSync('swiftc', ['-O', '-swift-version', '5', '-o', BIN, SRC], { encoding: 'utf8' });
  if (r.error) throw new Error('swiftc not found: install the Xcode Command Line Tools (xcode-select --install)');
  if (r.status !== 0) throw new Error(`building recorder/mac.swift failed:\n${r.stderr}`);
  return BIN;
}

const PERMS_HINT =
  'Give the app that runs the agent (Terminal, iTerm, Claude, VS Code...) Screen Recording and Accessibility ' +
  'in System Settings > Privacy & Security, then restart it. `agentshot doctor --request` opens the prompts.';

function run(args) {
  const r = spawnSync(helper(), args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`agentshot-mac ${args[0]} failed: ${(r.stderr || r.stdout).trim()}\n${PERMS_HINT}`);
  return JSON.parse(r.stdout.trim() || 'null');
}

export const permissions = (request = false) => run(['perms', ...(request ? ['--request'] : [])]);

export const listWindows = () => run(['windows']) ?? [];
export const listScreens = () => run(['screens']) ?? [];

// { x, y, width, height (points), title, scale, id | display } of a window or a screen.
export function region(opt) {
  if (opt.window) {
    const w = run(['rect', '--title', String(opt.window), ...(opt['no-activate'] ? [] : ['--activate'])]);
    if (!w) throw new Error(`no window with "${opt.window}" in its title or app name (see: agentshot windows)`);
    return { x: w.x, y: w.y, width: w.width, height: w.height, title: w.title, scale: w.scale, id: w.id };
  }
  const screens = listScreens();
  const s = screens[Number(opt.screen ?? 0)];
  if (!s) throw new Error(`no screen ${opt.screen}; screens: ${screens.length}`);
  return { x: s.x, y: s.y, width: s.width, height: s.height, title: `Screen ${s.index}`, scale: s.scale, display: s.id };
}

// ScreenCaptureKit records the window itself (it may be partly covered) without the cursor.
// Its file has a variable frame rate; stop() re-encodes it to constant fps H.264 like Windows'.
export async function startCapture(r, { fps, video, cursor = false }) {
  const raw = video.replace(/\.mp4$/, '.raw.mp4');
  const target = r.id ? ['--window', String(r.id)] : ['--display', String(r.display)];
  const p = spawn(helper(), ['record', ...target, '--fps', String(fps), '--out', raw, ...(cursor ? ['--cursor'] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let startedAt = null;
  let doneInfo = null;
  let buf = '';
  p.stderr.on('data', (d) => (stderr += d));
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.started) startedAt = msg.started;
      if (msg.done) doneInfo = msg;
    }
  });
  const exited = new Promise((res) => p.on('exit', res));
  // the first frame arrives as soon as the stream runs
  for (let i = 0; i < 100 && startedAt == null && p.exitCode == null; i++) await sleep(100);
  if (startedAt == null) {
    p.kill();
    throw new Error(`recording did not start: ${stderr.trim() || 'no frames'}\n${PERMS_HINT}`);
  }
  return {
    startedAt: () => startedAt,
    async stop() {
      p.stdin.write('stop\n');
      const code = await Promise.race([exited, sleep(20000).then(() => 'timeout')]);
      if (code === 'timeout') p.kill();
      if (!doneInfo || !fs.existsSync(raw)) throw new Error(`recording failed: ${stderr.trim()}`);
      ffmpeg(['-i', raw, '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-movflags', '+faststart', video]);
      fs.rmSync(raw, { force: true });
    },
  };
}

// CSV "start,<unix ms>" then "<ms>,<x>,<y>,<left down 0/1>" (points) until stop().
export function startMouseLog(csv) {
  const stopFile = csv + '.stop';
  const p = spawn(helper(), ['mouselog', '--out', csv, '--stop', stopFile], { stdio: 'ignore' });
  return {
    async stop() {
      fs.writeFileSync(stopFile, '');
      await new Promise((res) => (p.exitCode != null ? res() : p.on('exit', res)));
      fs.rmSync(stopFile, { force: true });
    },
  };
}

export const startDriver = () => lineDriver(helper(), ['drive']);

// PNG of the window (by id) or the screen rect right now, at pixel resolution.
export function snap(r, out) {
  const target = r.id ? ['--window', String(r.id)] : ['--rect', [r.x, r.y, r.width, r.height].join(',')];
  run(['snap', ...target, '--out', out]);
}

// Homebrew ffmpeg has fontconfig, but an explicit font avoids surprises.
export const labelFont = fs.existsSync('/System/Library/Fonts/Menlo.ttc') ? '/System/Library/Fonts/Menlo.ttc' : null;

export function open(file) {
  spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
}

export function doctor(opt = {}) {
  const has = (c, a) => spawnSync(c, a, { encoding: 'utf8' }).status === 0;
  const macos = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout?.trim();
  const out = {
    platform: name,
    macos,
    macosOk: Number(macos?.split('.')[0]) >= 14,
    chrome: fs.existsSync('/Applications/Google Chrome.app'),
    swiftc: has('swiftc', ['--version']),
    simctl: has('xcrun', ['simctl', 'help']),
    idb: has('idb', ['--help']),
  };
  if (out.swiftc) {
    try {
      out.helper = helper();
      Object.assign(out, permissions(!!opt.request));
    } catch (e) {
      out.helperError = e.message;
    }
  }
  if (out.screenRecording === false || out.accessibility === false) out.hint = PERMS_HINT;
  return out;
}
