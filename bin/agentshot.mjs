#!/usr/bin/env node
// shot: agent-driven screenshots and demo videos. Every command prints one JSON line.
import fs from 'node:fs';
import path from 'node:path';
import { CAPTURES, LIBRARY, ROOT, done, fail, parseArgs, readJson, slug, writeJson } from '../lib/util.mjs';

const HELP = `agentshot <command> [args]   (prints one JSON result line)

Capture
  capture <scenario.json> [--headed]     run a scenario: "url" = browser (web app / Expo web),
                                         "window" = desktop app (real mouse/keyboard, recorded),
                                         "simulator" = iOS Simulator (macOS)
  snap --window "<title|process>" --name <capture> [--shot main]
                                         still of a desktop window right now
  snap <capture> --at <sec> [--shot <name>]   still cut from a capture's video
  sim devices | sim snap --name <capture> [--device <name|udid>] [--clean-status-bar]
  sim record start --name <capture> | sim record stop
                                         iOS Simulator (macOS): lossless stills and video of the native
                                         app; a scenario with "simulator" taps/swipes/types via idb
  import <file> --name <capture> [--device iphone|desktop] [--scale 3]
                                         bring in a screenshot or screen recording
  record start --name <capture> (--window "<title part>" | --screen <n>) [--fps 30] [--show-cursor]
                                         (--show-cursor burns the real cursor in: for sync checks)
  record stop                            finish the running recording
  record --name <capture> --window "<title>" --duration <sec>   record for N seconds
  windows                                list visible windows to record
  inspect <capture>                      shots, elements, clicks, timeline, and for videos:
                                         pointer moves, visual changes, quiet stretches
  frames <capture|product/asset[@v]|file> [--from s] [--to s] [--every s] [--crop x,y,w,h]
         [--cols n] [--width px] [--at s] [--out file]
                                         contact sheet with timestamps (or one frame with --at)
  captures                               list captures

Render & library
  render <recipe.json>... [--note "..."] [--by <agent>] [--copy-to <dir|file>]
  preview <recipe.json> [--port <n>] [--no-open]
                                         live preview with a scrubber; reloads on edits
  list [product]                         assets in the library with their latest version
  history <product> <asset>              every version with its note
  restore <product> <asset> <version>    re-render an old version as a new one
  style <product> [--init]               show (or create) a product's style.json and guidelines.md
  gallery [--open]                       build library/index.html

Other
  doctor [--request]                     check tools and (macOS) permissions; --request asks for them
`;

const { pos, opt } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();

