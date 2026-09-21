import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptHereIncidents, adaptTomTomIncidents, deduplicateConnectedEvents, eventIsFresh, matchEventToRoute,
  type ConnectedRoadEvent, type ProviderAdapterContext
} from '../../src/drive/connected-events';

const RECEIVED = Date.parse('2026-09-21T03:01:00Z');
const NOW = Date.parse('2026-09-21T03:02:00Z');
const route = [{ lat: 10.7769, lng: 106.7000 }, { lat: 10.7769, lng: 106.7100 }];
const unverified = { commercialUse: 'unverified', retention: 'unverified', redistribution: 'unverified', policyRef: null } as const;
const hereRaw = JSON.parse(readFileSync(new URL('../fixtures/connected-events/here-incidents.json', import.meta.url), 'utf8')) as unknown;
const tomTomRaw = JSON.parse(readFileSync(new URL('../fixtures/connected-events/tomtom-incidents.json', import.meta.url), 'utf8')) as unknown;
const rfi = JSON.parse(readFileSync(new URL('../../research/commercial-intelligence/rfi/tip55b-provider-rfi.json', import.meta.url), 'utf8')) as {
  decisionStatus: string; requiredBeforeTrial: string[]; providers: Array<Record<string, unknown>>
};
function context(provider: 'here' | 'tomtom'): ProviderAdapterContext {
  return { fixtureId: `tip55b-${provider}-synthetic-v1`, capturedAt: '2026-09-21T03:05:00Z',
    sourceUrl: provider === 'here' ? 'https://docs.here.com/traffic-api/docs/incidents-here-traffic-api-v7-concepts'
      : 'https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-incidents/incident-details',
    receivedAtMs: RECEIVED, ttlMs: 120_000, rights: unverified };
}
function fixtures() {
  return { here: adaptHereIncidents(hereRaw, context('here')), tomtom: adaptTomTomIncidents(tomTomRaw, context('tomtom')) };
}

test('HERE fixture normalizes stable originalId, source time and semantic enums', () => {
  const result = adaptHereIncidents(hereRaw, context('here'));
  assert.equal(result.events.length, 2); assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /đã hết hạn/);
  assert.deepEqual(result.events[0], { ...result.events[0], providerEventId: 'here-accident-stable', provider: 'here', kind: 'accident',
    severity: 'major', roadClosed: false, observedAtMs: Date.parse('2026-09-21T03:00:00Z'), expiresAtMs: RECEIVED + 120_000,
    confidence: null, advisoryOnly: true, rights: unverified });
});

test('TomTom fixture maps GeoJSON, documented icon and delay enums without escalation', () => {
  const result = adaptTomTomIncidents(tomTomRaw, context('tomtom'));
  assert.equal(result.events.length, 2); assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /Point hoặc LineString/);
  assert.equal(result.events[0].kind, 'accident'); assert.equal(result.events[0].severity, 'moderate');
  assert.equal(result.events[0].geometry[0].lng, 106.7041); assert.equal(result.events[1].kind, 'road-closed');
  assert.equal(result.events[1].roadClosed, true); assert.equal(result.events[1].confidence, null);
});

test('both provider contracts are advisory-only and carry explicit unverified rights', () => {
  const { here, tomtom } = fixtures();
  for (const event of [...here.events, ...tomtom.events]) {
    assert.equal(event.schemaVersion, 1); assert.equal(event.advisoryOnly, true); assert.deepEqual(event.rights, unverified);
    assert.equal('risk' in event, false); assert.equal('warning' in event, false); assert.equal('distanceM' in event, false);
  }
});

test('freshness fails closed for planned, expired, future-received and over-age evidence', () => {
  const event = fixtures().here.events[0];
  assert.equal(eventIsFresh(event, NOW, { maxEvidenceAgeMs: 180_000 }), true);
  assert.equal(eventIsFresh(event, event.receivedAtMs - 1, { maxEvidenceAgeMs: 180_000 }), false);
  assert.equal(eventIsFresh(event, event.expiresAtMs, { maxEvidenceAgeMs: 180_000 }), false);
  assert.equal(eventIsFresh(event, NOW, { maxEvidenceAgeMs: 30_000 }), false);
  assert.equal(eventIsFresh({ ...event, startsAtMs: NOW + 1 }, NOW, { maxEvidenceAgeMs: 180_000 }), false);
  assert.equal(eventIsFresh({ ...event, expiresAtMs: Number.NaN }, NOW, { maxEvidenceAgeMs: 180_000 }), false);
  assert.equal(eventIsFresh(event, Number.NaN, { maxEvidenceAgeMs: 180_000 }), false);
});

