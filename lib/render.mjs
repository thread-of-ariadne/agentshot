// Renders recipes into the library: library/<product>/<asset>/v001.png|mp4 plus v001.json
// (the recipe exactly as rendered and who/why), and latest.png|mp4.
//
// The scene (src/) runs in headless Chrome. For every frame Node sets the frame, waits until
// images, fonts and video frames are ready, and screenshots it; video frames go losslessly
// (PNG) to ffmpeg. Several pages render frames in parallel.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { getBundle } from './bundle.mjs';
import { FRAMES, extractFrames, framesKey, probeVideo } from './video-frames.mjs';
import { serveDir } from './serve.mjs';
import { CAPTURES, LIBRARY, ROOT, deepMerge, readJson, slug, writeJson } from './util.mjs';

export const SIZES = {
  '16:9': [1920, 1080],
  '16:10': [2400, 1500],
  '4:3': [2000, 1500],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
  '3:2': [2400, 1600],
};

export function productStyle(product) {
  const p = path.join(LIBRARY, product, 'style.json');
  return fs.existsSync(p) ? readJson(p) : {};
}

// Style defaults < recipe; size presets expand to width/height.
export function resolveRecipe(recipe) {
  const product = recipe.product ?? 'default';
  const style = productStyle(product);
  const merged = deepMerge(style.defaults ?? {}, recipe);
  merged.product = product;
  if (!merged.name) throw new Error('recipe needs a "name"');
  if (!merged.capture) throw new Error('recipe needs a "capture"');
  if (!merged.width || !merged.height) {
    const [w, h] = SIZES[merged.size ?? (merged.shot ? '16:10' : '16:9')] ?? [];
    if (!w) throw new Error(`unknown size "${merged.size}". Use one of ${Object.keys(SIZES).join(', ')} or width/height`);
    merged.width ??= w;
    merged.height ??= h;
  }
  const capFile = path.join(CAPTURES, merged.capture, 'capture.json');
  if (!fs.existsSync(capFile)) throw new Error(`capture "${merged.capture}" not found (expected ${capFile})`);
  const cap = readJson(capFile);
  if (merged.shot && !cap.shots[merged.shot]) {
    throw new Error(`capture "${merged.capture}" has no shot "${merged.shot}". Shots: ${Object.keys(cap.shots).join(', ') || 'none'}`);
  }
  return merged;
}

export function assetDir(product, name) {
  return path.join(LIBRARY, slug(product), slug(name));
}

