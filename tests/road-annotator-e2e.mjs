import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';

const target = process.argv[2] ?? 'http://127.0.0.1:4193/';
let browser;
try {
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto(target, { waitUntil: 'networkidle' });
  const task = await page.evaluate(() => fetch('/api/task').then(response => response.json()));
  const result = {
    title: await page.title(),
    predictionBlind: task.predictionBlind,
    taskKeys: Object.keys(task).sort(),
    frames: await page.locator('#frame-strip button').count(),
    canvas: await page.locator('#annotation-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height })),
    badge: await page.locator('.badge.blind').textContent(),
    progress: await page.locator('#shape-count').textContent(),
    browserErrors,
  };
  if (result.title !== 'Road Ground Truth Workbench') throw Error(`Sai title: ${result.title}`);
  if (result.predictionBlind !== true) throw Error('Task không blind');
  if (result.taskKeys.some(key => key.toLowerCase().includes('prediction'))) {
    const allowed = result.taskKeys.filter(key => key.toLowerCase().includes('prediction'));
    if (allowed.length !== 1 || allowed[0] !== 'predictionBlind') throw Error(`Prediction leak: ${allowed.join(',')}`);
  }
  if (result.frames !== 4) throw Error(`Sai số frame: ${result.frames}`);
  if (result.canvas.width !== 1280 || result.canvas.height !== 720) throw Error(`Sai canvas: ${JSON.stringify(result.canvas)}`);
  if (!result.progress?.includes('tiến độ V')) throw Error(`Thiếu tiến độ gán nhãn: ${result.progress}`);
  if (result.browserErrors.length) throw Error(`Browser errors: ${result.browserErrors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser?.close();
}
