// Canvas size, frame rate and length of a recipe (what Remotion's calculateMetadata did).
import { asset } from './components/Source';
import { timeMap } from './lib/timeline';
import type { Capture, Recipe } from './lib/types';
import type { VideoConfig } from './runtime';

export async function loadCapture(recipe: Recipe): Promise<Capture> {
  const url = asset(recipe.assetBase, `captures/${recipe.capture}/capture.json`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`capture "${recipe.capture}" not found (${url})`);
  return res.json();
}

export function metadata(recipe: Recipe, cap: Capture): VideoConfig {
  // videos default to 60 fps so cursor, zooms and app animations move smoothly
  const fps = recipe.fps ?? (recipe.shot ? 30 : 60);
  const seconds = recipe.shot ? 1 / fps : timeMap(recipe, cap).duration + (recipe.tail ?? 0);
  return { width: recipe.width, height: recipe.height, fps, durationInFrames: Math.max(1, Math.ceil(seconds * fps)) };
}
