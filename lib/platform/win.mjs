// Windows: recorder/win.ps1 (window list, mouse log, input driver) and ffmpeg gdigrab
// (recording and stills). Coordinates are physical pixels, so captures are scale 1.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ffmpeg, sleep } from '../util.mjs';
import { even, lineDriver } from './common.mjs';

const PS = path.join(ROOT, 'recorder', 'win.ps1');

function ps(args) {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', PS, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`win.ps1 ${args[1]} failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim() || 'null');
}

export const name = 'windows';
export const listWindows = () => (ps(['-Mode', 'windows']) ?? []).filter((w) => w.title !== 'Program Manager');
export const listScreens = () => (ps(['-Mode', 'screens']) ?? []).map((s) => ({ ...s, scale: 1 }));

// { x, y, width, height, title, scale } of a window (matched by title, then process) or a screen.
export function region(opt) {
  if (opt.window) {
    const w = ps(['-Mode', 'rect', '-Title', String(opt.window), ...(opt['no-activate'] ? [] : ['-Activate'])]);
    if (!w) throw new Error(`no window with "${opt.window}" in its title or process name (see: agentshot windows)`);
    return { x: w.x, y: w.y, width: even(w.width), height: even(w.height), title: w.title, scale: 1 };
  }
  const screens = listScreens();
  const s = screens[Number(opt.screen ?? 0)];
  if (!s) throw new Error(`no screen ${opt.screen}; screens: ${screens.length}`);
  return { x: s.x, y: s.y, width: even(s.width), height: even(s.height), title: `Screen ${s.index}`, scale: 1 };
}

// Records the region into `video` (H.264, constant fps) without the cursor. startedAt() is the
// wall-clock ms of the video's first frame.
export async function startCapture(r, { fps, video, cursor = false }) {
  const ff = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-y',
      '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', cursor ? '1' : '0',
      '-offset_x', String(r.x), '-offset_y', String(r.y), '-video_size', `${r.width}x${r.height}`,
      '-i', 'desktop',
      // zerolatency: no frame-thread buffering, so out_time tracks the grab clock and the
      // mouse log lines up with the video (otherwise the cursor runs ~0.5 s ahead)
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-progress', 'pipe:1', '-stats_period', '0.1',
      video,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d));
  // Wall-clock moment of the video's t=0: when the first progress report arrives,
  // minus the media time it reports.
  let startedAt = null;
  ff.stdout.on('data', (d) => {
    if (startedAt != null) return;
    const m = /out_time_us=(\d+)/.exec(String(d));
    if (m && Number(m[1]) > 0) startedAt = Date.now() - Number(m[1]) / 1000;
  });
  const exited = new Promise((res) => ff.on('exit', res));
  await sleep(600);
  if (ff.exitCode != null) throw new Error(`ffmpeg exited: ${stderr.slice(-800)}`);
  return {
    startedAt: () => startedAt,
    async stop() {
      ff.stdin.write('q');
      const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
      if (code === 'timeout') ff.kill();
      if (!fs.existsSync(video)) throw new Error(`no video written: ${stderr.slice(-800)}`);
    },
  };
}

// CSV "start,<unix ms>" then "<ms>,<x>,<y>,<left down 0/1>" until stop().
export function startMouseLog(csv) {
  const stopFile = csv + '.stop';
  const p = spawn('pwsh', ['-NoProfile', '-File', PS, '-Mode', 'mouselog', '-Out', csv, '-Stop', stopFile], { stdio: 'ignore' });
  return {
    async stop() {
      fs.writeFileSync(stopFile, '');
      await new Promise((res) => (p.exitCode != null ? res() : p.on('exit', res)));
      fs.rmSync(stopFile, { force: true });
    },
  };
}

// Mouse/keyboard driver (see -Mode drive in win.ps1). It compiles C# first: a few seconds.
export const startDriver = () => lineDriver('pwsh', ['-NoProfile', '-File', PS, '-Mode', 'drive']);

// PNG of the region right now, at full resolution.
export function snap(r, out) {
  ffmpeg([
    '-f', 'gdigrab', '-draw_mouse', '0',
    '-offset_x', String(r.x), '-offset_y', String(r.y), '-video_size', `${r.width}x${r.height}`,
    '-i', 'desktop', '-frames:v', '1', out,
  ]);
}

// ffmpeg drawtext needs an explicit font (no fontconfig); the drive colon is escaped.
export const labelFont = 'C\\:/Windows/Fonts/consola.ttf';

export function open(file) {
  spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref();
}

export function doctor() {
  const has = (c, a = ['-version']) => spawnSync(c, a, { encoding: 'utf8' }).status === 0;
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].some((p) =>
    fs.existsSync(p),
  );
  return { platform: name, chrome, pwsh: has('pwsh', ['-NoProfile', '-Command', 'exit 0']) };
}