try {
  switch (cmd) {
    case 'capture': {
      if (!pos[0]) fail('usage: agentshot capture <scenario.json>');
      const sc = readJson(pos[0]);
      if (sc.simulator) {
        const { runSim } = await import('../lib/sim.mjs');
        done(await runSim(sc));
      } else if (sc.window && !sc.url) {
        const { runDesktop } = await import('../lib/desktop.mjs');
        done(await runDesktop(sc));
      } else {
        const { runScenario } = await import('../lib/capture.mjs');
        done(await runScenario(sc, { headed: !!opt.headed }));
      }
      break;
    }
    case 'snap': {
      const d = await import('../lib/desktop.mjs');
      if (opt.window) done(d.snapWindow({ window: opt.window, name: opt.name, shot: opt.shot }));
      else if (pos[0] && opt.at !== undefined) done(d.snapFromCapture(pos[0], opt.at, opt.shot));
      else fail('usage: agentshot snap --window "Title" --name <capture> [--shot main], or agentshot snap <capture> --at <sec> [--shot name]');
      break;
    }
    case 'sim': {
      if (process.platform !== 'darwin') fail('the iOS Simulator needs macOS');
      const sim = await import('../lib/sim.mjs');
      const sub = pos[0];
      if (sub === 'devices') done({ devices: sim.devices() });
      else if (sub === 'snap') done(sim.snapSim({ name: opt.name, device: opt.device, shot: opt.shot, cleanBar: !!opt['clean-status-bar'] }));
      else if (sub === 'record' && pos[1] === 'start') done(await sim.recordStart({ name: opt.name, device: opt.device, fps: opt.fps }));
      else if (sub === 'record' && pos[1] === 'stop') done(await sim.recordStop());
      else fail('usage: agentshot sim devices | snap --name x [--device d] [--clean-status-bar] | record start --name x | record stop');
      break;
    }
    case 'frames': {
      if (!pos[0]) fail('usage: agentshot frames <capture|product/asset[@v]|file.mp4> [--from] [--to] [--every] [--crop x,y,w,h] [--at]');
      const { frames } = await import('../lib/frames.mjs');
      done(frames(pos[0], opt));
      break;
    }
    case 'import': {
      const { importFile } = await import('../lib/import.mjs');
      done(importFile(pos[0], { name: opt.name, device: opt.device, scale: opt.scale }));
      break;
    }
    case 'record': {
      const rec = await import('../lib/record.mjs');
      const sub = pos[0];
      if (sub === 'start') done(await rec.start(opt));
      else if (sub === 'stop') done(await rec.stop());
      else if (sub === 'status') done(rec.status());
      else if (opt.duration) done(await rec.recordFor(opt));
      else fail('usage: agentshot record start|stop|status, or agentshot record --name x --window "Title" --duration 10');
      break;
    }
    case 'windows': {
      const rec = await import('../lib/record.mjs');
      done({ windows: rec.listWindows(), screens: rec.listScreens() });
      break;
    }
    case 'inspect': {
      const f = path.join(CAPTURES, pos[0] ?? '', 'capture.json');
      if (!fs.existsSync(f)) fail(`no capture "${pos[0]}"`);
      const c = readJson(f);
      const { activity } = await import('../lib/frames.mjs');
      done({
        name: c.name,
        source: c.source,
        device: c.device,
        viewport: c.viewport,
        scale: c.scale ?? 1,
        duration: c.duration,
        video: !!c.video,
        frames: c.frames.length,
        shots: Object.fromEntries(Object.entries(c.shots).map(([k, v]) => [k, { file: path.join(CAPTURES, c.name, v.file), elements: v.elements }])),
        elements: c.elements,
        clicks: c.clicks,
        ...(c.timeline ? { timeline: c.timeline } : {}),
        ...(c.pointer?.length || c.video ? activity(c, path.dirname(f)) : {}),
      });
      break;
    }
    case 'captures': {
      const list = fs.existsSync(CAPTURES)
        ? fs
            .readdirSync(CAPTURES)
            .filter((d) => fs.existsSync(path.join(CAPTURES, d, 'capture.json')))
            .map((d) => {
              const c = readJson(path.join(CAPTURES, d, 'capture.json'));
              return { name: d, source: c.source, device: c.device, duration: c.duration, shots: Object.keys(c.shots), video: !!c.video };
            })
        : [];
      done({ captures: list });
      break;
    }
    case 'render': {
      if (!pos.length) fail('usage: agentshot render <recipe.json>...');
      const { renderRecipes } = await import('../lib/render.mjs');
      const recipes = pos.map((p) => readJson(p));
      let last = 0;
      const results = await renderRecipes(recipes, {
        note: opt.note,
        by: opt.by,
        copyTo: opt['copy-to'],
        onProgress: (name, p) => {
          if (p - last >= 0.25 || p === 1) {
            last = p;
            process.stderr.write(`render ${name} ${Math.round(p * 100)}%\n`);
          }
        },
      });
      const { buildGallery } = await import('../lib/gallery.mjs');
      buildGallery();
      done({ results });
      break;
    }
    case 'preview': {
      if (!pos[0]) fail('usage: agentshot preview <recipe.json>');
      const { preview } = await import('../lib/preview.mjs');
      const { url } = await preview(pos[0], { port: opt.port });
      if (!opt['no-open']) (await import('../lib/platform/index.mjs')).os.open(url);
      // keeps serving until stopped (Ctrl+C)
      done({ url, recipe: path.resolve(pos[0]) });
      break;
    }
    case 'list': {
      const products = fs.existsSync(LIBRARY) ? fs.readdirSync(LIBRARY).filter((d) => fs.statSync(path.join(LIBRARY, d)).isDirectory()) : [];
      const out = [];
      for (const p of pos[0] ? [slug(pos[0])] : products) {
        const dir = path.join(LIBRARY, p);
        if (!fs.existsSync(dir)) continue;
        for (const a of fs.readdirSync(dir)) {
          const ad = path.join(dir, a);
          if (!fs.statSync(ad).isDirectory()) continue;
          const versions = fs.readdirSync(ad).filter((f) => /^v\d+\.json$/.test(f)).sort();
          if (!versions.length) continue;
          const last = readJson(path.join(ad, versions[versions.length - 1]));
          out.push({ product: p, asset: a, versions: versions.length, latest: path.join(ad, last.output), updated: last.createdAt, note: last.note });
        }
      }
      done({ library: LIBRARY, assets: out });
      break;
    }
    case 'history': {
      const { history } = await import('../lib/render.mjs');
      done({ versions: history(pos[0], pos[1]).map((v) => ({ version: v.version, createdAt: v.createdAt, by: v.by, note: v.note, output: v.output })) });
      break;
    }
    case 'restore': {
      const { history, renderRecipes } = await import('../lib/render.mjs');
      const v = history(pos[0], pos[1]).find((h) => h.version === Number(pos[2]));
      if (!v) fail(`no version ${pos[2]} of ${pos[0]}/${pos[1]}`);
      const results = await renderRecipes([v.recipe], { note: opt.note ?? `restored v${v.version}`, by: opt.by });
      const { buildGallery } = await import('../lib/gallery.mjs');
      buildGallery();
      done({ results });
      break;
    }
    case 'style': {
      const p = slug(pos[0] ?? 'default');
      const dir = path.join(LIBRARY, p);
      const styleFile = path.join(dir, 'style.json');
      const guideFile = path.join(dir, 'guidelines.md');
      if (opt.init) {
        if (!fs.existsSync(styleFile)) {
          writeJson(styleFile, {
            product: pos[0],
            defaults: { background: 'lavender', accent: '#6d5ce8' },
          });
        }
        if (!fs.existsSync(guideFile)) {
          fs.writeFileSync(
            guideFile,
            `# ${pos[0]} — screenshot guidelines\n\nRead before every capture or render for this product. Add what the user likes or corrects, with the date.\n\n## Look\n- \n\n## Learned\n- \n`,
          );
        }
      }
      done({
        product: p,
        styleFile,
        guidelinesFile: guideFile,
        style: fs.existsSync(styleFile) ? readJson(styleFile) : null,
        guidelines: fs.existsSync(guideFile) ? fs.readFileSync(guideFile, 'utf8') : null,
      });
      break;
    }
    case 'gallery': {
      const { buildGallery } = await import('../lib/gallery.mjs');
      const file = buildGallery();
      if (opt.open) (await import('../lib/platform/index.mjs')).os.open(file);
      done({ gallery: file });
      break;
    }
    case 'doctor': {
      const { spawnSync } = await import('node:child_process');
      const { os } = await import('../lib/platform/index.mjs');
      const has = (c) => spawnSync(c, ['-version'], { encoding: 'utf8' }).status === 0;
      done({ root: ROOT, library: LIBRARY, ffmpeg: has('ffmpeg'), ffprobe: has('ffprobe'), node: process.version, ...os.doctor({ request: !!opt.request }) });
      break;
    }
    case undefined:
    case 'help':
    case '--help':
      process.stdout.write(HELP);
      break;
    default:
      fail(`unknown command "${cmd}"`, { help: HELP });
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
