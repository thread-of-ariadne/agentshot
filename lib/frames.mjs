// Looking at video without guessing: contact sheets with timestamps (captures, rendered
// library assets or any video file) and an activity summary (pointer moves, visual changes,
// quiet stretches) that `agentshot inspect` reports for planning cuts and zooms.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { os } from './platform/index.mjs';
import { CAPTURES, LIBRARY, ROOT, ffmpeg, ffprobe, readJson, slug, writeJson } from './util.mjs';

const OUT = path.join(ROOT, '.cache', 'frames');
const FONT = os.labelFont ? `fontfile='${os.labelFont}':` : '';

// <capture> | <product>/<asset>[@<version>] | path to a video. Returns the video and its scale
// (capture points -> pixels, for --crop in the capture's coordinates).
export function resolveVideo(ref) {
  const capFile = path.join(CAPTURES, ref, 'capture.json');
  if (fs.existsSync(capFile)) {
    const cap = readJson(capFile);
    if (cap.video) return { file: path.join(CAPTURES, ref, cap.video), scale: cap.scale ?? 1, cap, label: ref };
    return { frames: cap.frames.map((f) => ({ t: f.t, file: path.join(CAPTURES, ref, f.file) })), scale: cap.scale ?? 1, cap, label: ref };
  }
  const m = /^([^/\\]+)\/([^/\\@]+)(?:@v?(\d+))?$/.exec(ref);
  if (m && !fs.existsSync(ref)) {
    const dir = path.join(LIBRARY, slug(m[1]), slug(m[2]));
    const file = m[3] ? path.join(dir, `v${m[3].padStart(3, '0')}.mp4`) : path.join(dir, 'latest.mp4');
    if (!fs.existsSync(file)) throw new Error(`no video ${file}`);
    return { file, scale: 1, label: `${m[1]}-${m[2]}${m[3] ? '-v' + m[3] : ''}` };
  }
  if (fs.existsSync(ref)) return { file: path.resolve(ref), scale: 1, label: path.basename(ref, path.extname(ref)) };
  throw new Error(`"${ref}" is not a capture, a library asset (product/asset[@v]) or a file`);
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));

// One full-size frame (--at) or a tiled sheet of frames with their times burnt in.
export function frames(ref, opt = {}) {
  const src = resolveVideo(ref);
  fs.mkdirSync(OUT, { recursive: true });
  const crop = opt.crop ? String(opt.crop).split(',').map((v) => Math.round(Number(v) * src.scale)) : null;
  const cropF = crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},` : '';

  if (opt.at !== undefined) {
    const t = Number(opt.at);
    const out = path.resolve(opt.out ?? path.join(OUT, `${src.label}-at${t}.png`));
    if (src.file) ffmpeg(['-i', src.file, '-ss', String(t), '-frames:v', '1', ...(crop ? ['-vf', cropF.slice(0, -1)] : []), out]);
    else {
      const f = [...src.frames].reverse().find((f) => f.t <= t + 1e-6) ?? src.frames[0];
      ffmpeg(['-i', f.file, ...(crop ? ['-vf', cropF.slice(0, -1)] : []), out]);
    }
    return { file: out, at: t };
  }

  const duration = src.file ? ffprobe(src.file).duration : (src.frames.at(-1)?.t ?? 0);
  const from = num(opt.from, 0);
  const to = Math.min(num(opt.to, duration), duration);
  const maxTiles = num(opt.max, 40);
  let every = num(opt.every, Math.max(0.25, (to - from) / 24));
  if ((to - from) / every > maxTiles) every = (to - from) / maxTiles;
  every = +every.toFixed(3);
  const n = Math.max(1, Math.floor((to - from) / every) + 1);
  const cols = num(opt.cols, Math.min(n, crop && crop[2] < crop[3] ? 10 : 6));
  const rows = Math.ceil(n / cols);
  const width = num(opt.width, cols > 6 ? 240 : 320);
  const out = path.resolve(opt.out ?? path.join(OUT, `${src.label}-${from}-${to}.png`));
  const label = `drawtext=${FONT}text='%{pts\\:flt\\:${src.file ? 0 : from}}':x=4:y=4:fontsize=${Math.round(width / 14)}:fontcolor=yellow:box=1:boxcolor=black@0.6`;
  const tile = `tile=${cols}x${rows}:padding=4:color=0x202020`;

  if (src.file) {
    const vf = `select='between(t,${from},${to + 0.001})',fps=1/${every}:start_time=${from},${cropF}scale=${width}:-2,${label},${tile}`;
    ffmpeg(['-i', src.file, '-vf', vf, '-frames:v', '1', out]);
  } else {
    // Browser captures are PNG sequences: pick the frame on screen at each time.
    const list = path.join(OUT, `${src.label}-list.txt`);
    const lines = [];
    for (let k = 0; k < n; k++) {
      const t = from + k * every;
      const f = [...src.frames].reverse().find((f) => f.t <= t + 1e-6) ?? src.frames[0];
      lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${every}`);
    }
    fs.writeFileSync(list, lines.join('\n'));
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=1/${every},${cropF}scale=${width}:-2,${label},${tile}`, '-frames:v', '1', out]);
  }
  return { file: out, from, to, every, tiles: n, cols };
}

// Per-frame change between neighbouring frames (ffmpeg scene score) at 10 fps, cached.
function sceneScores(video) {
  const cache = video + '.activity.json';
  const stamp = fs.statSync(video).mtimeMs;
  if (fs.existsSync(cache)) {
    const c = readJson(cache);
    if (c.stamp === stamp) return c.scores;
  }
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-i', video, '-vf', "fps=10,scale=320:-2,select='gte(scene,0)',metadata=print:file=-", '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg scene scan failed: ${r.stderr}`);
  const scores = [];
  let t = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /pts_time:([\d.]+)/.exec(line);
    if (m) t = Number(m[1]);
    const s = /scene_score=([\d.]+)/.exec(line);
    if (s && t !== null) scores.push([+t.toFixed(2), +Number(s[1]).toFixed(4)]);
  }
  writeJson(cache, { stamp, scores });
  return scores;
}

