// `agentshot preview <recipe.json>`: serves the preview page (src/preview.tsx) for one recipe.
// The page polls /api/state: a changed recipe or style.json is re-read, a changed src/
// is re-bundled and the page reloads.
import fs from 'node:fs';
import path from 'node:path';
import { getBundle } from './bundle.mjs';
import { extractFrames, framesKey, probeVideo } from './video-frames.mjs';
import { resolveRecipe, serveAll } from './render.mjs';
import { CAPTURES, LIBRARY, readJson } from './util.mjs';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

export async function preview(recipeFile, { port } = {}) {
  const file = path.resolve(recipeFile);
  if (!fs.existsSync(file)) throw new Error(`recipe not found: ${file}`);
  resolveRecipe(readJson(file)); // fail now on a broken recipe rather than in the page
  let bundling = getBundle();
  const bundleDir = await bundling;

  const video = (recipe) => {
    const cap = readJson(path.join(CAPTURES, recipe.capture, 'capture.json'));
    if (recipe.shot || !cap.video) return null;
    const src = path.join(CAPTURES, recipe.capture, cap.video);
    return { src, key: framesKey(recipe.capture, src), ...probeVideo(src) };
  };

  const server = await serveAll(bundleDir, {
    '/': (req, res) => res.writeHead(302, { Location: '/preview.html' }).end(),
    '/api/state': async (req, res) => {
      // getBundle() only rebuilds when src/ changed; one build at a time
      bundling = bundling.then(() => getBundle()).catch(() => getBundle());
      const stamp = await bundling.then(() => fs.readFileSync(path.join(bundleDir, '..', 'bundle.stamp'), 'utf8')).catch(() => '');
      let recipe = mtime(file);
      try {
        const r = readJson(file);
        recipe += mtime(path.join(LIBRARY, r.product ?? 'default', 'style.json'));
      } catch {}
      json(res, 200, { recipe, bundle: stamp, file });
    },
    '/api/recipe': (req, res) => {
      try {
        const recipe = resolveRecipe(readJson(file));
        const v = video(recipe);
        json(res, 200, { recipe: { ...recipe, assetBase: '/public/' }, video: v && { key: v.key, times: v.times } });
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    },
    '/api/extract': (req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const v = video(resolveRecipe(readJson(file)));
          if (v) extractFrames(v.src, v.key, JSON.parse(body).indices);
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 400, { error: e.message });
        }
      });
    },
  }, port ? Number(port) : 0);
  return { url: `${server.base}preview.html`, close: server.close };
}
