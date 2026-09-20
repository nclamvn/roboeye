import type { RoadArea, RoadLine, RoadPoint } from './road-benchmark';

export interface RoadPathDiagnostic {
  accepted: boolean;
  reason: 'accepted' | 'no-hypothesis' | 'weak-support' | 'implausible-curve' | 'ambiguous';
  supportRows: number;
  span: number;
  rmsPx: number | null;
  confidence: number;
}

export interface RoadVectorization {
  lines: RoadLine[];
  areas: RoadArea[];
  diagnostics: {
    vectorizerVersion: 1 | 2;
    roadRows: number;
    markRows: number;
    horizonY: number | null;
    paths: { left: RoadPathDiagnostic | null; right: RoadPathDiagnostic | null };
  };
}

interface RoadBoundary { y: number; left: number; right: number }
interface MarkSegment { x: number; halfWidth: number }
interface MarkRow { y: number; segments: MarkSegment[] }
interface SupportedPoint extends RoadPoint { halfWidth: number }
interface Polynomial { a: number; b: number; c: number }
interface PathCandidate {
  polynomial: Polynomial;
  points: RoadPoint[];
  diagnostic: RoadPathDiagnostic;
  score: number;
  bottomX: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function simplify<T>(points: T[], maximum = 12): T[] {
  if (points.length <= maximum) return points;
  const result: T[] = [];
  for (let index = 0; index < maximum; index += 1) {
    result.push(points[Math.round(index * (points.length - 1) / (maximum - 1))]);
  }
  return result;
}

function median(values: number[]): number {
  return quantile(values, .5);
}

function smooth(samples: RoadPoint[]): RoadPoint[] {
  return samples.map((sample, index) => {
    const window = samples.slice(Math.max(0, index - 2), Math.min(samples.length, index + 3));
    return { x: median(window.map(point => point.x)), y: sample.y };
  });
}

function markSegments(labels: Uint8Array, width: number, y: number): MarkSegment[] {
  const segments: MarkSegment[] = [];
  let start = -1;
  for (let x = 0; x <= width; x += 1) {
    const marked = x < width && labels[y * width + x] === 3;
    if (marked && start < 0) start = x;
    if (!marked && start >= 0) {
      const pixels = x - start;
      if (pixels >= 2 && pixels <= Math.max(12, width * .07)) {
        segments.push({ x: (start + x - 1) / (2 * width), halfWidth: pixels / (2 * width) });
      }
      start = -1;
    }
  }
  return segments;
}

function roadBoundaries(labels: Uint8Array, width: number, height: number): RoadBoundary[] {
  const boundaries: RoadBoundary[] = [];
  for (let y = Math.floor(height * .28); y < height; y += 4) {
    const occupied: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const label = labels[y * width + x];
      if (label === 1 || label === 3) occupied.push(x);
    }
    if (occupied.length < width * .08) continue;
    const left = quantile(occupied, .015), right = quantile(occupied, .985);
    if (right - left >= width * .12) boundaries.push({ y, left, right });
  }
  return boundaries;
}

function drivableAreas(boundaries: RoadBoundary[], width: number, height: number): RoadArea[] {
  if (boundaries.length < 3) return [];
  const sampled = simplify(boundaries.map(row => ({ x: row.left / width, y: row.y / height })), 12);
  const right = simplify(boundaries.map(row => ({ x: row.right / width, y: row.y / height })), 12).reverse();
  const polygon = [...sampled, ...right];
  return polygon.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    ? [{ id: 'pred-drivable', class: 'drivable', points: polygon }]
    : [];
}

function collectMarkRows(labels: Uint8Array, width: number, height: number): MarkRow[] {
  const rows: MarkRow[] = [];
  for (let y = Math.floor(height * .36); y < height; y += 3) {
    const segments = markSegments(labels, width, y);
    if (segments.length) rows.push({ y: y / height, segments });
  }
  return rows;
}

function lineFromNearestMarks(labels: Uint8Array, width: number, height: number, side: 'left' | 'right'): RoadPoint[] {
  const raw: RoadPoint[] = [];
  for (let y = Math.floor(height * .42); y < height; y += 3) {
    const candidates = markSegments(labels, width, y)
      .map(segment => segment.x)
      .filter(x => side === 'left' ? x < .49 : x > .51)
      .sort((a, b) => Math.abs(a - .5) - Math.abs(b - .5));
    if (candidates.length) raw.push({ x: candidates[0], y: y / height });
  }
  if (raw.length < 4) return [];
  const bins: RoadPoint[] = [];
  const binHeight = .035;
  for (let y = .42; y < 1; y += binHeight) {
    const values = raw.filter(point => point.y >= y && point.y < y + binHeight);
    if (values.length) bins.push({ x: median(values.map(point => point.x)), y: median(values.map(point => point.y)) });
  }
  return bins.length >= 2 ? simplify(smooth(bins), 10) : [];
}

