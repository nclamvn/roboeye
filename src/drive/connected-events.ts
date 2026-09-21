export type ConnectedEventProvider = 'here' | 'tomtom';
export type ConnectedEventKind = 'accident' | 'congestion' | 'roadworks' | 'road-closed' | 'lane-restriction' | 'disabled-vehicle' | 'hazard' | 'weather' | 'other';
export type ConnectedEventSeverity = 'unknown' | 'low' | 'minor' | 'moderate' | 'major' | 'critical';

export interface GeoPoint { lat: number; lng: number }
export interface ConnectedEventRights {
  commercialUse: 'unverified' | 'allowed' | 'prohibited';
  retention: 'unverified' | 'ephemeral-only' | 'allowed';
  redistribution: 'unverified' | 'allowed' | 'prohibited';
  policyRef: string | null;
}
export interface ConnectedEventProvenance {
  fixtureId: string;
  capturedAt: string;
  sourceUrl: string;
}
export interface ConnectedRoadEvent {
  schemaVersion: 1;
  provider: ConnectedEventProvider;
  providerEventId: string;
  kind: ConnectedEventKind;
  severity: ConnectedEventSeverity;
  geometry: GeoPoint[];
  headingDeg: number | null;
  roadName: string | null;
  summary: string | null;
  roadClosed: boolean;
  startsAtMs: number | null;
  endsAtMs: number | null;
  observedAtMs: number | null;
  receivedAtMs: number;
  expiresAtMs: number;
  confidence: null;
  advisoryOnly: true;
  rights: ConnectedEventRights;
  provenance: ConnectedEventProvenance;
}
export interface ProviderAdapterContext {
  fixtureId: string;
  capturedAt: string;
  sourceUrl: string;
  receivedAtMs: number;
  ttlMs: number;
  rights: ConnectedEventRights;
}
export interface AdapterRejection { index: number; reason: string }
export interface ProviderAdapterResult { events: ConnectedRoadEvent[]; rejected: AdapterRejection[] }
export interface FreshnessPolicy { maxEvidenceAgeMs: number }

