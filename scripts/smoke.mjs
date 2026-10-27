// End-to-end smoke test (`npm test`): captures the demo app, renders a still and a video into a
// temporary library and checks sizes, codec, colour tags and that a bad recipe fails cleanly.
// Needs Google Chrome and ffmpeg. Writes the demo captures to public/captures/ (gitignored).
// Usage: node scripts/smoke.mjs [--keep]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'agentshot-smoke-'));
fs.mkdirSync(path.join(lib, 'daybook'), { recursive: true });
fs.copyFileSync(path.join(root, 'library', 'daybook', 'style.json'), path.join(lib, 'daybook', 'style.json'));

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
  process.stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail)}`}\n`);
};

function shot(...args) {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'agentshot.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AGENTSHOT_LIBRARY: lib },
  });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { ok: false, error: `no JSON from agentshot ${args[0]}`, stdout: r.stdout, stderr: r.stderr };
  }
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries',
    'stream=codec_name,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries,r_frame_rate,nb_read_packets',
    '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout || '{"streams":[{}]}').streams[0];
}

try {
  for (const s of ['phone-still', 'phone-drag']) {
    const r = shot('capture', path.join('examples', 'scenarios', `${s}.json`));
    check(`capture ${s}`, r.ok, r);
  }

  const r = shot('render', path.join('examples', 'recipes', 'help-step1.json'), path.join('examples', 'recipes', 'drag-video.json'), '--note', 'smoke');
  check('render still + video', r.ok && r.results?.length === 2, r);
  const [still, video] = r.results ?? [];

  if (still) {
    const p = probe(still.output);
    check('still is a 2400x1500 PNG', p.codec_name === 'png' && p.width === 2400 && p.height === 1500, p);
  }
  if (video) {
    const p = probe(video.output);
    check('video is 1920x1080 H.264 at 60 fps', p.codec_name === 'h264' && p.width === 1920 && p.height === 1080 && p.r_frame_rate === '60/1', p);
    check('video is yuv420p, limited range, BT.709 tagged',
      p.pix_fmt === 'yuv420p' && p.color_range === 'tv' && p.color_space === 'bt709' && p.color_transfer === 'bt709' && p.color_primaries === 'bt709', p);
    check('video has the expected length', Number(p.nb_read_packets) === 377, p.nb_read_packets);
  }

  const bad = path.join(lib, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ name: 'bad', product: 'daybook', capture: 'daybook-phone', shot: 'main', annotations: [{ type: 'step', n: 1, target: 'nope' }] }));
  const e = shot('render', bad);
  check('bad target fails with a helpful error', e.ok === false && /Unknown target "nope"/.test(e.error) && /birthday/.test(e.error), e);
  check('failed render leaves no file', !fs.existsSync(path.join(lib, 'daybook', 'bad', 'v001.png')));
} finally {
  if (!process.argv.includes('--keep')) fs.rmSync(lib, { recursive: true, force: true });
}

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({ ok, checks, ...(process.argv.includes('--keep') ? { library: lib } : {}) }));
process.exit(ok ? 0 : 1);
