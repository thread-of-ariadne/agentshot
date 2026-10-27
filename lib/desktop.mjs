// Desktop scenarios: the same JSON steps as a browser scenario, but against a native window.
// The window is recorded (record.mjs) while the platform driver (recorder/win.ps1 -Mode drive,
// recorder/mac.swift drive) moves the real mouse, clicks, scrolls and types; `shot` steps become stills cut from the recording, and every step
// lands in capture.timeline (video seconds) so cuts and zooms can be planned without guessing.
// Coordinates are window points ([x, y], or [x, y, w, h] = its centre) or names from "track";
// points are pixels on Windows and half the pixels on a Retina Mac.
import fs from 'node:fs';
import path from 'node:path';
import { os } from './platform/index.mjs';
import { begin, region } from './record.mjs';
import { CAPTURES, ffmpeg, readJson, sleep, writeJson } from './util.mjs';

export function boxOf(target, track) {
  if (typeof target === 'string') {
    const b = track[target];
    if (!b) throw new Error(`unknown target "${target}"; name it in "track" as [x, y, w, h] (window px)`);
    return b;
  }
  if (Array.isArray(target) && (target.length === 2 || target.length === 4)) return target;
  throw new Error(`bad target ${JSON.stringify(target)}: use [x, y], [x, y, w, h] or a "track" name`);
}
const centre = (b) => (b.length === 4 ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : b);

export async function runDesktop(sc) {
  if (!sc.name) throw new Error('scenario needs a "name"');
  const track = sc.track ?? {};
  // The driver compiles C# for a few seconds: start it before the recording.
  const drv = os.startDriver();
  await drv.ready;
  const timeline = [];
  let h;
  try {
    h = await begin({ name: sc.name, window: sc.window, fps: sc.fps ?? 60 });
    const r = h.region;
    const at = (target) => {
      const [x, y] = centre(boxOf(target, track));
      return { x: Math.round(r.x + x), y: Math.round(r.y + y) };
    };
    const ms = (s, d) => Math.round((s ?? d) * 1000);
    const moveTo = (target, dur) => drv.send({ op: 'move', ...at(target), ms: ms(dur, 0.7) });

    await sleep(ms(sc.lead, 0.6));
    if (sc.cursor) await drv.send({ op: 'move', ...at(sc.cursor), ms: 0 });
    for (const [i, step] of (sc.steps ?? []).entries()) {
      const start = Date.now();
      const entry = { i, ...step };
      if ('wait' in step) await sleep(ms(step.wait));
      else if ('move' in step) await moveTo(step.move, step.duration);
      else if ('click' in step || 'tap' in step) {
        const target = step.click ?? step.tap;
        if (target !== true) await moveTo(target, step.duration);
        entry.clickAt = Date.now();
        await drv.send({ op: 'click', button: step.button ?? 'left', count: step.double ? 2 : 1 });
      } else if ('drag' in step) {
        await moveTo(step.drag, 0.5);
        await drv.send({ op: 'down' });
        await sleep(120);
        await moveTo(step.to, step.duration ?? 1.2);
        await sleep(120);
        await drv.send({ op: 'up' });
      } else if ('wheel' in step) {
        if (step.at) await moveTo(step.at, step.duration);
        await drv.send({ op: 'wheel', notches: step.wheel });
      } else if ('type' in step) {
        if (step.into) {
          await moveTo(step.into, step.duration);
          await drv.send({ op: 'click' });
          await sleep(200);
        }
        await drv.send({ op: 'text', text: String(step.type), cps: step.cps ?? 14 });
      } else if ('press' in step) await drv.send({ op: 'key', combo: step.press });
      else if ('waitStill' in step) {
        const b = step.region ? boxOf(step.region, track) : [0, 0, r.width, r.height];
        const res = await drv.send({
          op: 'still',
          x: r.x + b[0],
          y: r.y + b[1],
          w: b[2],
          h: b[3],
          quiet: ms(step.waitStill === true ? undefined : step.waitStill, 0.5),
          timeout: ms(step.timeout, 8),
          threshold: step.threshold ?? 0.6,
          // wait for the screen to react first, unless "change": false (just let it settle)
          change: step.change === false ? 0 : (step.change ?? 6),
          changeTimeout: ms(step.changeTimeout, 3),
        });
        entry.settled = res.settled;
        entry.changed = res.changed;
      } else if ('shot' in step) entry.shotAt = Date.now();
      else if ('note' in step) {
        // marker only: shows up in the timeline
      } else throw new Error(`step ${i}: unknown step ${JSON.stringify(step)}`);
      timeline.push({ ...entry, startMs: start, endMs: Date.now() });
    }
    await sleep(ms(sc.trail, 0.8));
  } catch (e) {
    if (h) await h.stop().catch(() => {});
    throw e;
  } finally {
    drv.close();
  }
  const summary = await h.stop();
  return finishDesktop(sc, timeline, summary);
}

