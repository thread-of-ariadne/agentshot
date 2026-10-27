// iOS Simulator (macOS): the real native app instead of its web build. Stills come straight from
// `simctl io screenshot` (lossless), video from `simctl io recordVideo`; scenarios tap, swipe and type
// through idb (https://fbidb.io: `brew install facebook/fb/idb-companion` + `pipx install fb-idb`)
// in device points, and the taps become the touch pointer the renderer draws.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CAPTURES, ROOT, ffmpeg, ffprobe, readJson, sleep, writeJson } from './util.mjs';

const STATE = path.join(ROOT, '.recording-sim');

function sh(cmd, args, what) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} not found${cmd === 'idb' ? ': install idb (brew install facebook/fb/idb-companion && pipx install fb-idb)' : ': install Xcode'}`);
  if (r.status !== 0) throw new Error(`${what ?? cmd + ' ' + args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}
const simctl = (...args) => sh('xcrun', ['simctl', ...args], `simctl ${args[0]}`);

export function devices() {
  const j = JSON.parse(simctl('list', 'devices', 'booted', '-j'));
  return Object.entries(j.devices).flatMap(([runtime, list]) =>
    list.filter((d) => d.state === 'Booted').map((d) => ({ udid: d.udid, name: d.name, runtime: runtime.split('.').pop() })),
  );
}

// "booted" / omitted = the first booted one, else a UDID or part of the name.
export function device(spec) {
  const list = devices();
  if (!list.length) throw new Error('no booted simulator: open one (open -a Simulator) or `xcrun simctl boot "iPhone 16 Pro"`');
  if (!spec || spec === 'booted') return list[0];
  const d = list.find((x) => x.udid === spec) ?? list.find((x) => x.name.toLowerCase().includes(String(spec).toLowerCase()));
  if (!d) throw new Error(`no booted simulator "${spec}"; booted: ${list.map((x) => x.name).join(', ')}`);
  return d;
}

// Points -> pixels. Every current iPhone is @3x except SE, XR and 11; iPads are @2x.
export function scaleOf(name) {
  if (/iPad/i.test(name)) return 2;
  if (/iPhone (SE|XR|11)(?! Pro)/i.test(name)) return 2;
  return 3;
}
const deviceKind = (name) => (/iPad/i.test(name) ? 'ipad' : 'iphone');

function screenshot(udid, out) {
  simctl('io', udid, 'screenshot', '--type=png', out);
  return out;
}

// Clean marketing status bar (9:41, full battery and signal) until clearStatusBar().
export function cleanStatusBar(udid) {
  simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3',
    '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100');
}
export const clearStatusBar = (udid) => simctl('status_bar', udid, 'clear');

function baseCapture(name, d, size) {
  const scale = scaleOf(d.name);
  return {
    name,
    source: 'simulator',
    device: deviceKind(d.name),
    simulator: d.name,
    viewport: { width: Math.round(size.width / scale), height: Math.round(size.height / scale) },
    scale,
    fps: 60,
    duration: 0,
    frames: [],
    pointer: [],
    clicks: [],
    shots: {},
    elements: {},
  };
}

export function snapSim({ name, device: spec, shot = 'main', cleanBar }) {
  if (!name) throw new Error('--name is required');
  const d = device(spec);
  const dir = path.join(CAPTURES, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = `shot-${shot}.png`;
  if (cleanBar) cleanStatusBar(d.udid);
  try {
    screenshot(d.udid, path.join(dir, file));
  } finally {
    if (cleanBar) clearStatusBar(d.udid);
  }
  const size = ffprobe(path.join(dir, file));
  const capFile = path.join(dir, 'capture.json');
  const cap = fs.existsSync(capFile) ? readJson(capFile) : baseCapture(name, d, size);
  if (cap.source !== 'simulator') throw new Error(`capture "${name}" exists and is not a simulator capture; pick another --name`);
  cap.shots[shot] = { file, elements: cap.elements };
  writeJson(capFile, cap);
  return { name, shot, device: d.name, viewport: cap.viewport, scale: cap.scale, file: path.join(dir, file), shots: Object.keys(cap.shots) };
}

// simctl recordVideo runs until SIGINT; t=0 is when it reports "Recording started".
function startVideo(udid, raw) {
  const p = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', raw], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let startedAt = null;
  const onData = (d) => {
    log += d;
    if (startedAt == null && /Recording started/i.test(log)) startedAt = Date.now();
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  const exited = new Promise((res) => p.on('exit', res));
  return {
    p,
    async started() {
      for (let i = 0; i < 100 && startedAt == null && p.exitCode == null; i++) await sleep(100);
      if (startedAt == null) throw new Error(`simulator recording did not start: ${log.trim()}`);
      return startedAt;
    },
    async stop() {
      p.kill('SIGINT');
      await Promise.race([exited, sleep(20000)]);
    },
  };
}

// Constant-fps H.264 like every other capture video (simctl writes variable frame rate).
function finishVideo(raw, video, fps) {
  ffmpeg(['-i', raw, '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-movflags', '+faststart', video]);
  fs.rmSync(raw, { force: true });
  return ffprobe(video);
}

// Detached recording for when the user (or anything else) drives the simulator.
export async function recordStart({ name, device: spec, fps = 60 }) {
  if (!name) throw new Error('--name is required');
  fs.mkdirSync(STATE, { recursive: true });
  if (fs.existsSync(path.join(STATE, 'session.json'))) throw new Error('a simulator recording is running (agentshot sim record stop)');
  const d = device(spec);
  const dir = path.join(CAPTURES, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, 'screen.raw.mp4');
  const p = spawn('xcrun', ['simctl', 'io', d.udid, 'recordVideo', '--codec=h264', '--force', raw], { detached: true, stdio: 'ignore' });
  p.unref();
  await sleep(1200);
  if (p.exitCode != null) throw new Error('simctl recordVideo exited at once');
  writeJson(path.join(STATE, 'session.json'), { name, pid: p.pid, device: d, fps: Number(fps), raw, startedAt: new Date().toISOString() });
  return { recording: true, name, device: d.name };
}

export async function recordStop() {
  const f = path.join(STATE, 'session.json');
  if (!fs.existsSync(f)) throw new Error('no simulator recording is running');
  const s = readJson(f);
  try {
    process.kill(s.pid, 'SIGINT');
  } catch {}
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(s.pid, 0);
    } catch {
      break;
    }
    await sleep(200);
  }
  fs.rmSync(f, { force: true });
  const dir = path.join(CAPTURES, s.name);
  const video = path.join(dir, 'screen.mp4');
  const info = finishVideo(s.raw, video, s.fps);
  const cap = { ...baseCapture(s.name, s.device, info), fps: s.fps, duration: +info.duration.toFixed(3), video: 'screen.mp4' };
  writeJson(path.join(dir, 'capture.json'), cap);
  return { name: s.name, device: s.device.name, duration: cap.duration, viewport: cap.viewport, scale: cap.scale, dir };
}

