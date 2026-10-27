// Render page. lib/render.mjs drives it from Node through window.shot: load a recipe, then
// for each frame call frame(n) and screenshot once it resolves.
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { loadCapture, metadata } from './composition';
import { Scene } from './Scene';
import { videoFrameAt, timeMap } from './lib/timeline';
import type { Capture, Recipe } from './lib/types';
import { FrameProvider, frameReady, type VideoConfig } from './runtime';

const el = document.getElementById('root')!;
// React reports render errors (unknown target, bad recipe) here instead of throwing them
let renderError: unknown = null;
const root = createRoot(el, { onUncaughtError: (e) => (renderError = e) });
let current: { recipe: Recipe; cap: Capture; config: VideoConfig } | null = null;

async function frame(n: number): Promise<void> {
  if (!current) throw new Error('call load() first');
  const { recipe, cap, config } = current;
  flushSync(() =>
    root.render(
      <FrameProvider frame={n} config={config}>
        <Scene {...recipe} cap={cap} />
      </FrameProvider>,
    ),
  );
  if (renderError) {
    const e = renderError;
    renderError = null;
    throw e;
  }
  const broken = await frameReady();
  if (broken.length) throw new Error(`could not load ${broken.join(', ')}`);
}

declare global {
  interface Window {
    shot: typeof api;
  }
}

const api = {
  // Sizes the page to the canvas and renders frame 0.
  async load(recipe: Recipe): Promise<VideoConfig> {
    const cap = await loadCapture(recipe);
    const config = metadata(recipe, cap);
    el.style.width = `${config.width}px`;
    el.style.height = `${config.height}px`;
    current = { recipe, cap, config };
    await frame(0);
    return config;
  },
  frame,
  // Source-video frames a video recipe needs, so the renderer extracts only those.
  async videoFrames(recipe: Recipe, video: { times: number[] }): Promise<number[]> {
    const cap = await loadCapture(recipe);
    const { fps, durationInFrames } = metadata(recipe, cap);
    const map = timeMap(recipe, cap);
    const need = new Set<number>();
    for (let f = 0; f < durationInFrames; f++) need.add(videoFrameAt(map, f, fps, video));
    return [...need].sort((a, b) => a - b);
  },
};
window.shot = api;
