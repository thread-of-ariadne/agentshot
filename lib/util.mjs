import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CAPTURES = path.join(ROOT, 'public', 'captures');
export const LIBRARY = process.env.AGENTSHOT_LIBRARY ? path.resolve(process.env.AGENTSHOT_LIBRARY) : path.join(ROOT, 'library');

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1));
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every command prints exactly one JSON result on stdout so agents can parse it.
export function done(result) {
  console.log(JSON.stringify({ ok: true, ...result }));
}
export function fail(message, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: message, ...extra }));
  process.exit(1);
}

// --key value / --key=value / --flag, everything else positional.
export function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) opt[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[a.slice(2)] = argv[++i];
    else opt[a.slice(2)] = true;
  }
  return { pos, opt };
}

export const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Recipe values win over style defaults; nested objects merge, arrays replace.
export function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

export function ffprobe(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  return {
    width: v?.width,
    height: v?.height,
    duration: j.format?.duration ? Number(j.format.duration) : 0,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

export function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u0430-\u044f\u0451]+/gi, '-') // Latin, digits and Cyrillic letters
    .replace(/^-+|-+$/g, '') || 'untitled';