function nextVersion(dir) {
  if (!fs.existsSync(dir)) return 1;
  const nums = fs
    .readdirSync(dir)
    .map((f) => /^v(\d+)\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// Flags Remotion rendered with that matter for pixels: sRGB output whatever the monitor
// profile, no scrollbars, no throttling of background pages.
const CHROME_ARGS = [
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

// Installed Google Chrome; AGENTSHOT_CHROME points at another Chrome/Chromium binary.
// `scale` is the device scale of every page: Chrome renders natively at it (as Remotion did),
// which places scaled images differently from viewport emulation alone.
export const launchChrome = (scale = 1) =>
  chromium.launch({
    ...(process.env.AGENTSHOT_CHROME ? { executablePath: process.env.AGENTSHOT_CHROME } : { channel: 'chrome' }),
    headless: true,
    args: [...CHROME_ARGS, `--force-device-scale-factor=${scale}`],
  });

// Mounts the bundle, public/ and the video-frame cache on one local origin.
export const serveAll = (bundleDir, routes, port) =>
  serveDir({ '/': bundleDir, '/public/': path.join(ROOT, 'public'), '/frames/': FRAMES }, routes, port);

const concurrency = () => Math.max(1, Number(process.env.AGENTSHOT_CONCURRENCY) || Math.min(8, Math.floor(os.cpus().length / 2)));

// Adds `videoFrames` for captures with a video, extracting the frames the recipe shows.
export async function withVideoFrames(page, props, base) {
  const cap = readJson(path.join(CAPTURES, props.capture, 'capture.json'));
  if (props.shot || !cap.video) return props;
  const file = path.join(CAPTURES, props.capture, cap.video);
  const video = probeVideo(file);
  const key = framesKey(props.capture, file);
  const need = await page.evaluate(([r, v]) => window.shot.videoFrames(r, v), [props, video]);
  extractFrames(file, key, need);
  return { ...props, videoFrames: { base: `${base}frames/${key}/`, ...video } };
}

async function openPage(browser, base, props, scale) {
  const context = await browser.newContext({ viewport: { width: props.width, height: props.height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}index.html`);
  await page.waitForFunction(() => window.shot);
  const call = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      // keep the scene's own message (unknown target, missing file), not Playwright's wrapper
      const msg = /Error: (.*)/.exec(String(e?.message ?? e))?.[1] ?? String(e);
      throw new Error(errors.length ? `${msg} (${errors[errors.length - 1]})` : msg);
    }
  };
  return { page, context, call };
}

async function renderStill(browser, base, props, output, scale) {
  const p = await openPage(browser, base, props, scale);
  try {
    await p.call(() => p.page.evaluate((r) => window.shot.load(r), props));
    // Playwright's own screenshot keeps the device-scale emulation (a raw CDP capture would not)
    await p.page.screenshot({ path: output, type: 'png', scale: 'device', animations: 'allow', caret: 'initial' });
  } finally {
    await p.context.close();
  }
}

async function renderVideo(browser, base, props, output, onProgress) {
  const first = await openPage(browser, base, props, 1);
  const pages = [first];
  let ffmpeg;
  try {
    props = await first.call(() => withVideoFrames(first.page, props, base));
    const config = await first.call(() => first.page.evaluate((r) => window.shot.load(r), props));
    const total = config.durationInFrames;
    // one page per ~half second of video, up to the CPU budget
    const n = Math.min(concurrency(), Math.max(1, Math.ceil(total / 30)));
    for (let i = 1; i < n; i++) pages.push(await openPage(browser, base, props, 1));
    await Promise.all(pages.slice(1).map((p) => p.call(() => p.page.evaluate((r) => window.shot.load(r), props))));

    // Standard HD video: limited range BT.709, tagged, converted the way Remotion did
    // (zscale). Remotion's own default was full-range BT.601 that players show washed out.
    ffmpeg = spawn(
      'ffmpeg',
      [
        ...['-hide_banner', '-v', 'error', '-y'],
        ...['-f', 'image2pipe', '-framerate', String(config.fps), '-c:v', 'png', '-i', 'pipe:0'],
        ...['-c:v', 'libx264', '-preset', 'medium', '-crf', String(props.crf ?? 16)],
        ...['-colorspace:v', 'bt709', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-color_range', 'tv'],
        ...['-vf', 'zscale=matrix=709:range=limited:primariesin=709:primaries=709:transferin=709:transfer=709'],
        ...['-pix_fmt', 'yuv420p', '-movflags', '+faststart', output],
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ffmpeg.stderr.on('data', (d) => (stderr += d));
    // a write after ffmpeg exits (it failed, or the render was aborted) is reported by its exit code
    ffmpeg.stdin.on('error', () => {});
    let failed = null;
    let wake = () => {};
    const exited = new Promise((resolve) =>
      ffmpeg.on('close', (code) => {
        if (code !== 0) failed ??= new Error(`ffmpeg failed: ${stderr}`);
        wake();
        resolve(code);
      }),
    );

    // Pages take the next frame as they free up; frames reach ffmpeg in order. A page waits
    // when it is too far ahead of the encoder so finished frames do not pile up in memory.
    let next = 0;
    let written = 0;
    let encoded = 0;
    const finished = new Map();
    const progressed = () => new Promise((r) => (wake = r));
    const flush = () => {
      while (finished.has(written)) {
        const buf = finished.get(written);
        finished.delete(written);
        written++;
        ffmpeg.stdin.write(buf, () => {
          encoded++;
          onProgress?.(encoded / total);
          wake();
        });
      }
    };
    await Promise.all(
      pages.map(async (p) => {
        const cdp = await p.context.newCDPSession(p.page);
        for (;;) {
          if (failed) return;
          const f = next++;
          if (f >= total) return;
          while (f - encoded > 4 * pages.length && !failed) await progressed();
          await p.call(() => p.page.evaluate((i) => window.shot.frame(i), f));
          // CDP directly: at device scale 1 it matches page.screenshot and is faster
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
          finished.set(f, Buffer.from(data, 'base64'));
          flush();
        }
      }),
    );
    if (failed) throw failed;
    ffmpeg.stdin.end();
    await exited;
    if (failed) throw failed;
  } finally {
    if (ffmpeg && ffmpeg.exitCode === null) ffmpeg.kill();
    await Promise.all(pages.map((p) => p.context.close()));
  }
}

export async function renderRecipes(recipes, { note, by, copyTo, onProgress } = {}) {
  const bundleDir = await getBundle();
  const server = await serveAll(bundleDir);
  const browsers = new Map();
  const browserAt = async (scale) => {
    if (!browsers.has(scale)) browsers.set(scale, await launchChrome(scale));
    return browsers.get(scale);
  };
  const results = [];
  try {
    for (const original of recipes) {
      const recipe = resolveRecipe(original);
      const props = { ...recipe, assetBase: `${server.base}public/` };
      const started = Date.now();
      const dir = assetDir(recipe.product, recipe.name);
      fs.mkdirSync(dir, { recursive: true });
      const version = nextVersion(dir);
      const v = `v${String(version).padStart(3, '0')}`;
      const ext = recipe.shot ? 'png' : 'mp4';
      const output = path.join(dir, `${v}.${ext}`);
      try {
        if (recipe.shot) {
          // stills under 2000 px wide render at 2x
          const scale = recipe.renderScale ?? (recipe.width < 2000 ? 2 : 1);
          await renderStill(await browserAt(scale), server.base, props, output, scale);
        } else {
          await renderVideo(await browserAt(1), server.base, props, output, onProgress && ((p) => onProgress(recipe.name, p)));
        }
      } catch (e) {
        fs.rmSync(output, { force: true }); // no half-written version in the library
        throw e;
      }
      fs.copyFileSync(output, path.join(dir, `latest.${ext}`));
      writeJson(path.join(dir, `${v}.json`), {
        version,
        createdAt: new Date().toISOString(),
        by: by ?? process.env.AGENTSHOT_AGENT ?? 'agent',
        note: note ?? original.note ?? '',
        output: path.basename(output),
        recipe: original,
      });
      let copied;
      if (copyTo) {
        copied = path.resolve(copyTo.endsWith(`.${ext}`) ? copyTo : path.join(copyTo, `${slug(recipe.name)}.${ext}`));
        fs.mkdirSync(path.dirname(copied), { recursive: true });
        fs.copyFileSync(output, copied);
      }
      results.push({
        product: recipe.product,
        name: recipe.name,
        version,
        output,
        copiedTo: copied,
        width: recipe.width,
        height: recipe.height,
        seconds: (Date.now() - started) / 1000,
      });
    }
  } finally {
    await Promise.all([...browsers.values()].map((b) => b.close()));
    server.close();
  }
  return results;
}

export function history(product, name) {
  const dir = assetDir(product, name);
  if (!fs.existsSync(dir)) throw new Error(`no asset ${product}/${name}`);
  return fs
    .readdirSync(dir)
    .filter((f) => /^v\d+\.json$/.test(f))
    .sort()
    .map((f) => readJson(path.join(dir, f)));
}
