/** UI integration on the actual offline original and exported episode assets.
 * No semantic contact/Out certification is inferred from these checks. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';

const args = process.argv.slice(2); assert.ok(args.length === 0 || args.length === 2 && args[0] === '--url', 'Use --url <anonymous HTTPS URL>');
const remote = args.length > 0, origin = remote ? args[1] : process.env.COURT_M8_ORIGIN ?? 'http://127.0.0.1:4238';
const entryUrl = new URL(origin), entryOrigin = entryUrl.origin;
if (remote) { assert.equal(entryUrl.protocol, 'https:'); assert.equal(entryUrl.username, ''); assert.equal(entryUrl.password, ''); }
const out = resolve('.court-cache/m8/customer-qa', remote ? 'public' : 'local'); await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(out, 'profile-')), checks = [], errors = [];
const authRequests = [], externalOrigins = new Set(); let actualUrl, initialCookieCount;
let browser, failure; const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const anonymousHtml = await fetch(entryUrl, { redirect: 'manual' }); assert.equal(anonymousHtml.status, 200, 'Entry must open anonymously, not redirect to login');
  assert.equal(anonymousHtml.headers.get('www-authenticate'), null);
  const manifestUrl = new URL('./demo/manifest.json', origin), manifest = await (await fetch(manifestUrl)).json();
  const original = manifest.clips.find(clip => clip.role === 'user-original'); assert.ok(original);
  const session = await (await fetch(new URL(original.sessions.specialist, manifestUrl))).json();
  assert.equal(manifest.eventEvidence.path, './events/manifest.json');
  const sidecarUrl = new URL(manifest.eventEvidence.path, manifestUrl), sidecarBytes = Buffer.from(await (await fetch(sidecarUrl)).arrayBuffer());
  assert.equal(hash(sidecarBytes), manifest.eventEvidence.sha256); const sidecar = JSON.parse(sidecarBytes);
  browser = await chromium.launchPersistentContext(profile, { ...browserLaunchOptions(await resolveBrowserExecutable()), viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
  initialCookieCount = (await browser.cookies()).length; assert.equal(initialCookieCount, 0, 'Fresh anonymous browser profile');
  browser.on('request', request => {
    if (request.headers().authorization) authRequests.push({ origin: new URL(request.url()).origin, method: request.method() });
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== entryOrigin) externalOrigins.add(new URL(request.url()).origin);
  });
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  const navigation = await page.goto(origin); assert.equal(navigation.status(), 200); actualUrl = page.url();
  assert.equal(new URL(actualUrl).origin, entryOrigin); assert.equal(new URL(actualUrl).pathname, entryUrl.pathname);
  await page.waitForFunction(() => document.getElementById('stage').dataset.ready === 'true'
    && document.getElementById('contact-workspace').dataset.sidecarState === 'ready'
    && document.querySelectorAll('.contact-item img').length === 2);
  assert.equal(await page.locator('#court-settings').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('.contact-heading p').textContent(), 'Demo ghi sẵn · không phân xử');
  assert.deepEqual(await page.locator('.contact-item').evaluateAll(nodes => nodes.map(node => Number(node.dataset.frameIndex))), [101, 232]);
  const edge = page.locator('.contact-event[data-kind="edge-loss-review"]');
  assert.match(await page.locator('#featured-review').textContent(), /9,28/); await page.locator('#featured-review').click();
  await page.waitForFunction(() => document.getElementById('contact-review').dataset.state === 'ready');
  const at232 = await page.locator('#court-overlay').evaluate(canvas => ({ ...canvas.dataset }));
  assert.equal(at232.frameIndex, '232'); assert.equal(at232.boxVisible, 'true'); assert.equal(at232.suspectPointVisible, 'false');
  assert.equal(at232.selectedEventKind, 'edge-loss-review'); assert.equal(at232.selectedBoxVisible, 'true');
  ['boxX', 'boxY', 'boxWidth', 'boxHeight'].forEach((key, index) => assert.ok(Math.abs(Number(at232[key]) - session.frames[232].ball.box[index]) < 1e-9));
  assert.equal(await page.locator('#contact-decision').textContent(), 'Mất dấu · Chưa rõ');
  assert.equal(await page.locator('#contact-review').getAttribute('data-review-start-frame'), '228');
  assert.equal(await page.locator('#contact-review').getAttribute('data-review-end-frame'), '239');
  pass('two computed real-source reviews; edge232 uses its actual observed native box, not a physical contact cross');
  await page.screenshot({ path: join(out, 'edge-1440.png'), fullPage: true });
  await page.locator('#step-forward').click();
  await page.waitForFunction(() => document.getElementById('court-overlay').dataset.frameIndex === '233');
  const lost = await page.locator('#court-overlay').evaluate(canvas => ({ ...canvas.dataset }));
  assert.equal(lost.observation, 'missing'); assert.equal(lost.boxVisible, 'false'); assert.equal(lost.selectedBoxVisible, 'false');
  assert.equal(lost.boxX, ''); assert.equal(lost.trailFrames, ''); assert.equal(lost.suspectPointVisible, 'false');
  pass('missing233 holds no cyan/amber box, no contact point and no synthetic trail');
  await edge.click(); await page.waitForFunction(() => document.getElementById('contact-review').dataset.state === 'ready');
  const slots = await page.locator('#contact-context .context-slot').evaluateAll(nodes => nodes.map(node => ({ ...node.dataset })));
  assert.deepEqual(slots.map(slot => Number(slot.frameIndex)), [230, 231, 232, 233, 234]); assert.ok(slots.every(slot => slot.status === 'captured'));
  await page.locator('#play-contact-clip').click();
  await page.waitForFunction(() => document.getElementById('stage').dataset.contactReplay === 'stopped', null, { timeout: 15000 });
  const replay = await page.locator('#stage').evaluate(stage => ({ ...stage.dataset }));
  assert.equal(replay.contactReplayStartFrame, '203'); assert.equal(replay.contactReplayEndFrame, '264'); assert.equal(replay.contactReplaySourceSha, original.sourceSha256);
  assert.equal(await page.locator('#court-overlay').getAttribute('data-frame-index'), '264'); assert.equal(await page.locator('#court-video').evaluate(v => v.paused), true);
  assert.equal(await page.locator('#court-video').evaluate(v => v.loop), true);
  pass('actual source replay203..264 stops on exact inclusive end, loop restored; five native before/after stills retain232 identity');
  const event = sidecar.events.find(event => event.kind === 'edge-loss-review');
  const pending = page.waitForEvent('download'); await page.locator('#download-contact-clip').click(); const download = await pending;
  const saved = join(out, 'edge-verified-clip.mp4'); await download.saveAs(saved); const bytes = await readFile(saved);
  assert.equal(bytes.length, event.clip.bytes); assert.equal(hash(bytes), event.clip.sha256); assert.match(download.suggestedFilename(), /khung-0233-clip\.mp4$/);
  pass('real exported MP4 downloads only after exact bytecount/SHA verification; saved bytes equal exporter artifact');
  await page.setViewportSize({ width: 375, height: 900 }); await edge.click();
  await page.waitForFunction(() => document.getElementById('contact-review').dataset.state === 'ready');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  await page.screenshot({ path: join(out, 'edge-375.png'), fullPage: true });
  await page.locator('#close-contact').click(); assert.equal(await page.locator('#download-contact-clip').isVisible(), false);
  await page.locator('.contact-event[data-kind="suspected-contact"]').click();
  await page.waitForFunction(() => document.getElementById('contact-review').dataset.state === 'ready');
  assert.equal(await page.locator('#court-overlay').getAttribute('data-frame-index'), '101'); assert.equal(await page.locator('#court-overlay').getAttribute('data-suspect-point-visible'), 'true');
  pass('compact375 layout, clean evidence close, existing101 suspected-contact marker unchanged');
  // SHA-corrupted optional sidecar must not block the base replay or create an
  // unverified save action. This is a structural fault, not new video evidence.
  const bad = await browser.newPage(); bad.on('pageerror', error => errors.push(error.message));
  await bad.route('**/demo/events/manifest.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await bad.goto(origin);
  await bad.waitForFunction(() => document.getElementById('stage').dataset.ready === 'true' && document.getElementById('contact-workspace').dataset.sidecarState === 'error');
  await bad.locator('.contact-event[data-kind="edge-loss-review"]').click();
  await bad.waitForFunction(() => document.getElementById('contact-review').dataset.state === 'ready');
  assert.equal(await bad.locator('#download-contact-clip').isVisible(), false); assert.equal(await bad.locator('#play-contact-clip').isEnabled(), true);
  assert.deepEqual(errors, []); pass('corrupt optional evidence fails closed for downloads without blocking actual replay; no runtime errors');
  assert.deepEqual(authRequests, []); assert.ok(!/\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(new URL(actualUrl).pathname));
  pass('fresh anonymous browser opens actual entry without auth headers, cookies supplied or login redirect');
} catch (error) { failure = error; console.error(error.stack); }
finally {
  await browser?.close(); await rm(profile, { recursive: true, force: true });
  await writeFile(join(out, 'ui-integration.json'), JSON.stringify({ pass: !failure, remote, actualUrl, initialCookieCount, authRequests, externalOrigins: [...externalOrigins], checks, errors,
    failure: failure?.message ?? null, temporaryProfileRemoved: true, scope: 'known prerecorded original, UI/assets only; not live processing or certified contact/line-call accuracy' }, null, 2));
}
if (failure) process.exitCode = 1;
