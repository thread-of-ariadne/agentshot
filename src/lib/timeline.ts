import type { Capture, Cut, Point, Recipe } from './types';
import { resolvePoint } from './geometry';

export const easeInOut = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function frameAt(cap: Capture, t: number): string {
  if (!cap.frames.length) throw new Error(`capture "${cap.name}" has no frames`);
  let file = cap.frames[0].file;
  for (const f of cap.frames) {
    if (f.t <= t + 1e-6) file = f.file;
    else break;
  }
  return file;
}

export function pointerAt(cap: Capture, t: number): { x: number; y: number; down: boolean } | null {
  const p = cap.pointer;
  if (!p.length) return null;
  if (t <= p[0].t) return p[0];
  for (let i = 1; i < p.length; i++) {
    if (p[i].t >= t) {
      const a = p[i - 1];
      const b = p[i];
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, down: a.down };
    }
  }
  return p[p.length - 1];
}

type Segment = { start: number; end: number; scale: number; points: { t: number; p: Point }[] };

const RAMP = 0.65;

// Clicks closer than this are framed by one continuous zoom.
const CLICK_GAP = 3.2;

// Segments are in output time, so a zoom keeps easing across a cut instead of snapping back
// when the next part starts (recipe zoom times are capture seconds and are mapped here).
export function zoomSegments(recipe: Recipe, cap: Capture, map: TimeMap): Segment[] {
  if (!recipe.zoom) return [];
  if (recipe.zoom !== 'auto') {
    return recipe.zoom.map((z) => ({
      start: outputTime(map, z.start),
      end: outputTime(map, z.end),
      scale: z.scale ?? recipe.zoomScale ?? 1.5,
      points: [{ t: outputTime(map, z.start), p: resolvePoint(z.target, cap.elements, cap) }],
    }));
  }
  const segs: Segment[] = [];
  for (const c of cap.clicks) {
    // clicks that were cut out get no zoom
    if (!map.cuts.some((k) => c.t >= k.from && c.t <= k.to)) continue;
    const t = outputTime(map, c.t);
    const last = segs[segs.length - 1];
    if (last && t - last.points[last.points.length - 1].t < CLICK_GAP) {
      last.points.push({ t, p: { x: c.x, y: c.y } });
      last.end = t + 1.1;
    } else {
      segs.push({ start: t - 0.55, end: t + 1.1, scale: recipe.zoomScale ?? 1.4, points: [{ t, p: { x: c.x, y: c.y } }] });
    }
  }
  return segs;
}

// Camera at time t: scale and the screen point it zooms toward.
export function cameraAt(segs: Segment[], t: number): { s: number; focus: Point | null } {
  for (const seg of segs) {
    if (t < seg.start - RAMP || t > seg.end + RAMP) continue;
    const env = t < seg.start ? easeInOut((t - (seg.start - RAMP)) / RAMP) : t > seg.end ? 1 - easeInOut((t - seg.end) / RAMP) : 1;
    // Focus glides between successive click points.
    let focus = seg.points[0].p;
    for (let i = 1; i < seg.points.length; i++) {
      const prev = focus;
      const next = seg.points[i];
      const k = easeInOut((t - (next.t - 0.45)) / 0.5);
      focus = { x: prev.x + (next.p.x - prev.x) * k, y: prev.y + (next.p.y - prev.y) * k };
    }
    return { s: 1 + (seg.scale - 1) * env, focus };
  }
  return { s: 1, focus: null };
}

// Output time -> capture time through the recipe's cuts (named beats with optional speed).
export type TimeMap = { cuts: (Cut & { outStart: number; outEnd: number })[]; duration: number };

export function timeMap(recipe: Recipe, cap: Capture): TimeMap {
  const cuts = recipe.cuts?.length ? recipe.cuts : [{ from: 0, to: cap.duration }];
  let out = 0;
  const mapped = cuts.map((c) => {
    const len = (c.to - c.from) / (c.speed ?? 1);
    const m = { ...c, outStart: out, outEnd: out + len };
    out += len;
    return m;
  });
  return { cuts: mapped, duration: out };
}

// Capture time -> output time; a moment that was cut out maps to the start of the next kept part.
export function outputTime(map: TimeMap, t: number): number {
  for (const c of map.cuts) {
    if (t < c.from) return c.outStart;
    if (t <= c.to) return c.outStart + (t - c.from) / (c.speed ?? 1);
  }
  return map.duration;
}

export function captureTime(map: TimeMap, t: number): number {
  for (const c of map.cuts) {
    if (t < c.outEnd) return c.from + Math.max(0, t - c.outStart) * (c.speed ?? 1);
  }
  // tail: hold the last moment
  const last = map.cuts[map.cuts.length - 1];
  return last.to;
}

// Index of the source-video frame shown at output frame `frame`. Matches what the Remotion
// version showed: each cut plays from round(from * fps) at its speed, frames counted in
// output fps, and the tail holds the frame just before the last cut's end. The frame shown
// at time t is the last one that starts at or before t.
export function videoFrameAt(map: TimeMap, frame: number, fps: number, video: { times: number[] }): number {
  let t: number | null = null;
  for (const c of map.cuts) {
    const start = Math.round(c.outStart * fps);
    const len = Math.max(1, Math.round((c.outEnd - c.outStart) * fps));
    if (frame >= start && frame < start + len) t = (Math.round(c.from * fps) + (frame - start) * (c.speed ?? 1)) / fps;
  }
  const last = map.cuts[map.cuts.length - 1];
  if (frame >= Math.round(map.duration * fps)) t = Math.max(0, Math.round(last.to * fps) - 1) / fps;
  t ??= captureTime(map, frame / fps);
  const { times } = video;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t + 1e-4) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