const spans = (items, gap) => {
  const out = [];
  for (const [a, b] of items) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};
const r2 = (x) => +x.toFixed(2);

// Moves: when the pointer travels (and where). Changes: big visual jumps (page switches).
// Quiet: neither the pointer nor anything on screen moves; cut these or speed them up.
export function activity(cap, dir) {
  const moving = [];
  const p = cap.pointer ?? [];
  for (let i = 1; i < p.length; i++) {
    if (Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) > 0.5) moving.push([p[i - 1].t, p[i].t]);
  }
  const moves = spans(moving, 0.35)
    .filter(([a, b]) => b - a > 0.05)
    .map(([a, b]) => {
      const pa = p.find((q) => q.t >= a);
      const pb = [...p].reverse().find((q) => q.t <= b);
      return { start: r2(a), end: r2(b), from: [Math.round(pa.x), Math.round(pa.y)], to: [Math.round(pb.x), Math.round(pb.y)] };
    });
  if (!cap.video) return { moves };
  const scores = sceneScores(path.join(dir, cap.video));
  const changes = spans(
    scores.filter(([, s]) => s >= 0.08).map(([t]) => [t, t]),
    0.3,
  ).map(([a, b]) => ({ t: r2(a), until: r2(b), score: Math.max(...scores.filter(([t]) => t >= a && t <= b).map(([, s]) => s)) }));
  const motion = spans(
    scores.filter(([, s]) => s >= 0.002).map(([t]) => [t - 0.1, t]),
    0.25,
  ).map(([a, b]) => [r2(Math.max(0, a)), r2(b)]);
  // scripted typing/keys barely change the frame but are not quiet
  const acting = (cap.timeline ?? []).filter((s) => ['type', 'press', 'drag', 'wheel'].includes(s.kind)).map((s) => [s.start, s.end]);
  const busy = spans([...motion, ...acting, ...moves.map((m) => [m.start, m.end])].sort((a, b) => a[0] - b[0]), 0.05);
  const quiet = [];
  let cursor = 0;
  for (const [a, b] of busy) {
    if (a - cursor >= 0.8) quiet.push([r2(cursor), r2(a)]);
    cursor = Math.max(cursor, b);
  }
  if (cap.duration - cursor >= 0.8) quiet.push([r2(cursor), r2(cap.duration)]);
  return { moves, changes, quiet };
}
