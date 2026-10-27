// Bundles src/ (the React scene, the render page and the preview page) with esbuild into
// .cache/bundle. Rebuilt only when src/, this file or the dependencies change.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';

const CACHE = path.join(ROOT, '.cache');
export const BUNDLE = path.join(CACHE, 'bundle');

const page = (title, script) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${script}.css">
<!-- border-box everywhere, as under Remotion: the scene's outlines and frames are sized for it -->
<style>* { box-sizing: border-box; } html, body { margin: 0; padding: 0; } #root { position: relative; overflow: hidden; }</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="${script}.js"></script>
</body>
</html>
`;

// @fontsource-variable names its families "Inter Variable" etc.; recipes say "Inter".
const plainFontNames = {
  name: 'plain-font-names',
  setup(build) {
    build.onLoad({ filter: /[\\/]@fontsource(-variable)?[\\/].*\.css$/ }, async (args) => ({
      contents: (await fs.promises.readFile(args.path, 'utf8')).replace(/font-family: '(.+?) Variable'/g, "font-family: '$1'"),
      loader: 'css',
    }));
  },
};

export const buildOptions = (outdir) => ({
  entryPoints: { index: path.join(ROOT, 'src', 'index.tsx'), preview: path.join(ROOT, 'src', 'preview.tsx') },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  jsx: 'automatic',
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: 'linked',
  logLevel: 'silent',
  plugins: [plainFontNames],
});

export function writePages(outdir) {
  fs.writeFileSync(path.join(outdir, 'index.html'), page('agentshot render', 'index'));
  fs.writeFileSync(path.join(outdir, 'preview.html'), page('agentshot preview', 'preview'));
}

function newestMtime(dir) {
  let max = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    max = Math.max(max, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

export async function getBundle() {
  const stampFile = path.join(CACHE, 'bundle.stamp');
  const stamp = String(
    Math.max(
      newestMtime(path.join(ROOT, 'src')),
      fs.statSync(path.join(ROOT, 'package-lock.json')).mtimeMs,
      fs.statSync(new URL(import.meta.url)).mtimeMs,
    ),
  );
  if (fs.existsSync(path.join(BUNDLE, 'index.js')) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) {
    return BUNDLE;
  }
  await esbuild.build(buildOptions(BUNDLE));
  writePages(BUNDLE);
  fs.writeFileSync(stampFile, stamp);
  return BUNDLE;
}