// A small grey thumbnail of the simulator screen, for change / settle checks.
function thumb(udid, tmp) {
  screenshot(udid, tmp);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', tmp, '-vf', 'scale=48:96', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 });
  return r.stdout;
}
const diff = (a, b) => {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs(a[i] - b[i]);
  return s / Math.max(1, a.length);
};

const HID = { enter: 40, return: 40, esc: 41, escape: 41, backspace: 42, tab: 43, space: 44, right: 79, left: 80, down: 81, up: 82 };

export function boxOf(target, track) {
  if (typeof target === 'string') {
    const b = track[target];
    if (!b) throw new Error(`unknown target "${target}"; name it in "track" as [x, y, w, h] (points)`);
    return b;
  }
  if (Array.isArray(target) && (target.length === 2 || target.length === 4)) return target;
  throw new Error(`bad target ${JSON.stringify(target)}: use [x, y], [x, y, w, h] or a "track" name`);
}
const centre = (b) => (b.length === 4 ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : b);

// Scenario with "simulator": steps tap / swipe / type / press / wait / waitStill / shot /
// openUrl / launch / note, while the simulator is recorded.
export async function runSim(sc) {
  if (!sc.name) throw new Error('scenario needs a "name"');
  const d = device(sc.simulator === true ? 'booted' : sc.simulator);
  const track = sc.track ?? {};
  const fps = Number(sc.fps ?? 60);
  const dir = path.join(CAPTURES, sc.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'thumb.png');
  const idb = (...args) => sh('idb', ['ui', ...args, '--udid', d.udid], `idb ui ${args[0]}`);
  const needsIdb = (sc.steps ?? []).some((s) => 'tap' in s || 'click' in s || 'swipe' in s || 'drag' in s || 'type' in s || 'press' in s);
  if (needsIdb) sh('idb', ['--help'], 'idb');

  if (sc.appearance) simctl('ui', d.udid, 'appearance', sc.appearance);
  if (sc.statusBar === 'clean') cleanStatusBar(d.udid);
  if (sc.launch) simctl('launch', d.udid, sc.launch);
  if (sc.openUrl) simctl('openurl', d.udid, sc.openUrl);
  if (sc.launch || sc.openUrl) await sleep(Number(sc.settle ?? 2) * 1000);

  const raw = path.join(dir, 'screen.raw.mp4');
  const rec = startVideo(d.udid, raw);
  const timeline = [];
  const touches = [];
  const shots = [];
  let t0;
  try {
    t0 = await rec.started();
    await sleep(Number(sc.lead ?? 0.6) * 1000);
    for (const [i, step] of (sc.steps ?? []).entries()) {
      const start = Date.now();
      const entry = { i, kind: Object.keys(step)[0] };
      if ('wait' in step) await sleep(step.wait * 1000);
      else if ('tap' in step || 'click' in step) {
        const [x, y] = centre(boxOf(step.tap ?? step.click, track));
        idb('tap', String(Math.round(x)), String(Math.round(y)), ...(step.hold ? ['--duration', String(step.hold)] : []));
        touches.push({ kind: 'tap', at: Date.now() - 60, x, y });
        entry.tap = step.tap ?? step.click;
      } else if ('swipe' in step || 'drag' in step) {
        const [x1, y1] = centre(boxOf(step.swipe ?? step.drag, track));
        const [x2, y2] = centre(boxOf(step.to, track));
        const dur = Number(step.duration ?? 0.5);
        idb('swipe', ...[x1, y1, x2, y2].map((v) => String(Math.round(v))), '--duration', String(dur));
        touches.push({ kind: 'swipe', end: Date.now() - 60, dur, from: [x1, y1], to: [x2, y2] });
      } else if ('type' in step) idb('text', String(step.type));
      else if ('press' in step) {
        const k = String(step.press).toLowerCase();
        if (k === 'home' || k === 'lock') idb('button', k.toUpperCase());
        else if (HID[k]) idb('key', String(HID[k]));
        else throw new Error(`step ${i}: unknown key "${step.press}" (enter esc backspace tab space arrows home lock)`);
      } else if ('openUrl' in step) simctl('openurl', d.udid, step.openUrl);
      else if ('launch' in step) simctl('launch', d.udid, step.launch);
      else if ('waitStill' in step) {
        const quiet = Number(step.waitStill === true ? 0.6 : step.waitStill) * 1000;
        const timeout = Number(step.timeout ?? 8) * 1000;
        let prev = thumb(d.udid, tmp);
        const base = prev;
        entry.changed = false;
        if (step.change !== false) {
          while (Date.now() - start < Number(step.changeTimeout ?? 3) * 1000) {
            prev = thumb(d.udid, tmp);
            if (diff(base, prev) > Number(step.change ?? 6)) {
              entry.changed = true;
              break;
            }
          }
        }
        let calm = Date.now();
        entry.settled = false;
        while (Date.now() - start < timeout) {
          const cur = thumb(d.udid, tmp);
          if (diff(prev, cur) > Number(step.threshold ?? 0.6)) calm = Date.now();
          prev = cur;
          if (Date.now() - calm >= quiet) {
            entry.settled = true;
            break;
          }
        }
      } else if ('shot' in step) {
        const file = `shot-${step.shot}.png`;
        screenshot(d.udid, path.join(dir, file));
        shots.push({ name: step.shot, file, at: Date.now() });
      } else if (!('note' in step)) throw new Error(`step ${i}: unknown step ${JSON.stringify(step)}`);
      if ('note' in step) entry.note = step.note;
      if ('shot' in step) entry.shot = step.shot;
      timeline.push({ ...entry, startMs: start, endMs: Date.now() });
    }
    await sleep(Number(sc.trail ?? 0.8) * 1000);
  } finally {
    await rec.stop();
    fs.rmSync(tmp, { force: true });
    if (sc.statusBar === 'clean') clearStatusBar(d.udid);
  }

  const info = finishVideo(raw, path.join(dir, 'screen.mp4'), fps);
  const sec = (ms) => +((ms - t0) / 1000).toFixed(3);
  // Touch pointer: appear just before a tap, press, lift; a swipe drags along its line.
  const pointer = [];
  const clicks = [];
  for (const tc of touches) {
    if (tc.kind === 'tap') {
      const t = sec(tc.at);
      pointer.push({ t: t - 0.3, x: tc.x, y: tc.y, down: false }, { t, x: tc.x, y: tc.y, down: true }, { t: t + 0.1, x: tc.x, y: tc.y, down: false });
      clicks.push({ t, x: tc.x, y: tc.y, kind: 'click' });
    } else {
      const t1 = sec(tc.end);
      const ta = t1 - tc.dur;
      pointer.push({ t: ta - 0.3, x: tc.from[0], y: tc.from[1], down: false });
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        pointer.push({ t: +(ta + tc.dur * f).toFixed(3), x: tc.from[0] + (tc.to[0] - tc.from[0]) * f, y: tc.from[1] + (tc.to[1] - tc.from[1]) * f, down: true });
      }
      pointer.push({ t: t1 + 0.05, x: tc.to[0], y: tc.to[1], down: false });
      clicks.push({ t: ta, x: tc.from[0], y: tc.from[1], kind: 'down' });
    }
  }
  const elements = Object.fromEntries(Object.entries(track).map(([k, b]) => [k, b.length === 4 ? { x: b[0], y: b[1], w: b[2], h: b[3] } : { x: b[0] - 1, y: b[1] - 1, w: 2, h: 2 }]));
  const cap = {
    ...baseCapture(sc.name, d, info),
    fps,
    duration: +info.duration.toFixed(3),
    video: 'screen.mp4',
    pointer: pointer.sort((a, b) => a.t - b.t),
    clicks,
    elements,
    shots: Object.fromEntries(shots.map((s) => [s.name, { file: s.file, elements, t: sec(s.at) }])),
    wallStart: t0,
    timeline: timeline.map(({ startMs, endMs, ...e }) => ({ ...e, start: sec(startMs), end: sec(endMs) })),
  };
  writeJson(path.join(dir, 'capture.json'), cap);
  return { name: sc.name, device: d.name, duration: cap.duration, viewport: cap.viewport, scale: cap.scale, shots: Object.keys(cap.shots), timeline: cap.timeline, dir };
}
