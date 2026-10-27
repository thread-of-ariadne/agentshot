// Runs a browser scenario (JSON) in headless Chrome and writes public/captures/<name>/:
// frames, still screenshots and capture.json (pointer path, clicks, element boxes)
// for the scene (src/).
//
// timing "frame" (default): the page's clock (Date, timers, requestAnimationFrame) is paused
// and advanced exactly 1/fps per frame, with a full-resolution screenshot after each tick, so
// the app's JS animations come out frame-perfect at any resolution, however slow screenshots are.
// timing "real": steps run in real time and repaints are grabbed as they come (~10-25 fps);
// for apps that misbehave under a controlled clock. timing "step": virtual time, a frame only
// after pointer steps; no app animations.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAPTURES, ROOT, sleep, writeJson } from './util.mjs';

export const DEVICES = {
  iphone: { width: 390, height: 844, scale: 3 },
  'iphone-max': { width: 430, height: 932, scale: 3 },
  ipad: { width: 820, height: 1180, scale: 2 },
  desktop: { width: 1440, height: 900, scale: 2 },
  laptop: { width: 1280, height: 800, scale: 2 },
};

const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
};

// A target is [x, y] in CSS px, a Playwright selector (css=, text=, role=, #id, .class, [attr]),
// or a bare name looked up as data-shot, then data-testid (React Native testID on web).
function locatorFor(page, to) {
  if (/^(css|text|role|xpath|id|data-testid)=/.test(to) || /^[#.\[]/.test(to) || to.includes(' ')) return page.locator(to).first();
  return page.locator(`[data-shot="${to}"], [data-testid="${to}"]`).first();
}

// waitVisible lets frame mode advance the page clock while waiting (an element that appears
// after an app timer would otherwise never show up).
async function resolveTarget(page, to, waitVisible) {
  if (Array.isArray(to)) return { x: to[0], y: to[1] };
  const loc = locatorFor(page, to);
  if (waitVisible) await waitVisible(loc, to);
  else await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error(`target not visible: ${to}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function elementBoxes(page, track = {}) {
  const named = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[data-shot], [data-testid]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out[el.dataset.shot ?? el.dataset.testid] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });
  // Tracked elements absent from the current screen are skipped at once (boundingBox would
  // otherwise wait 30 s for each while the frame grabber keeps running).
  for (const [name, sel] of Object.entries(track)) {
    const loc = locatorFor(page, sel);
    if (!(await loc.count().catch(() => 0))) continue;
    const box = await loc.boundingBox({ timeout: 1000 }).catch(() => null);
    if (box && box.width > 0) named[name] = { x: box.x, y: box.y, w: box.width, h: box.height };
  }
  return named;
}

// Safe-area insets (points) the device would report; our status bar and home indicator sit there.
const SAFE_AREA = { iphone: [54, 34], 'iphone-max': [54, 34], ipad: [24, 20] };

// Fallback for apps that ignore env(safe-area-inset-*): pad the app root like iOS does.
async function padSafeArea(page, viewport) {
  const color = await page.evaluate(([x, y]) => {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      el = el.parentElement;
    }
    return '#ffffff';
  }, [viewport.width / 2, 10]);
  await page.addStyleTag({
    content: `html, body { background: ${color} !important; }
      #root, body > div:first-child { padding-top: 54px !important; padding-bottom: 34px !important; box-sizing: border-box !important; height: 100vh !important; }`,
  });
}

export async function runScenario(sc, { headed = false } = {}) {
  const dev = DEVICES[sc.device ?? 'desktop'] ?? DEVICES.desktop;
  const viewport = sc.viewport ?? { width: dev.width, height: dev.height };
  const scale = sc.scale ?? dev.scale;
  const timing = sc.timing ?? 'frame';
  const frameMode = timing === 'frame';
  // 60 fps matches the default video rate; real-time grabbing cannot keep up with it anyway
  const fps = sc.fps ?? (frameMode ? 60 : 30);
  const outDir = path.join(CAPTURES, sc.name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const url = /^https?:/.test(sc.url) ? sc.url : pathToFileURL(path.resolve(ROOT, sc.url)).href;
  const browser = await chromium.launch({ channel: sc.browser ?? 'chrome', headless: !headed });
  const isPhone = (sc.device ?? '').startsWith('iphone');
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: scale,
    colorScheme: sc.colorScheme ?? 'light',
    userAgent: isPhone
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  // safeArea true: Chrome reports iPhone insets through env(safe-area-inset-*), so the app's own
  // SafeAreaView (react-native-safe-area-context) lays out like on a device, backgrounds full-bleed.
  const [insetTop, insetBottom] = SAFE_AREA[sc.device] ?? [0, 0];
  if (sc.safeArea === true && insetTop) {
    const s = await page.context().newCDPSession(page);
    await s.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: insetTop, topMax: insetTop, bottom: insetBottom, bottomMax: insetBottom, left: 0, leftMax: 0, right: 0, rightMax: 0 },
    });
  }
  // Console errors/warnings are reported back: they explain dev overlays and broken screens.
  const consoleMessages = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && consoleMessages.length < 20) consoleMessages.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => consoleMessages.length < 20 && consoleMessages.push(`pageerror: ${e.message.slice(0, 300)}`));
  if (frameMode) await page.clock.install();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  if (sc.safeArea === 'pad') await padSafeArea(page, viewport);
  // Dev-build overlays (Expo LogBox toast, Next.js dev indicator) never belong in a shot.
  if (!sc.devOverlays) await page.addStyleTag({ content: '#error-toast, nextjs-portal { display: none !important; }' });
  if (sc.css) await page.addStyleTag({ content: sc.css });
  if (sc.waitFor) await locatorFor(page, sc.waitFor).waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(sc.settle ?? 400);

  const frames = [];
  const pointerLog = [];
  const clicks = [];
  const shots = {};
  const writes = [];
  let pointer = sc.pointerStart ? { x: sc.pointerStart[0], y: sc.pointerStart[1] } : { x: viewport.width * 0.82, y: viewport.height + 40 };
  let pressed = false;
  let frameNo = 0;

  // Clock: real seconds since start, or virtual seconds in frame/step mode.
  let vt = 0;
  const t0 = Date.now();
  const now = () => (timing === 'real' ? (Date.now() - t0) / 1000 : vt);
  const log = () => pointerLog.push({ t: +now().toFixed(4), x: +pointer.x.toFixed(1), y: +pointer.y.toFixed(1), down: pressed });

  let lastFrame = null;
  async function grab() {
    const buf = await page.screenshot({ type: 'jpeg', quality: 92, animations: 'allow', caret: 'initial' });
    if (lastFrame && buf.equals(lastFrame)) return; // unchanged: the previous frame holds
    lastFrame = buf;
    const file = `f${String(frameNo++).padStart(5, '0')}.jpg`;
    frames.push({ t: +vt.toFixed(4), file });
    writes.push(fs.promises.writeFile(path.join(outDir, file), buf));
  }
  // frame mode: one video frame of app time, then a screenshot
  async function tick() {
    await page.clock.runFor(1000 / fps);
    vt += 1 / fps;
    await grab();
  }
  const advance = async (sec) => {
    if (timing === 'real') await sleep(sec * 1000);
    else if (frameMode) for (let i = Math.round(sec * fps); i > 0; i--) await tick();
    else vt += sec;
  };
  // after an instant action (click, key, navigation): let it render
  async function stepFrame() {
    if (timing === 'real') return;
    if (frameMode) return tick();
    await grab();
  }
  const waitVisible = frameMode
    ? async (loc, what) => {
        for (let i = 0; i < 10 * fps; i++) {
          if (await loc.isVisible().catch(() => false)) return;
          await tick();
        }
        throw new Error(`target not visible after 10 s: ${what}`);
      }
    : null;

  if (frameMode) await page.clock.pauseAt(Date.now() + 50);

  // Real-time mode: Chrome's screencast only reports that something repainted (its frames
  // are at 1x even on a 2x/3x viewport), and each repaint is grabbed as a full-resolution
  // screenshot. Idle periods cost nothing; busy ones run at ~25 fps on a 2x phone, ~11 fps
  // on a 2x desktop (the cursor is drawn separately at the video's frame rate).
  let cdp = null;
  let grabbing = null;
  let dirty = true;
  let lastData = null;
  let running = timing === 'real';
  if (running) {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ sessionId }) => {
      dirty = true;
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 320, maxHeight: 320 });
    grabbing = (async () => {
      while (running || dirty) {
        if (!dirty) {
          await sleep(4);
          continue;
        }
        dirty = false;
        const t = now();
        // Playwright's own screenshot keeps the device-scale emulation intact; a raw CDP
        // captureScreenshot from another session briefly drops it and misroutes clicks.
        const buf = await page.screenshot({ type: 'jpeg', quality: 92, animations: 'allow', caret: 'initial' }).catch(() => null);
        // Grabbing can itself trigger a repaint; identical frames are dropped.
        if (!buf || (lastData && buf.equals(lastData))) continue;
        lastData = buf;
        const file = `f${String(frameNo++).padStart(5, '0')}.jpg`;
        frames.push({ t: +t.toFixed(4), file });
        writes.push(fs.promises.writeFile(path.join(outDir, file), buf));
        if (!running) break;
      }
    })();
  }

  async function moveTo(to, duration, easing = 'inOut', frameEach = false) {
    const from = { ...pointer };
    const target = await resolveTarget(page, to, waitVisible);
    const n = Math.max(1, Math.round(duration * fps));
    const start = now();
    for (let i = 1; i <= n; i++) {
      const k = ease[easing](i / n);
      pointer = { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k };
      await page.mouse.move(pointer.x, pointer.y);
      if (timing === 'real') {
        const wait = start + (i / fps) - now();
        if (wait > 0) await sleep(wait * 1000);
      } else if (frameMode) await tick();
      else vt += 1 / fps;
      log();
      if (timing === 'step' && (frameEach || pressed)) await grab();
    }
  }

  if (timing !== 'real') await grab();
  log();

  for (const s of sc.steps ?? []) {
    if (s.wait != null) {
      await advance(s.wait);
      log();
    } else if (s.move != null) {
      await moveTo(s.move, s.duration ?? 0.8, s.ease, !!s.hover);
    } else if (s.down) {
      await page.mouse.move(pointer.x, pointer.y);
      await page.mouse.down();
      pressed = true;
      clicks.push({ t: +now().toFixed(4), x: pointer.x, y: pointer.y, kind: 'down' });
      log();
      await stepFrame();
    } else if (s.up) {
      await page.mouse.up();
      pressed = false;
      log();
      await stepFrame();
    } else if (s.click != null || s.tap != null) {
      const to = s.click ?? s.tap;
      if (to !== true) await moveTo(to, s.duration ?? 0.7);
      await page.mouse.down();
      pressed = true;
      clicks.push({ t: +now().toFixed(4), x: pointer.x, y: pointer.y, kind: 'click' });
      log();
      await advance(s.tap != null ? 0.12 : 0.06);
      await page.mouse.up();
      pressed = false;
      log();
      if (timing === 'step') await page.waitForTimeout(60);
      await stepFrame();
    } else if (s.drag != null) {
      await moveTo(s.drag, s.reach ?? 0.6);
      await page.mouse.down();
      pressed = true;
      clicks.push({ t: +now().toFixed(4), x: pointer.x, y: pointer.y, kind: 'down' });
      log();
      await advance(s.hold ?? 0.3);
      await moveTo(s.to, s.duration ?? 1.2);
      await advance(0.2);
      await page.mouse.up();
      pressed = false;
      log();
      await stepFrame();
    } else if (s.type != null) {
      if (s.into) {
        await moveTo(s.into, s.duration ?? 0.6);
        await page.mouse.click(pointer.x, pointer.y);
        clicks.push({ t: +now().toFixed(4), x: pointer.x, y: pointer.y, kind: 'click' });
        // A sticky footer or overlay can cover the field's centre; make sure it has focus.
        const field = locatorFor(page, s.into);
        if (!(await field.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false))) {
          await field.focus().catch(() => {});
        }
      }
      for (const ch of String(s.type)) {
        await page.keyboard.type(ch);
        await advance(s.delay ?? 0.06);
        if (timing === 'step') await grab();
      }
      log();
    } else if (s.press != null) {
      await page.keyboard.press(s.press);
      await stepFrame();
    } else if (s.scroll != null) {
      // Smooth wheel scroll spread over the duration.
      const n = Math.max(1, Math.round((s.duration ?? 0.8) * fps));
      let done = 0;
      for (let i = 1; i <= n; i++) {
        const target = s.scroll * ease.inOut(i / n);
        await page.mouse.wheel(0, target - done);
        done = target;
        await advance(1 / fps);
        if (timing === 'step') await grab();
      }
      log();
    } else if (s.goto != null) {
      await page.goto(/^https?:/.test(s.goto) ? s.goto : new URL(s.goto, page.url()).href, { waitUntil: 'networkidle' });
      if (sc.safeArea === 'pad') await padSafeArea(page, viewport);
      if (frameMode) await page.clock.pauseAt(Date.now() + 50).catch(() => {});
      await stepFrame();
    } else if (s.waitFor != null) {
      const loc = locatorFor(page, s.waitFor);
      if (waitVisible) await waitVisible(loc, s.waitFor);
      else await loc.waitFor({ state: 'visible', timeout: 15000 });
    } else if (s.shot != null) {
      const file = `${s.shot}.png`;
      await page.screenshot({ path: path.join(outDir, file), type: 'png' });
      shots[s.shot] = { file, elements: await elementBoxes(page, sc.track) };
    } else {
      throw new Error(`unknown step: ${JSON.stringify(s)}`);
    }
  }

  if (cdp) {
    await page.waitForTimeout(150);
    running = false;
    await grabbing;
    await cdp.send('Page.stopScreencast');
  }
  await Promise.all(writes);
  frames.sort((a, b) => a.t - b.t);

  const capture = {
    name: sc.name,
    source: 'browser',
    device: (sc.device ?? 'desktop').startsWith('iphone') ? 'iphone' : 'desktop',
    viewport,
    scale,
    fps,
    duration: +now().toFixed(4),
    frames,
    pointer: pointerLog,
    clicks,
    shots,
    elements: await elementBoxes(page, sc.track),
  };
  writeJson(path.join(outDir, 'capture.json'), capture);
  await browser.close();
  return {
    name: sc.name,
    frames: frames.length,
    shots: Object.keys(shots),
    duration: capture.duration,
    elements: Object.keys(capture.elements),
    clicks: clicks.map((c) => +c.t.toFixed(2)),
    console: consoleMessages,
    dir: outDir,
  };
}
