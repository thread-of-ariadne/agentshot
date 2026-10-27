// Screen recording of a window or screen (Windows: ffmpeg gdigrab, macOS: ScreenCaptureKit, see
// lib/platform) without the cursor; the mouse is logged alongside, and both are merged into a
// capture whose cursor, clicks and zooms are drawn by the renderer.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { os } from './platform/index.mjs';
import { CAPTURES, ROOT, ffprobe, sleep, writeJson, readJson } from './util.mjs';

const STATE = path.join(ROOT, '.recording');

export const listWindows = () => os.listWindows();
export const listScreens = () => os.listScreens();
export const region = (opt) => os.region(opt);

// Starts the recording + the mouse logger; resolves to a handle whose stop() builds the capture.
export async function begin(opt) {
  if (!opt.name) throw new Error('--name is required');
  const fps = Number(opt.fps ?? 30);
  const r = region(opt);
  const outDir = path.join(CAPTURES, opt.name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const video = path.join(outDir, 'screen.mp4');
  const mouseCsv = path.join(outDir, 'mouse.csv');

  const logger = os.startMouseLog(mouseCsv);
  let rec;
  try {
    rec = await os.startCapture(r, { fps, video, cursor: !!opt['show-cursor'] });
  } catch (e) {
    await logger.stop();
    throw e;
  }

  return {
    region: r,
    dir: outDir,
    async stop() {
      await rec.stop();
      await logger.stop();
      return finish({ name: opt.name, fps, r, video, mouseCsv, videoStartMs: rec.startedAt(), outDir });
    },
  };
}

function finish({ name, fps, r, video, mouseCsv, videoStartMs, outDir }) {
  const info = ffprobe(video);
  const lines = fs.readFileSync(mouseCsv, 'utf8').trim().split(/\r?\n/);
  const logStart = Number(lines[0].split(',')[1]);
  const t0 = videoStartMs ?? logStart;
  const pointer = [];
  const clicks = [];
  let wasDown = false;
  let lastT = -1;
  for (const line of lines.slice(1)) {
    const [ms, x, y, down] = line.split(',').map(Number);
    const t = (logStart + ms - t0) / 1000;
    const isDown = down === 1;
    const p = { t: +t.toFixed(4), x: +(x - r.x).toFixed(1), y: +(y - r.y).toFixed(1), down: isDown };
    if (isDown && !wasDown) clicks.push({ t: p.t, x: p.x, y: p.y, kind: 'click' });
    // keep ~60 samples/s plus every button change
    if (t - lastT >= 1 / 60 || isDown !== wasDown) {
      pointer.push(p);
      lastT = t;
    }
    wasDown = isDown;
  }
  const capture = {
    name,
    source: 'record',
    device: 'desktop',
    window: r.title,
    // points; the video is scale times larger (2 on a Retina Mac, 1 on Windows)
    viewport: { width: Math.round(r.width), height: Math.round(r.height) },
    scale: r.scale ?? 1,
    fps,
    duration: +info.duration.toFixed(3),
    frames: [],
    video: path.basename(video),
    pointer: pointer.filter((p) => p.t >= -0.5 && p.t <= info.duration + 0.5),
    clicks: clicks.filter((c) => c.t >= 0 && c.t <= info.duration),
    shots: {},
    elements: {},
    // wall-clock ms of video t=0, to place events logged elsewhere (desktop scenario steps)
    wallStart: t0,
    region: { x: r.x, y: r.y },
  };
  writeJson(path.join(outDir, 'capture.json'), capture);
  return { name, window: r.title, duration: capture.duration, size: capture.viewport, clicks: capture.clicks.length, dir: outDir };
}

export async function recordFor(opt) {
  const h = await begin(opt);
  await sleep(Number(opt.duration) * 1000);
  return h.stop();
}

// Detached recording: `record start` launches this module as a daemon that waits for
// `record stop` to drop a stop file.
export async function start(opt) {
  fs.mkdirSync(STATE, { recursive: true });
  const st = status();
  if (st.running) throw new Error(`already recording "${st.name}" (agentshot record stop)`);
  for (const f of ['stop', 'result.json', 'error.txt']) fs.rmSync(path.join(STATE, f), { force: true });
  writeJson(path.join(STATE, 'session.json'), { ...opt, startedAt: new Date().toISOString() });
  const child = spawn(process.execPath, [path.join(ROOT, 'lib', 'record.mjs'), '--daemon'], {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT,
  });
  child.unref();
  fs.writeFileSync(path.join(STATE, 'pid'), String(child.pid));
  // wait until the daemon reports it is recording
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (fs.existsSync(path.join(STATE, 'error.txt'))) throw new Error(fs.readFileSync(path.join(STATE, 'error.txt'), 'utf8'));
    if (fs.existsSync(path.join(STATE, 'recording.json'))) return { recording: true, ...readJson(path.join(STATE, 'recording.json')) };
  }
  throw new Error('recorder did not start within 15s');
}

export async function stop() {
  const resultFile = path.join(STATE, 'result.json');
  if (!status().running && !fs.existsSync(resultFile)) throw new Error('nothing is recording');
  fs.writeFileSync(path.join(STATE, 'stop'), '');
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    if (fs.existsSync(path.join(STATE, 'error.txt'))) throw new Error(fs.readFileSync(path.join(STATE, 'error.txt'), 'utf8'));
    if (fs.existsSync(path.join(STATE, 'result.json'))) {
      const res = readJson(path.join(STATE, 'result.json'));
      for (const f of ['pid', 'session.json', 'recording.json', 'stop']) fs.rmSync(path.join(STATE, f), { force: true });
      return res;
    }
  }
  throw new Error('recorder did not finish within 60s');
}

export function status() {
  const pidFile = path.join(STATE, 'pid');
  if (!fs.existsSync(pidFile)) return { running: false };
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (!alive) return { running: false };
  const s = fs.existsSync(path.join(STATE, 'recording.json')) ? readJson(path.join(STATE, 'recording.json')) : {};
  return { running: true, pid, ...s };
}

if (process.argv.includes('--daemon')) {
  try {
    const opt = readJson(path.join(STATE, 'session.json'));
    const h = await begin(opt);
    writeJson(path.join(STATE, 'recording.json'), { name: opt.name, window: h.region.title, region: h.region, startedAt: opt.startedAt });
    const limit = Date.now() + Number(opt.max ?? 600) * 1000;
    while (!fs.existsSync(path.join(STATE, 'stop')) && Date.now() < limit) await sleep(150);
    writeJson(path.join(STATE, 'result.json'), await h.stop());
  } catch (e) {
    fs.writeFileSync(path.join(STATE, 'error.txt'), e instanceof Error ? e.message : String(e));
  }
  process.exit(0);
}
