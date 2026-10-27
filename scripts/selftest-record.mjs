// Self-test for screen recording: opens the demo app in a real Chrome window, records it
// with `agentshot record` while Playwright clicks through the filter, then prints the result.
// Usage: node scripts/selftest-record.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1280,860', '--window-position=80,60'] });
const page = await browser.newPage({ viewport: null });
await page.goto(pathToFileURL(path.join(root, 'demo-app', 'desktop.html')).href);
await page.waitForTimeout(800);

// --detached exercises `record start` / `record stop` instead of `record --duration`.
const detached = process.argv.includes('--detached');
const shot = (...args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, 'bin', 'agentshot.mjs'), ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(out.trim()));
  });

const name = detached ? 'selftest-record-detached' : 'selftest-record';
const recording = detached
  ? shot('record', 'start', '--name', name, '--window', 'Daybook')
  : shot('record', '--name', name, '--window', 'Daybook', '--duration', '5');
if (detached) console.log(await recording);
await page.waitForTimeout(1500);
await page.click('[data-shot="filter"]');
await page.waitForTimeout(900);
await page.click('[data-shot="opt-family"]');
await page.waitForTimeout(900);
await page.click('[data-shot="opt-errands"]');
console.log(detached ? await shot('record', 'stop') : await recording);
await browser.close();