function polynomialValue(polynomial: Polynomial, y: number): number {
  return polynomial.a * y * y + polynomial.b * y + polynomial.c;
}

function solve3(matrix: number[][], vector: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item < 4; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item < 4; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }
  return augmented.map(row => row[3]);
}

function fitQuadratic(points: SupportedPoint[]): Polynomial | null {
  if (points.length < 5) return null;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, sx = 0, syx = 0, sy2x = 0;
  for (const point of points) {
    const weight = 1 + point.y;
    const y2 = point.y * point.y;
    s0 += weight; s1 += weight * point.y; s2 += weight * y2;
    s3 += weight * y2 * point.y; s4 += weight * y2 * y2;
    sx += weight * point.x; syx += weight * point.y * point.x; sy2x += weight * y2 * point.x;
  }
  const solved = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], [sy2x, syx, sx]);
  return solved && solved.every(Number.isFinite) ? { a: solved[0], b: solved[1], c: solved[2] } : null;
}

function supportedPoints(rows: MarkRow[], polynomial: Polynomial, side: 'left' | 'right', width: number): SupportedPoint[] {
  const supported: SupportedPoint[] = [];
  for (const row of rows) {
    const expected = polynomialValue(polynomial, row.y);
    if (expected < 0 || expected > 1) continue;
    const candidates = row.segments
      .filter(segment => side === 'left' ? segment.x < .57 : segment.x > .43)
      .map(segment => ({ segment, distance: Math.abs(segment.x - expected) }))
      .sort((a, b) => a.distance - b.distance || a.segment.x - b.segment.x);
    const best = candidates[0];
    if (best && best.distance <= .012 + best.segment.halfWidth + 5 / width) {
      supported.push({ x: best.segment.x, y: row.y, halfWidth: best.segment.halfWidth });
    }
  }
  return supported;
}

function plausible(polynomial: Polynomial, side: 'left' | 'right'): boolean {
  if (![polynomial.a, polynomial.b, polynomial.c].every(Number.isFinite) || Math.abs(polynomial.a) > 2.8) return false;
  for (const y of [.45, .7, .98]) {
    const x = polynomialValue(polynomial, y), derivative = 2 * polynomial.a * y + polynomial.b;
    if (x < -.03 || x > 1.03) return false;
    if (side === 'left' ? derivative > .06 : derivative < -.06) return false;
  }
  const bottom = polynomialValue(polynomial, .98);
  return side === 'left' ? bottom >= .02 && bottom < .5 : bottom > .5 && bottom <= .98;
}

function refineCandidate(rows: MarkRow[], initial: Polynomial, side: 'left' | 'right', width: number): PathCandidate | null {
  let support = supportedPoints(rows, initial, side, width);
  if (support.length < 5) return null;
  let polynomial = fitQuadratic(support) ?? initial;
  support = supportedPoints(rows, polynomial, side, width);
  const refit = fitQuadratic(support);
  if (refit) polynomial = refit;
  support = supportedPoints(rows, polynomial, side, width);
  if (support.length < 5) return null;
  const ys = support.map(point => point.y), span = Math.max(...ys) - Math.min(...ys);
  const residuals = support.map(point => (point.x - polynomialValue(polynomial, point.y)) * width);
  const rmsPx = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);
  if (span < .14 || !plausible(polynomial, side)) return null;
  const confidence = clamp((span - .1) / .42) * clamp(support.length / 18) * Math.exp(-rmsPx / 12);
  if (confidence < .18) return null;
  const topY = clamp(Math.min(...ys) - .025, .38, .82), bottomY = .99;
  const points: RoadPoint[] = [];
  for (let index = 0; index < 10; index += 1) {
    const y = topY + (bottomY - topY) * index / 9, x = polynomialValue(polynomial, y);
    if (!Number.isFinite(x) || x < 0 || x > 1) return null;
    points.push({ x, y });
  }
  const bottomX = polynomialValue(polynomial, .99);
  const supportWeight = support.reduce((sum, point) => sum + 1 + point.y, 0);
  // Ego boundaries are, by definition, the supported left/right paths nearest
  // the optical centre at the bottom of the frame. Make this a first-class
  // association term so longer adjacent-lane dashes cannot steal identity.
  const centrePenalty = Math.abs(bottomX - .5) * 80;
  return {
    polynomial,
    points,
    bottomX,
    score: supportWeight + span * 25 - rmsPx * .25 - centrePenalty,
    diagnostic: { accepted: true, reason: 'accepted', supportRows: support.length, span, rmsPx, confidence },
  };
}

function reject(reason: RoadPathDiagnostic['reason']): RoadPathDiagnostic {
  return { accepted: false, reason, supportRows: 0, span: 0, rmsPx: null, confidence: 0 };
}

