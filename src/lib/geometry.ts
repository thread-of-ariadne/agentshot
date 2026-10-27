import type { Box, Capture, Recipe, Target, Point } from './types';

// Device chrome in screen points (iPhone) or as a share of screen width (browser/window).
export const IPHONE = { bezel: 7, rim: 3.5, screenRadius: 55, island: { w: 124, h: 36, top: 11 } };
export const BROWSER_BAR = 0.038;
export const WINDOW_BAR = 0.026;

export type Layout = {
  outer: Box; // device incl. chrome, in canvas px
  screen: Box; // captured viewport, in canvas px
  k: number; // canvas px per screen point
  radius: number; // screen corner radius in canvas px
};

export function deviceOf(recipe: Recipe, cap: Capture): NonNullable<Recipe['device']> {
  if (recipe.device) return recipe.device;
  if (cap.device === 'iphone') return 'iphone-black';
  return cap.source === 'browser' ? 'browser' : 'none';
}

export function layout(recipe: Recipe, cap: Capture, W: number, H: number): Layout {
  const { width: vw, height: vh } = cap.viewport;
  const device = deviceOf(recipe, cap);
  const pad = recipe.padding ?? (device.startsWith('iphone') ? 0.07 : 0.08);
  const availW = W * (1 - 2 * pad);
  const availH = H * (1 - 2 * pad);

  // Chrome size as a function of k (px per point): outerW = a*k, outerH = b*k
  let a = vw;
  let b = vh;
  let left = 0;
  let top = 0;
  if (device.startsWith('iphone')) {
    const c = IPHONE.bezel + IPHONE.rim;
    a = vw + 2 * c;
    b = vh + 2 * c;
    left = c;
    top = c;
  } else if (device === 'browser' || device === 'window') {
    const bar = vw * (device === 'browser' ? BROWSER_BAR : WINDOW_BAR);
    b = vh + bar;
    top = bar;
  }
  const k = Math.min(availW / a, availH / b);
  const [px, py] = recipe.position ?? [0.5, 0.5];
  const outer = { w: a * k, h: b * k, x: W * px - (a * k) / 2, y: H * py - (b * k) / 2 };
  const screen = { x: outer.x + left * k, y: outer.y + top * k, w: vw * k, h: vh * k };
  const radius = device.startsWith('iphone') ? IPHONE.screenRadius * k : device === 'none' ? Math.min(W, H) * 0.012 : 0;
  return { outer, screen, k, radius };
}

export const toCanvas = (L: Layout, p: Point): Point => ({ x: L.screen.x + p.x * L.k, y: L.screen.y + p.y * L.k });

export const boxToCanvas = (L: Layout, b: Box): Box => ({
  x: L.screen.x + b.x * L.k,
  y: L.screen.y + b.y * L.k,
  w: b.w * L.k,
  h: b.h * L.k,
});

function unknown(t: string, elements: Record<string, Box>): Error {
  return new Error(`Unknown target "${t}". Known elements: ${Object.keys(elements).join(', ') || 'none (use [x, y] or [x, y, w, h] in screen points)'}`);
}

export function resolveBox(t: Target, elements: Record<string, Box>): Box {
  if (Array.isArray(t)) {
    if (t.length === 4) return { x: t[0], y: t[1], w: t[2], h: t[3] };
    return { x: t[0] - 1, y: t[1] - 1, w: 2, h: 2 };
  }
  const b = elements[t];
  if (!b) throw unknown(t, elements);
  return b;
}

// anchor is a point inside the box as fractions, [0.5, 0.5] being its centre.
export function resolvePoint(t: Target, elements: Record<string, Box>, cap: Capture, anchor: [number, number] = [0.5, 0.5]): Point {
  if (Array.isArray(t) && t.length === 2) return { x: t[0], y: t[1] };
  if (t === 'center') return { x: cap.viewport.width / 2, y: cap.viewport.height / 2 };
  const b = resolveBox(t, elements);
  return { x: b.x + b.w * anchor[0], y: b.y + b.h * anchor[1] };
}
