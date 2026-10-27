// Exact frames of a capture's video (screen recordings, imported clips), extracted once with
// ffmpeg into .cache/frames/<key>/<n>.png so the scene can show frame n as a plain image.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ffmpeg } from './util.mjs';

export const FRAMES = path.join(ROOT, '.cache', 'frames');

// Presentation time (s) of every frame of the first video stream, in order. Screen
// recordings can have variable frame rate (dropped frames), so frames are picked by time.
export function probeVideo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`);
  const times = r.stdout
    .split(/\s+/)
    .map((l) => parseFloat(l))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (!times.length) throw new Error(`no video frames in ${file}`);
  const start = times[0];
  return { times: times.map((t) => +(t - start).toFixed(6)) };
}

// Cache folder for a video, keyed by its path, size and mtime so a re-import invalidates it.
export function framesKey(capture, file) {
  const st = fs.statSync(file);
  const h = crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 10);
  return `${capture}-${h}`;
}

// Writes the frames with the given indices (0-based, presentation order) not cached yet.
export function extractFrames(file, key, indices) {
  const dir = path.join(FRAMES, key);
  fs.mkdirSync(dir, { recursive: true });
  const missing = indices.filter((n) => !fs.existsSync(path.join(dir, `${n}.png`)));
  if (!missing.length) return dir;
  // Contiguous ranges (small gaps filled in) keep the select expression short; select
  // passes the chosen frames in order, so output k is the k-th index of the ranges.
  const ranges = [];
  for (const n of missing) {
    const last = ranges[ranges.length - 1];
    if (last && n - last[1] <= 8) last[1] = n;
    else ranges.push([n, n]);
  }
  const tmp = fs.mkdtempSync(path.join(dir, 'tmp-'));
  try {
    const expr = ranges.map(([a, b]) => `between(n\\,${a}\\,${b})`).join('+');
    // rgb24 PNGs at low compression: lossless and quick for Chrome to decode
    ffmpeg(['-i', file, '-vf', `select=${expr}`, '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-compression_level', '1', '-start_number', '0', path.join(tmp, '%d.png')]);
    let k = 0;
    for (const [a, b] of ranges) {
      for (let n = a; n <= b; n++, k++) {
        const src = path.join(tmp, `${k}.png`);
        if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, `${n}.png`));
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}
