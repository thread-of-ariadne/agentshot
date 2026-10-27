// Brings an existing screenshot or screen recording (e.g. from an iPhone) into the library
// as a capture, so it can be styled and cut like anything captured here.
import fs from 'node:fs';
import path from 'node:path';
import { CAPTURES, ffmpeg, ffprobe, writeJson } from './util.mjs';

const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;

export function importFile(file, { name, device, scale } = {}) {
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  if (!name) throw new Error('--name is required');
  const outDir = path.join(CAPTURES, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const info = ffprobe(file);
  // Phone screenshots and recordings are @3x; anything wider than tall is a desktop at 1x.
  const guessedDevice = device ?? (info.height > info.width ? 'iphone' : 'desktop');
  const s = Number(scale ?? (guessedDevice === 'iphone' && info.width >= 1000 ? 3 : 1));
  const viewport = { width: Math.round(info.width / s), height: Math.round(info.height / s) };
  const base = {
    name,
    source: 'import',
    device: guessedDevice,
    viewport,
    scale: s,
    fps: 30,
    frames: [],
    pointer: [],
    clicks: [],
    shots: {},
    elements: {},
  };

  if (IMAGE.test(file)) {
    const out = 'main.png';
    if (/\.png$/i.test(file)) fs.copyFileSync(file, path.join(outDir, out));
    else ffmpeg(['-i', file, path.join(outDir, out)]);
    writeJson(path.join(outDir, 'capture.json'), { ...base, duration: 0, shots: { main: { file: out, elements: {} } } });
    return { name, kind: 'image', shot: 'main', viewport, scale: s, dir: outDir };
  }
  if (VIDEO.test(file)) {
    // Re-encode to H.264 at a constant 30 fps: iPhone HEVC/VFR files do not decode reliably in Chrome.
    const out = 'source.mp4';
    ffmpeg(['-i', file, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-c:a', 'aac', path.join(outDir, out)]);
    const dur = ffprobe(path.join(outDir, out)).duration;
    writeJson(path.join(outDir, 'capture.json'), { ...base, duration: dur, video: out });
    return { name, kind: 'video', duration: dur, viewport, scale: s, dir: outDir };
  }
  throw new Error(`unsupported file type: ${file}`);
}