test('route match accepts nearby aligned events and rejects distance and direction conflicts', () => {
  const { here } = fixtures(), near = here.events[0], far = here.events[1];
  const accepted = matchEventToRoute(near, route, { maxDistanceM: 40, maxHeadingDeltaDeg: 50 });
  assert.equal(accepted.matched, true); assert.ok(accepted.distanceM < 5); assert.equal(accepted.reason, 'matched');
  assert.equal(matchEventToRoute(far, route, { maxDistanceM: 40, maxHeadingDeltaDeg: 50 }).reason, 'too-far');
  const reverse = { ...near, geometry: [...near.geometry].reverse(), headingDeg: (near.headingDeg! + 180) % 360 };
  const conflict = matchEventToRoute(reverse, route, { maxDistanceM: 40, maxHeadingDeltaDeg: 50 });
  assert.equal(conflict.matched, false); assert.equal(conflict.reason, 'heading-conflict'); assert.ok(conflict.headingDeltaDeg! > 120);
  assert.equal(matchEventToRoute(near, [route[0]], { maxDistanceM: 40, maxHeadingDeltaDeg: 50 }).reason, 'invalid');
  assert.equal(matchEventToRoute(near, route, { maxDistanceM: 40, maxHeadingDeltaDeg: 50, routeHeadingDeg: Number.NaN }).reason, 'invalid');
  const sparseCrossing = { ...near, geometry: [{ lat: 10.775, lng: 106.705 }, { lat: 10.779, lng: 106.705 }], headingDeg: null };
  assert.equal(matchEventToRoute(sparseCrossing, route, { maxDistanceM: 1, maxHeadingDeltaDeg: 50 }).matched, true);
});

test('dedup merges only fresh same-road/type/time events and chooses deterministic stronger evidence', () => {
  const { here, tomtom } = fixtures();
  const output = deduplicateConnectedEvents([...here.events, ...tomtom.events], { nowMs: NOW, freshness: { maxEvidenceAgeMs: 180_000 }, maxDistanceM: 80 });
  assert.equal(output.length, 3);
  const accident = output.find(item => item.event.kind === 'accident')!;
  assert.equal(accident.event.provider, 'here'); assert.equal(accident.event.severity, 'major');
  assert.deepEqual(accident.duplicateIds, ['here:here-accident-stable', 'tomtom:tomtom-accident-a']);
  assert.deepEqual(output, deduplicateConnectedEvents([...here.events, ...tomtom.events], { nowMs: NOW, freshness: { maxEvidenceAgeMs: 180_000 }, maxDistanceM: 80 }));
});

test('dedup does not merge conflicting road names or event kinds', () => {
  const { here, tomtom } = fixtures(), source = tomtom.events[0];
  const cases: ConnectedRoadEvent[] = [source,
    { ...source, providerEventId: 'road-conflict', roadName: 'CT01' },
    { ...source, providerEventId: 'kind-conflict', kind: 'congestion' }];
  const result = deduplicateConnectedEvents([here.events[0], ...cases], { nowMs: NOW, freshness: { maxEvidenceAgeMs: 180_000 }, maxDistanceM: 80 });
  assert.equal(result.length, 3);
});

test('malformed provider rows are rejected independently and do not poison valid rows', () => {
  const invalidHere = structuredClone(hereRaw) as { results: Array<Record<string, unknown>> };
  (invalidHere.results[0].location as { shape: { links: unknown[] } }).shape.links = [];
  const here = adaptHereIncidents(invalidHere, context('here'));
  assert.equal(here.events.length, 1); assert.equal(here.rejected.length, 2);
  const invalidTomTom = structuredClone(tomTomRaw) as { incidents: Array<Record<string, unknown>> };
  (invalidTomTom.incidents[0].properties as Record<string, unknown>).lastReportTime = 'not-a-time';
  const tomtom = adaptTomTomIncidents(invalidTomTom, context('tomtom'));
  assert.equal(tomtom.events.length, 1); assert.equal(tomtom.rejected.length, 2);
});

test('adapters and dedup are deterministic and do not mutate offline fixtures', () => {
  const beforeHere = JSON.stringify(hereRaw), beforeTomTom = JSON.stringify(tomTomRaw);
  const first = fixtures(), second = fixtures();
  assert.deepEqual(first, second); assert.equal(JSON.stringify(hereRaw), beforeHere); assert.equal(JSON.stringify(tomTomRaw), beforeTomTom);
});

test('RFI gate keeps every mandatory commercial decision honest-null for both providers', () => {
  assert.equal(rfi.decisionStatus, 'blocked-pending-written-provider-responses'); assert.equal(rfi.providers.length, 2);
  assert.deepEqual(rfi.providers.map(provider => provider.id), ['here', 'tomtom']);
  for (const provider of rfi.providers) for (const field of rfi.requiredBeforeTrial) assert.equal(provider[field], null, `${String(provider.id)}.${field}`);
});

test('adapter context cannot claim verified rights without an attributable policy reference', () => {
  const invalid = context('here');
  invalid.rights = { commercialUse: 'allowed', retention: 'allowed', redistribution: 'prohibited', policyRef: null };
  assert.throws(() => adaptHereIncidents(hereRaw, invalid), /policyRef/);
});
