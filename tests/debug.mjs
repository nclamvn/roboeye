// Debug: soi console + network của trang trong 100s sau khi bấm start
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const server = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'pipe'
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('localhost') && r()));

const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--enable-unsafe-webgpu',
    '--no-sandbox'
  ],
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {})
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 140), r.failure()?.errorText));
page.on('response', (r) => {
  if (!r.url().includes('localhost')) console.log('[resp]', r.status(), r.url().slice(0, 140));
});

await page.goto('http://localhost:4179/?webgl=1&wasm=1&localmodels=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.click('#start-btn');

for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(10000);
  const status = await page.textContent('#boot-status');
  const err = await page.evaluate(() => {
    const e = document.querySelector('#boot-error');
    return e && !e.hidden ? e.textContent : null;
  });
  const badge = await page.textContent('#badge-infer');
  console.log(`[t=${(i + 1) * 10}s] status="${status}" badge="${badge}" error=${err}`);
  if (err) break;
}

await browser.close();
server.kill();
