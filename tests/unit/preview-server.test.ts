import assert from 'node:assert/strict';
import test from 'node:test';

// Helper is JavaScript because every browser smoke test imports it directly.
// @ts-expect-error The project intentionally does not emit declarations for test helpers.
import { isViteReadyOutput } from '../helpers/preview-server.mjs';

test('recognizes Vite preview output using localhost', () => {
  assert.equal(isViteReadyOutput('  ➜  Local:   http://localhost:4173/\n'), true);
});

test('recognizes Vite dev output using 127.0.0.1', () => {
  assert.equal(isViteReadyOutput('  ➜  Local:   http://127.0.0.1:4194/\n'), true);
});

test('strips ANSI colors before matching Vite output', () => {
  assert.equal(
    isViteReadyOutput('\u001b[1;1H\u001b[0J\n  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m4173\u001b[22m/\u001b[39m\n'),
    true
  );
});

test('does not accept unrelated process output', () => {
  assert.equal(isViteReadyOutput('waiting for browser at http://127.0.0.1:4194/'), false);
});
