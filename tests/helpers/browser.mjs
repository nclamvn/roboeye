import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { chromium } from 'playwright-core';

const commonPaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

async function isExecutable(path) {
  if (!path) return false;
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBrowserExecutable() {
  const candidates = [
    process.env.ROBOEYE_CHROME,
    chromium.executablePath(),
    ...commonPaths
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  throw new Error(
    'Không tìm thấy Chromium/Chrome. Cài browser của Playwright hoặc đặt ROBOEYE_CHROME=/đường/dẫn/chrome.'
  );
}

export function browserLaunchOptions(executablePath) {
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  return {
    headless: true,
    executablePath,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--enable-unsafe-webgpu',
      '--no-sandbox'
    ],
    ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {})
  };
}
