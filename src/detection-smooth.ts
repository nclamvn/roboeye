// T26: alpha-beta tracking for low-rate object detection.
// Detection returns only a few frames per second. Rendering the latest raw box
// makes the overlay lag and jump, especially for a moving person or vehicle.
// This tracker predicts short-term centre motion between detections, corrects
// from each new observation and confirms a hypothesis before it is displayed.

import type { DetBox } from './detection-types';

interface Track {
  box: DetBox;
  measurement: DetBox;
  velocity: { x: number; y: number }; // normalized viewport units / ms
  lastObservationAt: number;
  hits: number;
  missed: number;
  confirmed: boolean;
}

export interface SmootherOptions {
  iouMatch: number;
  centerGate: number;
  maxCenterGate: number;
  minHits: number;
  immediateScore: number;
  maxMissed: number;
  correctionAlpha: number;
  velocityAlpha: number;
  velocityDecayMs: number;
  maxVelocity: number;
}

const DEFAULTS: SmootherOptions = {
  iouMatch: 0.22,
  centerGate: 0.26,
  maxCenterGate: 0.38,
  minHits: 2,
  // A very confident detector result is useful immediately. Lower confidence
  // still needs a second hit, which stops a one-frame false positive flashing.
  immediateScore: 0.92,
  maxMissed: 2,
  correctionAlpha: 0.72,
  velocityAlpha: 0.55,
  velocityDecayMs: 360,
  maxVelocity: 0.003
};

function iou(a: DetBox, b: DetBox): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function centre(box: DetBox): { x: number; y: number } {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}

function centerDistance(a: DetBox, b: DetBox): number {
  const ac = centre(a);
  const bc = centre(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blendBox(from: DetBox, to: DetBox, alpha: number): DetBox {
  return {
    label: to.label,
    score: to.score,
    x0: from.x0 + (to.x0 - from.x0) * alpha,
    y0: from.y0 + (to.y0 - from.y0) * alpha,
    x1: from.x1 + (to.x1 - from.x1) * alpha,
    y1: from.y1 + (to.y1 - from.y1) * alpha
  };
}

function translateBox(box: DetBox, dx: number, dy: number): DetBox {
  // Preserve box size while keeping a predicted track inside the image.
  const shiftX = clamp(dx, -box.x0, 1 - box.x1);
  const shiftY = clamp(dy, -box.y0, 1 - box.y1);
  return { ...box, x0: box.x0 + shiftX, y0: box.y0 + shiftY, x1: box.x1 + shiftX, y1: box.y1 + shiftY };
}

/**
 * An association and motion-prediction layer for rendered 2D detection boxes.
 * `observe` receives new detector results; `advance` is called once per render
 * frame. `capturedAt` and `receivedAt` deliberately differ: inference finishes
 * after the camera has moved on, so an observation is projected to the frame
 * currently on screen before it corrects an existing track.
 */
export class DetectionSmoother {
  private tracks: Track[] = [];
  private opt: SmootherOptions;

  constructor(opt: Partial<SmootherOptions> = {}) {
    this.opt = { ...DEFAULTS, ...opt };
  }

  reset(): void {
    this.tracks = [];
  }

  observe(boxes: DetBox[], capturedAt = performance.now(), receivedAt = capturedAt): void {
    const assignments: Array<{ track: number; detection: number; score: number }> = [];

    // Score every legal same-label pair, then allocate best pairs globally.
    // This avoids order-dependent swaps when several people are on camera.
    this.tracks.forEach((track, trackIndex) => {
      const speed = Math.hypot(track.velocity.x, track.velocity.y);
      const elapsed = Math.max(0, capturedAt - track.lastObservationAt);
      const gate = Math.min(this.opt.maxCenterGate, this.opt.centerGate + speed * elapsed * 1.5);
      boxes.forEach((box, detection) => {
        if (box.label !== track.measurement.label) return;
        // Compare at one moment in time. `track.box` has already been advanced
        // by the render loop, while this detector measurement is older.
        const latency = Math.max(0, receivedAt - capturedAt);
        const projected = translateBox(box, track.velocity.x * latency, track.velocity.y * latency);
        const overlap = iou(track.box, projected);
        const distance = centerDistance(track.box, projected);
        if (overlap < this.opt.iouMatch && distance > gate) return;
        assignments.push({ track: trackIndex, detection, score: overlap * 1.4 - distance / Math.max(gate, 0.001) });
      });
    });
    assignments.sort((a, b) => b.score - a.score);

    const usedTracks = new Set<number>();
    const usedDetections = new Set<number>();
    for (const assignment of assignments) {
      if (usedTracks.has(assignment.track) || usedDetections.has(assignment.detection)) continue;
      const track = this.tracks[assignment.track];
      const measurement = boxes[assignment.detection];
      const elapsed = Math.max(16, capturedAt - track.lastObservationAt);
      const previousCentre = centre(track.measurement);
      const nextCentre = centre(measurement);
      const rawVelocity = {
        x: clamp((nextCentre.x - previousCentre.x) / elapsed, -this.opt.maxVelocity, this.opt.maxVelocity),
        y: clamp((nextCentre.y - previousCentre.y) / elapsed, -this.opt.maxVelocity, this.opt.maxVelocity)
      };
      track.velocity = {
        x: track.velocity.x + (rawVelocity.x - track.velocity.x) * this.opt.velocityAlpha,
        y: track.velocity.y + (rawVelocity.y - track.velocity.y) * this.opt.velocityAlpha
      };
      const latency = Math.max(0, receivedAt - capturedAt);
      const currentMeasurement = translateBox(
        measurement,
        track.velocity.x * latency,
        track.velocity.y * latency
      );
      track.box = blendBox(track.box, currentMeasurement, this.opt.correctionAlpha);
      track.measurement = { ...measurement };
      track.lastObservationAt = capturedAt;
      track.hits = track.missed === 0 ? track.hits + 1 : 1;
      track.missed = 0;
      track.confirmed ||= track.hits >= this.opt.minHits;
      usedTracks.add(assignment.track);
      usedDetections.add(assignment.detection);
    }

    this.tracks.forEach((track, index) => {
      if (usedTracks.has(index)) return;
      track.missed++;
      track.hits = 0; // confirmation must be consecutive before first display
    });

    boxes.forEach((box, index) => {
      if (usedDetections.has(index)) return;
      this.tracks.push({
        box: { ...box },
        measurement: { ...box },
        velocity: { x: 0, y: 0 },
        lastObservationAt: capturedAt,
        hits: 1,
        missed: 0,
        confirmed: box.score >= this.opt.immediateScore || this.opt.minHits <= 1
      });
    });

    this.tracks = this.tracks.filter((track) => track.missed <= this.opt.maxMissed);
  }

  advance(dtMs: number): DetBox[] {
    // A suspended tab can report a giant dt; never launch a box across the
    // viewport after it resumes.
    const dt = clamp(dtMs, 0, 80);
    const damping = Math.exp(-dt / this.opt.velocityDecayMs);
    const output: DetBox[] = [];
    for (const track of this.tracks) {
      track.box = translateBox(track.box, track.velocity.x * dt, track.velocity.y * dt);
      track.velocity.x *= damping;
      track.velocity.y *= damping;
      if (track.confirmed) output.push({ ...track.box });
    }
    return output;
  }
}
