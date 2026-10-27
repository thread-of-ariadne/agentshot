// Compares two rendered libraries (e.g. before and after a renderer change) asset by asset:
// SSIM and PSNR for stills; for videos the mean and worst-frame SSIM, PSNR, frame count,
// fps, duration and colour tags. Usage: node scripts/compare.mjs <libraryA> <libraryB> [--frames 0,300,600]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../lib/util.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2));
const [A, B] = pos.map((p) => path.resolve(p));
if (!A || !B) {
  console.log('usage: node scripts/compare.mjs <libraryA> <libraryB> [--frames 0,300,600]');
  process.exit(1);
}

const run = (cmd, args, cwd) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, cwd });

function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries',
    'stream=width,height,r_frame_rate,nb_read_packets,pix_fmt,color_range,color_space,color_transfer,color_primaries:format=duration', '-of', 'json', file]);
  const j = JSON.parse(r.stdout);
  const s = j.streams[0];
  return {
    size: `${s.width}x${s.height}`,
    fps: s.r_frame_rate,
    frames: Number(s.nb_read_packets),
    duration: Number(j.format.duration ?? 0),
    color: [s.pix_fmt, s.color_range, s.color_space, s.color_transfer, s.color_primaries].join('/'),
  };
}

// SSIM/PSNR of b against a; with `select`, only those frame numbers (videos).
function metrics(a, b, select) {
  // a bare file name in the temp dir: Windows paths need awkward escaping inside a filtergraph
  const name = `ssim-${process.pid}-${Math.random().toString(36).slice(2)}.log`;
  const stats = path.join(os.tmpdir(), name);
  const pick = select ? `select='${select.map((n) => `eq(n\\,${n})`).join('+')}',` : '';
  const graph = `[0:v]${pick}split[a1][a2];[1:v]${pick}split[b1][b2];[a1][b1]ssim=stats_file=${name};[a2][b2]psnr`;
  const r = run('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', graph, '-f', 'null', '-'], os.tmpdir());
  const ssim = Number(/SSIM .*All:([\d.]+)/.exec(r.stderr)?.[1]);
  const psnr = /PSNR .*average:([\d.inf]+)/.exec(r.stderr)?.[1];
  const per = fs.existsSync(stats) ? fs.readFileSync(stats, 'utf8').split('\n').map((l) => Number(/All:([\d.]+)/.exec(l)?.[1])).filter((x) => x > 0) : [];
  fs.rmSync(stats, { force: true });
  if (!ssim) throw new Error(`ffmpeg could not compare ${a} and ${b}: ${r.stderr.slice(-400)}`);
  return { ssim, minSsim: per.length ? Math.min(...per) : ssim, psnr: psnr === 'inf' ? Infinity : Number(psnr) };
}

const rows = [];
for (const product of fs.readdirSync(A)) {
  const pa = path.join(A, product);
  if (!fs.statSync(pa).isDirectory()) continue;
  for (const asset of fs.readdirSync(pa)) {
    for (const ext of ['png', 'mp4']) {
      const a = path.join(pa, asset, `latest.${ext}`);
      const b = path.join(B, product, asset, `latest.${ext}`);
      if (!fs.existsSync(a)) continue;
      if (!fs.existsSync(b)) {
        rows.push({ asset: `${product}/${asset}`, error: 'missing in B' });
        continue;
      }
      const row = { asset: `${product}/${asset}`, kind: ext };
      if (ext === 'mp4') {
        const pa_ = probe(a);
        const pb = probe(b);
        Object.assign(row, { a: pa_, b: pb, all: metrics(a, b) });
        if (opt.frames) row.sampled = metrics(a, b, String(opt.frames).split(',').map(Number).filter((n) => n < pa_.frames));
      } else {
        Object.assign(row, metrics(a, b));
      }
      rows.push(row);
    }
  }
}
console.log(JSON.stringify(rows, null, 1));
