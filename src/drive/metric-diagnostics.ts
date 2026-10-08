/** Stable codes are independent of UI wording. No pixels, GPS or device IDs. */
export type MetricReasonCode = 'accepted' | 'shape-mismatch' | 'invalid-box' | 'clipped-box' | 'tiny-roi' |
  'empty-roi' | 'sparse-roi' | 'out-of-domain' | 'mixed-depth' | 'foreground-ambiguous' |
  'zoom-unverified' | 'perspective-compression' | 'ordinal-conflict' | 'invalid-map' |
  'not-candidate' | 'unconfirmed-track' | 'track-lost' | 'binding-mismatch' | 'out-of-order' |
  'temporal-outlier' | 'temporal-gap' | 'temporal-reacquiring' | 'publication-rejected';
export interface DepthProbeEvidence {
  code: MetricReasonCode;
  boxWidthPx: number | null; boxHeightPx: number | null;
  roi: [number, number, number, number] | null;
  totalPixels: number; validPixels: number; supportPixels: number;
  q20M: number | null; medianM: number | null; q80M: number | null;
  relativeSpread: number | null; supportFraction: number | null;
  method: 'central-connected-depth-support-v2';
}
export interface MetricObjectDiagnostic {
  index: number; trackId: number | null; label: string; score: number;
  box: [number, number, number, number]; probe: DepthProbeEvidence;
  rawM: number | null; policyM: number | null; filteredM: number | null; publishedM: number | null;
  terminalStage: 'roi' | 'policy' | 'binding' | 'filter' | 'publication'; code: MetricReasonCode;
}
export interface MetricCaptureDiagnostic {
  sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number;
  contentFraction: number; modelSha256: string; preparationMs: number; requestedIntervalMs: number;
}
export const MAX_DIAGNOSTIC_OBJECTS = 32;
