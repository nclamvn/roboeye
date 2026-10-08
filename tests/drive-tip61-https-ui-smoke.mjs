import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {browserLaunchOptions, resolveBrowserExecutable} from './helpers/browser.mjs';

// Desktop Chromium at a phone-sized viewport; no real camera or user clip read.
// Deliberately not an iPhone/Chrome-on-iOS performance or accuracy acceptance test.
const url = process.argv[2] ?? 'https://roboeye-drivesense.vercel.app/drive.html?v=tip61-8f1650d04912';
const out = resolve(process.env.ROBOEYE_HTTPS_EVIDENCE_DIR ?? 'docs/evidence/tip61');
await mkdir(out, {recursive: true});
const browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
const errors = [], checks = [];
try {
  const page = await browser.newPage({viewport: {width: 430, height: 932}, deviceScaleFactor: 1});
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(url, {waitUntil: 'networkidle', timeout: 45000});
  assert.equal(response.status(), 200);
  assert.ok(await page.locator('#camera').isVisible());
  assert.ok(await page.locator('#camera').isEnabled());
  checks.push('production app loaded; camera entry visible/enabled');
  await page.locator('#analysis-panel > summary').click();
  await page.waitForFunction(() => document.querySelector('#analysis-panel').open);
  for (const id of ['fixture-file', 'fixture-loop', 'saved-session', 'saved-export', 'journal-import']) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `${id} present`);
  }
  assert.ok(await page.locator('#fixture-loop').isChecked());
  await page.locator('#journal-status').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('#journal-status').textContent.includes('Đang đọc'), null, {timeout: 10000});
  checks.push('realtime clip input, loop and persisted session import/export wired');
  const journalStatus = await page.locator('#journal-status').textContent();
  await page.screenshot({path: resolve(out, 'https-phone-viewport.png'), fullPage: false});
  await page.locator('#close-analysis').click();
  assert.equal(await page.locator('#analysis-panel').evaluate(el => el.open), false);
  checks.push('analysis opens/closes at 430x932 without JS errors');
  assert.deepEqual(errors, []);
  const result = {verifiedAt: new Date().toISOString(), url, pass: true,
    scope: 'Desktop Chromium HTTPS UI smoke at 430x932; no real camera/model inference, not physical iPhone acceptance.',
    checks, journalStatus, errors};
  await writeFile(resolve(out, 'https-ui-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