// Puts step times on the video clock, cuts the shot stills and names the tracked boxes.
function finishDesktop(sc, timeline, summary) {
  const dir = path.join(CAPTURES, sc.name);
  const capFile = path.join(dir, 'capture.json');
  const cap = readJson(capFile);
  const sec = (wall) => +((wall - cap.wallStart) / 1000).toFixed(3);
  const elements = Object.fromEntries(Object.entries(sc.track ?? {}).map(([k, b]) => [k, toBox(b)]));
  cap.elements = elements;
  cap.timeline = timeline.map(({ startMs, endMs, clickAt, shotAt, i, ...step }) => {
    const kind = Object.keys(step).find((k) => STEP_KINDS.includes(k)) ?? 'step';
    const out = { i, kind, start: sec(startMs), end: sec(endMs) };
    if (clickAt) out.at = sec(clickAt);
    const target = step[kind];
    if (target !== undefined && target !== true) out[kind] = target;
    if (step.settled !== undefined) Object.assign(out, { changed: step.changed, settled: step.settled });
    return out;
  });
  for (const t of timeline.filter((t) => t.shotAt)) {
    const at = Math.min(Math.max(0, sec(t.shotAt)), cap.duration - 0.05);
    const file = `shot-${t.shot}.png`;
    extractFrame(path.join(dir, cap.video), at, path.join(dir, file));
    cap.shots[t.shot] = { file, elements, t: at };
  }
  writeJson(capFile, cap);
  return { ...summary, shots: Object.keys(cap.shots), timeline: cap.timeline };
}

const STEP_KINDS = ['wait', 'move', 'click', 'tap', 'drag', 'wheel', 'type', 'press', 'waitStill', 'shot', 'note'];

const toBox = (b) => (b.length === 4 ? { x: b[0], y: b[1], w: b[2], h: b[3] } : { x: b[0] - 1, y: b[1] - 1, w: 2, h: 2 });

// Seeks after -i: slower, but always the exact frame.
export function extractFrame(video, t, out) {
  ffmpeg(['-i', video, '-ss', String(t), '-frames:v', '1', out]);
}

// Still of a window right now, as a new capture or one more shot of an existing snap capture.
export function snapWindow({ window: title, name, shot = 'main' }) {
  if (!name) throw new Error('--name is required');
  const r = region({ window: title });
  const dir = path.join(CAPTURES, name);
  const capFile = path.join(dir, 'capture.json');
  let cap = fs.existsSync(capFile) ? readJson(capFile) : null;
  const viewport = { width: Math.round(r.width), height: Math.round(r.height) };
  if (cap && (cap.source !== 'snap' || cap.viewport.width !== viewport.width || cap.viewport.height !== viewport.height)) {
    throw new Error(`capture "${name}" exists and is not a ${viewport.width}x${viewport.height} snap capture; pick another --name`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = `shot-${shot}.png`;
  os.snap(r, path.join(dir, file));
  cap ??= {
    name,
    source: 'snap',
    device: 'desktop',
    window: r.title,
    viewport,
    scale: r.scale ?? 1,
    fps: 30,
    duration: 0,
    frames: [],
    pointer: [],
    clicks: [],
    shots: {},
    elements: {},
  };
  cap.shots[shot] = { file, elements: cap.elements };
  writeJson(capFile, cap);
  return { name, shot, window: r.title, size: cap.viewport, file: path.join(dir, file), shots: Object.keys(cap.shots) };
}

// A still cut from a capture's video at time t (recordings and imported videos).
export function snapFromCapture(name, t, shot) {
  const dir = path.join(CAPTURES, name);
  const capFile = path.join(dir, 'capture.json');
  if (!fs.existsSync(capFile)) throw new Error(`no capture "${name}"`);
  const cap = readJson(capFile);
  if (!cap.video) throw new Error(`capture "${name}" has no video; use --window to snap a window`);
  const at = Math.min(Math.max(0, Number(t)), cap.duration - 0.05);
  const id = shot ?? `t${String(at).replace('.', '_')}`;
  const file = `shot-${id}.png`;
  extractFrame(path.join(dir, cap.video), at, path.join(dir, file));
  cap.shots[id] = { file, elements: cap.elements, t: at };
  writeJson(capFile, cap);
  return { name, shot: id, t: at, file: path.join(dir, file), shots: Object.keys(cap.shots) };
}
