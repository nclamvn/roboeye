import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeDiagnostics } from '../../src/runtime-diagnostics';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); }
  };
}

test('diagnostics are bounded, local-only and sanitize nested detail', () => {
  const storage = memoryStorage();
  const diagnostics = createRuntimeDiagnostics({
    version: '1.2.0',
    commit: 'test',
    storage,
    maxEvents: 2,
    now: () => new Date('2026-08-06T00:00:00.000Z'),
    userAgent: () => 'test-agent',
    online: () => false
  });
  diagnostics.record('one', { ok: true });
  diagnostics.record('two', { secretObject: { pixels: true }, count: 2 });
  diagnostics.record('three');

  assert.deepEqual(diagnostics.snapshot(), {
    schemaVersion: 1,
    localOnly: true,
    app: { version: '1.2.0', commit: 'test' },
    environment: { userAgent: 'test-agent', online: false },
    events: [
      { at: '2026-08-06T00:00:00.000Z', name: 'two', detail: { count: 2 } },
      { at: '2026-08-06T00:00:00.000Z', name: 'three' }
    ]
  });
});