const MAX_EVENTS = 10_000;
const MAX_POINTS = 5_000;
const MAX_TEXT = 240;
const HERE_TYPES: Record<string, ConnectedEventKind> = {
  accident: 'accident', construction: 'roadworks', congestion: 'congestion', disabledVehicle: 'disabled-vehicle',
  roadHazard: 'hazard', roadClosure: 'road-closed', weather: 'weather', laneRestriction: 'lane-restriction',
  massTransit: 'other', plannedEvent: 'other', other: 'other'
};
const TOMTOM_TYPES: Record<number, ConnectedEventKind> = {
  1: 'accident', 2: 'weather', 3: 'hazard', 4: 'weather', 5: 'weather', 6: 'congestion', 7: 'lane-restriction',
  8: 'road-closed', 9: 'roadworks', 10: 'weather', 11: 'weather', 14: 'disabled-vehicle'
};
const TOMTOM_SEVERITY: Record<number, ConnectedEventSeverity> = { 0: 'unknown', 1: 'minor', 2: 'moderate', 3: 'major', 4: 'unknown' };
const SEVERITY_RANK: Record<ConnectedEventSeverity, number> = { unknown: 0, low: 1, minor: 2, moderate: 3, major: 4, critical: 5 };

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path}: cần object`);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string, max = MAX_EVENTS): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error(`${path}: cần array tối đa ${max} phần tử`);
  return value;
}
function finite(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${path}: số ngoài giới hạn`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw Error(`${path}: cần boolean`);
  return value;
}
function text(value: unknown, path: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${path}: chuỗi không hợp lệ`);
  return value.trim();
}
function optionalText(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) return optionalText((value as Record<string, unknown>).value, `${path}.value`);
  return text(value, path);
}
function timestamp(value: unknown, path: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw Error(`${path}: cần thời gian ISO-8601`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw Error(`${path}: thời gian không hợp lệ`);
  return parsed;
}
function validateContext(context: ProviderAdapterContext): void {
  text(context.fixtureId, 'context.fixtureId', 120);
  timestamp(context.capturedAt, 'context.capturedAt');
  text(context.sourceUrl, 'context.sourceUrl', 500);
  finite(context.receivedAtMs, 'context.receivedAtMs', 0, 10 ** 15);
  finite(context.ttlMs, 'context.ttlMs', 1_000, 86_400_000);
  if (!context.rights || !['unverified', 'allowed', 'prohibited'].includes(context.rights.commercialUse)
    || !['unverified', 'ephemeral-only', 'allowed'].includes(context.rights.retention)
    || !['unverified', 'allowed', 'prohibited'].includes(context.rights.redistribution)) throw Error('context.rights: quyền dữ liệu không hợp lệ');
  if (context.rights.policyRef !== null) text(context.rights.policyRef, 'context.rights.policyRef', 500);
  if (context.rights.policyRef === null && [context.rights.commercialUse, context.rights.retention, context.rights.redistribution].some(value => value !== 'unverified')) {
    throw Error('context.rights.policyRef: bắt buộc khi khai quyền đã xác minh');
  }
}
function cloneRights(value: ConnectedEventRights): ConnectedEventRights { return { ...value }; }
function provenance(context: ProviderAdapterContext): ConnectedEventProvenance {
  return { fixtureId: context.fixtureId, capturedAt: context.capturedAt, sourceUrl: context.sourceUrl };
}
function pointFromLatLng(value: unknown, path: string): GeoPoint {
  const item = object(value, path);
  return { lat: finite(item.lat, `${path}.lat`, -90, 90), lng: finite(item.lng, `${path}.lng`, -180, 180) };
}
function pointFromGeoJson(value: unknown, path: string): GeoPoint {
  const item = array(value, path, 3);
  if (item.length < 2) throw Error(`${path}: tọa độ GeoJSON thiếu lng/lat`);
  return { lng: finite(item[0], `${path}[0]`, -180, 180), lat: finite(item[1], `${path}[1]`, -90, 90) };
}
function heading(points: GeoPoint[]): number | null {
  if (points.length < 2) return null;
  const a = points[0], b = points[points.length - 1];
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180, delta = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(delta) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta);
  if (Math.abs(x) + Math.abs(y) < 1e-12) return null;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function expiry(context: ProviderAdapterContext, endsAtMs: number | null): number {
  return Math.min(context.receivedAtMs + context.ttlMs, endsAtMs ?? Number.POSITIVE_INFINITY);
}
function base(provider: ConnectedEventProvider, context: ProviderAdapterContext, values: Omit<ConnectedRoadEvent,
  'schemaVersion' | 'provider' | 'headingDeg' | 'receivedAtMs' | 'expiresAtMs' | 'confidence' | 'advisoryOnly' | 'rights' | 'provenance'>): ConnectedRoadEvent {
  if (values.endsAtMs !== null && values.startsAtMs !== null && values.endsAtMs <= values.startsAtMs) throw Error('thời gian kết thúc phải sau thời gian bắt đầu');
  const expiresAtMs = expiry(context, values.endsAtMs);
  if (expiresAtMs <= context.receivedAtMs) throw Error('sự kiện đã hết hạn khi nhận');
  return { schemaVersion: 1, provider, ...values, headingDeg: heading(values.geometry), receivedAtMs: context.receivedAtMs,
    expiresAtMs, confidence: null, advisoryOnly: true, rights: cloneRights(context.rights), provenance: provenance(context) };
}

function hereGeometry(location: Record<string, unknown>): GeoPoint[] {
  const shape = object(location.shape, 'location.shape');
  const links = array(shape.links, 'location.shape.links', 2_000);
  const points: GeoPoint[] = [];
  for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
    const link = object(links[linkIndex], `location.shape.links[${linkIndex}]`);
    for (const [pointIndex, value] of array(link.points, `location.shape.links[${linkIndex}].points`, MAX_POINTS).entries()) {
      const parsed = pointFromLatLng(value, `location.shape.links[${linkIndex}].points[${pointIndex}]`);
      const previous = points[points.length - 1];
      if (!previous || previous.lat !== parsed.lat || previous.lng !== parsed.lng) points.push(parsed);
      if (points.length > MAX_POINTS) throw Error(`location.shape: tối đa ${MAX_POINTS} điểm`);
    }
  }
  if (!points.length) throw Error('location.shape: không có điểm');
  return points;
}

/** Offline adapter for HERE Traffic API v7 incidents requested with locationReferencing=shape. */
export function adaptHereIncidents(value: unknown, context: ProviderAdapterContext): ProviderAdapterResult {
  validateContext(context);
  const root = object(value, 'here');
  const sourceUpdated = timestamp(root.sourceUpdated, 'here.sourceUpdated');
  const results = array(root.results, 'here.results');
  const events: ConnectedRoadEvent[] = [], rejected: AdapterRejection[] = [];
  results.forEach((raw, index) => {
    try {
      const item = object(raw, `here.results[${index}]`), location = object(item.location, `here.results[${index}].location`);
      const details = object(item.incidentDetails, `here.results[${index}].incidentDetails`);
      const id = text(details.originalId ?? details.id, `here.results[${index}].incidentDetails.originalId`);
      const startsAtMs = timestamp(details.startTime, `here.results[${index}].incidentDetails.startTime`);
      const endsAtMs = timestamp(details.endTime, `here.results[${index}].incidentDetails.endTime`);
      const rawType = typeof details.type === 'string' ? details.type : '';
      const rawSeverity = typeof details.criticality === 'string' ? details.criticality : '';
      const geometry = hereGeometry(location);
      events.push(base('here', context, { providerEventId: id, kind: HERE_TYPES[rawType] ?? 'other',
        severity: ['low', 'minor', 'major', 'critical'].includes(rawSeverity) ? rawSeverity as ConnectedEventSeverity : 'unknown',
        geometry, roadName: optionalText(location.description, `here.results[${index}].location.description`),
        summary: optionalText(details.summary, `here.results[${index}].incidentDetails.summary`),
        roadClosed: boolean(details.roadClosed, `here.results[${index}].incidentDetails.roadClosed`),
        startsAtMs, endsAtMs, observedAtMs: sourceUpdated ?? timestamp(details.entryTime, `here.results[${index}].incidentDetails.entryTime`) }));
    } catch (error) { rejected.push({ index, reason: error instanceof Error ? error.message : 'lỗi không xác định' }); }
  });
  return { events, rejected };
}

function tomTomGeometry(raw: unknown, path: string): GeoPoint[] {
  const geometry = object(raw, path), type = geometry.type;
  if (type === 'Point') return [pointFromGeoJson(geometry.coordinates, `${path}.coordinates`)];
  if (type !== 'LineString') throw Error(`${path}.type: chỉ chấp nhận Point hoặc LineString`);
  const points = array(geometry.coordinates, `${path}.coordinates`, MAX_POINTS).map((value, index) => pointFromGeoJson(value, `${path}.coordinates[${index}]`));
  if (!points.length) throw Error(`${path}: không có điểm`);
  return points;
}
function tomTomSummary(properties: Record<string, unknown>, path: string): string | null {
  if (!Array.isArray(properties.events) || !properties.events.length) return null;
  const first = object(properties.events[0], `${path}.events[0]`);
  return optionalText(first.description, `${path}.events[0].description`);
}
function tomTomRoad(properties: Record<string, unknown>, path: string): string | null {
  if (Array.isArray(properties.roadNumbers) && properties.roadNumbers.length) return text(properties.roadNumbers[0], `${path}.roadNumbers[0]`);
  return optionalText(properties.from, `${path}.from`);
}

/** Offline adapter for TomTom Traffic Incident Details v5 GeoJSON-like responses. */
export function adaptTomTomIncidents(value: unknown, context: ProviderAdapterContext): ProviderAdapterResult {
  validateContext(context);
  const root = object(value, 'tomtom'), incidents = array(root.incidents, 'tomtom.incidents');
  const events: ConnectedRoadEvent[] = [], rejected: AdapterRejection[] = [];
  incidents.forEach((raw, index) => {
    try {
      const item = object(raw, `tomtom.incidents[${index}]`), properties = object(item.properties, `tomtom.incidents[${index}].properties`);
      const category = finite(properties.iconCategory, `tomtom.incidents[${index}].properties.iconCategory`, 0, 10_000);
      const magnitude = finite(properties.magnitudeOfDelay, `tomtom.incidents[${index}].properties.magnitudeOfDelay`, 0, 4);
      const startsAtMs = timestamp(properties.startTime, `tomtom.incidents[${index}].properties.startTime`);
      const endsAtMs = timestamp(properties.endTime, `tomtom.incidents[${index}].properties.endTime`);
      events.push(base('tomtom', context, { providerEventId: text(properties.id, `tomtom.incidents[${index}].properties.id`),
        kind: TOMTOM_TYPES[category] ?? 'other', severity: TOMTOM_SEVERITY[magnitude] ?? 'unknown',
        geometry: tomTomGeometry(item.geometry, `tomtom.incidents[${index}].geometry`),
        roadName: tomTomRoad(properties, `tomtom.incidents[${index}].properties`),
        summary: tomTomSummary(properties, `tomtom.incidents[${index}].properties`), roadClosed: category === 8,
        startsAtMs, endsAtMs, observedAtMs: timestamp(properties.lastReportTime, `tomtom.incidents[${index}].properties.lastReportTime`) }));
    } catch (error) { rejected.push({ index, reason: error instanceof Error ? error.message : 'lỗi không xác định' }); }
  });
  return { events, rejected };
}

export function eventIsFresh(event: ConnectedRoadEvent, nowMs: number, policy: FreshnessPolicy): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(policy.maxEvidenceAgeMs) || policy.maxEvidenceAgeMs < 0) return false;
  if (!Number.isFinite(event.receivedAtMs) || !Number.isFinite(event.expiresAtMs) || event.expiresAtMs <= event.receivedAtMs) return false;
  if ([event.startsAtMs, event.endsAtMs, event.observedAtMs].some(value => value !== null && !Number.isFinite(value))) return false;
  if (event.startsAtMs !== null && nowMs < event.startsAtMs) return false;
  if (event.endsAtMs !== null && nowMs >= event.endsAtMs) return false;
  if (nowMs < event.receivedAtMs || nowMs >= event.expiresAtMs) return false;
  return event.observedAtMs === null || (event.observedAtMs <= nowMs && nowMs - event.observedAtMs <= policy.maxEvidenceAgeMs);
}

function localXY(point: GeoPoint, origin: GeoPoint): [number, number] {
  const metresPerDegree = 111_320;
  return [(point.lng - origin.lng) * metresPerDegree * Math.cos(origin.lat * Math.PI / 180), (point.lat - origin.lat) * metresPerDegree];
}
function segmentDistance(point: GeoPoint, start: GeoPoint, end: GeoPoint): number {
  const [px, py] = localXY(point, start), [bx, by] = localXY(end, start), lengthSquared = bx * bx + by * by;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared)) : 0;
  return Math.hypot(px - ratio * bx, py - ratio * by);
}
function segmentPairDistance(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint): number {
  const [bx, by] = localXY(b, a), [cx, cy] = localXY(c, a), [dx, dy] = localXY(d, a);
  const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const abC = cross(0, 0, bx, by, cx, cy), abD = cross(0, 0, bx, by, dx, dy);
  const cdA = cross(cx, cy, dx, dy, 0, 0), cdB = cross(cx, cy, dx, dy, bx, by);
  const epsilon = 1e-8;
  const opposite = (first: number, second: number) => (first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon);
  const onSegment = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.abs(cross(px, py, qx, qy, rx, ry)) <= epsilon
    && rx >= Math.min(px, qx) - epsilon && rx <= Math.max(px, qx) + epsilon && ry >= Math.min(py, qy) - epsilon && ry <= Math.max(py, qy) + epsilon;
  if ((opposite(abC, abD) && opposite(cdA, cdB)) || onSegment(0, 0, bx, by, cx, cy) || onSegment(0, 0, bx, by, dx, dy)
    || onSegment(cx, cy, dx, dy, 0, 0) || onSegment(cx, cy, dx, dy, bx, by)) return 0;
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b));
}
function polylineDistance(points: GeoPoint[], route: GeoPoint[]): number {
  if (!points.length || !route.length) return Infinity;
  if (points.length === 1 && route.length === 1) return segmentDistance(points[0], route[0], route[0]);
  if (points.length === 1) return route.slice(1).reduce((best, end, index) => Math.min(best, segmentDistance(points[0], route[index], end)), Infinity);
  if (route.length === 1) return points.slice(1).reduce((best, end, index) => Math.min(best, segmentDistance(route[0], points[index], end)), Infinity);
  let closest = Infinity;
  for (let pointIndex = 1; pointIndex < points.length; pointIndex++) for (let routeIndex = 1; routeIndex < route.length; routeIndex++) {
    closest = Math.min(closest, segmentPairDistance(points[pointIndex - 1], points[pointIndex], route[routeIndex - 1], route[routeIndex]));
  }
  return closest;
}
function headingDelta(a: number, b: number): number { const delta = Math.abs(a - b) % 360; return Math.min(delta, 360 - delta); }
export interface RouteMatchOptions { maxDistanceM: number; maxHeadingDeltaDeg: number; routeHeadingDeg?: number }
export interface RouteMatch { matched: boolean; distanceM: number; headingDeltaDeg: number | null; reason: 'matched' | 'too-far' | 'heading-conflict' | 'invalid' }

/** Conservative spatial/direction gate. It returns relevance only, never a driver warning. */
export function matchEventToRoute(event: ConnectedRoadEvent, route: GeoPoint[], options: RouteMatchOptions): RouteMatch {
  if (route.length < 2 || event.geometry.length < 1 || !Number.isFinite(options.maxDistanceM) || options.maxDistanceM < 0
    || !Number.isFinite(options.maxHeadingDeltaDeg) || options.maxHeadingDeltaDeg < 0 || options.maxHeadingDeltaDeg > 180
    || (options.routeHeadingDeg !== undefined && (!Number.isFinite(options.routeHeadingDeg) || options.routeHeadingDeg < 0 || options.routeHeadingDeg >= 360))) {
    return { matched: false, distanceM: Infinity, headingDeltaDeg: null, reason: 'invalid' };
  }
  const distanceM = polylineDistance(event.geometry, route);
  if (!Number.isFinite(distanceM)) return { matched: false, distanceM, headingDeltaDeg: null, reason: 'invalid' };
  if (distanceM > options.maxDistanceM) return { matched: false, distanceM, headingDeltaDeg: null, reason: 'too-far' };
  const routeHeading = options.routeHeadingDeg ?? heading(route);
  const delta = event.headingDeg !== null && routeHeading !== null ? headingDelta(event.headingDeg, routeHeading) : null;
  if (delta !== null && delta > options.maxHeadingDeltaDeg) return { matched: false, distanceM, headingDeltaDeg: delta, reason: 'heading-conflict' };
  return { matched: true, distanceM, headingDeltaDeg: delta, reason: 'matched' };
}

function eventKey(event: ConnectedRoadEvent): string { return `${event.provider}:${event.providerEventId}`; }
function normalizedRoad(value: string | null): string | null { return value?.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '') || null; }
function intervalsOverlap(a: ConnectedRoadEvent, b: ConnectedRoadEvent): boolean {
  const aStart = a.startsAtMs ?? -Infinity, aEnd = a.endsAtMs ?? a.expiresAtMs;
  const bStart = b.startsAtMs ?? -Infinity, bEnd = b.endsAtMs ?? b.expiresAtMs;
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}
function eventDistance(a: ConnectedRoadEvent, b: ConnectedRoadEvent): number {
  return polylineDistance(a.geometry, b.geometry);
}
function duplicate(a: ConnectedRoadEvent, b: ConnectedRoadEvent, maxDistanceM: number): boolean {
  if (a.kind !== b.kind || a.roadClosed !== b.roadClosed || !intervalsOverlap(a, b) || eventDistance(a, b) > maxDistanceM) return false;
  const aRoad = normalizedRoad(a.roadName), bRoad = normalizedRoad(b.roadName);
  return !(aRoad && bRoad && aRoad !== bRoad);
}
function prefer(a: ConnectedRoadEvent, b: ConnectedRoadEvent): ConnectedRoadEvent {
  return SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity] ? (SEVERITY_RANK[a.severity] > SEVERITY_RANK[b.severity] ? a : b)
    : (a.observedAtMs ?? -Infinity) !== (b.observedAtMs ?? -Infinity) ? ((a.observedAtMs ?? -Infinity) > (b.observedAtMs ?? -Infinity) ? a : b)
      : a.receivedAtMs !== b.receivedAtMs ? (a.receivedAtMs > b.receivedAtMs ? a : b)
        : eventKey(a).localeCompare(eventKey(b)) <= 0 ? a : b;
}
export interface DeduplicatedConnectedEvent { event: ConnectedRoadEvent; duplicateIds: string[] }
export interface DeduplicationOptions { nowMs: number; freshness: FreshnessPolicy; maxDistanceM: number }

/** Drops stale inputs and merges only strong same-kind/spatial/temporal duplicates. */
export function deduplicateConnectedEvents(events: ConnectedRoadEvent[], options: DeduplicationOptions): DeduplicatedConnectedEvent[] {
  if (!Number.isFinite(options.maxDistanceM) || options.maxDistanceM < 0) return [];
  const fresh = events.filter(event => eventIsFresh(event, options.nowMs, options.freshness)).sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
  const groups: DeduplicatedConnectedEvent[] = [];
  for (const event of fresh) {
    const group = groups.find(candidate => duplicate(candidate.event, event, options.maxDistanceM));
    if (!group) { groups.push({ event, duplicateIds: [eventKey(event)] }); continue; }
    group.event = prefer(group.event, event);
    group.duplicateIds.push(eventKey(event)); group.duplicateIds.sort();
  }
  return groups.sort((a, b) => eventKey(a.event).localeCompare(eventKey(b.event)));
}