function continuityPath(rows: MarkRow[], side: 'left' | 'right', width: number): { candidate: PathCandidate | null; diagnostic: RoadPathDiagnostic } {
  const sideRows = rows.map(row => ({
    y: row.y,
    segments: row.segments
      .filter(segment => side === 'left' ? segment.x < .57 : segment.x > .43)
      .sort((a, b) => Math.abs(a.x - .5) - Math.abs(b.x - .5))
      .slice(0, 4),
  })).filter(row => row.segments.length);
  const lowerRows = sideRows.filter(row => row.y >= .62).slice(-28);
  const upperRows = sideRows.filter((row, index) => row.y <= .84 && index % 3 === 0);
  const candidates: PathCandidate[] = [];
  for (const lowerRow of lowerRows) for (const lower of lowerRow.segments) {
    for (const upperRow of upperRows) {
      const dy = lowerRow.y - upperRow.y;
      if (dy < .12) continue;
      for (const upper of upperRow.segments) {
        const slope = (lower.x - upper.x) / dy;
        if (side === 'left' ? slope >= -.07 || slope < -2.4 : slope <= .07 || slope > 2.4) continue;
        const initial = { a: 0, b: slope, c: upper.x - slope * upperRow.y };
        const bottomX = polynomialValue(initial, .99), topX = polynomialValue(initial, .42);
        if (side === 'left' ? bottomX < .01 || bottomX >= .5 : bottomX <= .5 || bottomX > .99) continue;
        if (topX < .2 || topX > .8) continue;
        const candidate = refineCandidate(sideRows, initial, side, width);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  if (!candidates.length) return { candidate: null, diagnostic: reject('no-hypothesis') };
  candidates.sort((a, b) => b.score - a.score || b.diagnostic.confidence - a.diagnostic.confidence || a.bottomX - b.bottomX);
  const best = candidates[0];
  const competitor = candidates.find(candidate => Math.abs(candidate.bottomX - best.bottomX) > .065);
  const anchorSeparation = competitor
    ? Math.abs(Math.abs(competitor.bottomX - .5) - Math.abs(best.bottomX - .5))
    : Infinity;
  if (competitor && anchorSeparation < .09
    && Math.abs(competitor.diagnostic.supportRows - best.diagnostic.supportRows) <= 4
    && competitor.diagnostic.confidence >= best.diagnostic.confidence * .7) {
    return { candidate: null, diagnostic: { ...best.diagnostic, accepted: false, reason: 'ambiguous' } };
  }
  return { candidate: best, diagnostic: best.diagnostic };
}

function validateShape(labels: Uint8Array, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || labels.length !== width * height) {
    throw Error('Road mask shape không hợp lệ');
  }
}

/** D2 baseline retained in behavior for reproducible comparison. */
export function vectorizeRoadMaskV1(labels: Uint8Array, width: number, height: number): RoadVectorization {
  validateShape(labels, width, height);
  const boundaries = roadBoundaries(labels, width, height);
  const left = lineFromNearestMarks(labels, width, height, 'left');
  const right = lineFromNearestMarks(labels, width, height, 'right');
  const lines: RoadLine[] = [];
  if (left.length >= 2) lines.push({ id: 'pred-ego-left', class: 'lane-marking', role: 'ego-left', points: left });
  if (right.length >= 2) lines.push({ id: 'pred-ego-right', class: 'lane-marking', role: 'ego-right', points: right });
  let markRows = 0;
  for (let y = 0; y < height; y += 1) if (markSegments(labels, width, y).length) markRows += 1;
  return {
    lines,
    areas: drivableAreas(boundaries, width, height),
    diagnostics: {
      vectorizerVersion: 1,
      roadRows: boundaries.length,
      markRows,
      horizonY: boundaries.length ? boundaries[0].y / height : null,
      paths: { left: null, right: null },
    },
  };
}

/** D3 continuity-aware stateless vectorizer. Temporal fusion belongs to RoadGraph. */
export function vectorizeRoadMaskV2(labels: Uint8Array, width: number, height: number): RoadVectorization {
  validateShape(labels, width, height);
  const boundaries = roadBoundaries(labels, width, height), rows = collectMarkRows(labels, width, height);
  const left = continuityPath(rows, 'left', width), right = continuityPath(rows, 'right', width);
  const lines: RoadLine[] = [];
  if (left.candidate) lines.push({ id: 'pred-ego-left', class: 'lane-marking', role: 'ego-left', points: left.candidate.points });
  if (right.candidate) lines.push({ id: 'pred-ego-right', class: 'lane-marking', role: 'ego-right', points: right.candidate.points });
  return {
    lines,
    areas: drivableAreas(boundaries, width, height),
    diagnostics: {
      vectorizerVersion: 2,
      roadRows: boundaries.length,
      markRows: rows.length,
      horizonY: boundaries.length ? boundaries[0].y / height : null,
      paths: { left: left.diagnostic, right: right.diagnostic },
    },
  };
}

export const vectorizeRoadMask = vectorizeRoadMaskV2;
