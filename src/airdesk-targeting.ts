export interface TargetRect<T> {
  target: T;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function distanceToRect(
  point: { x: number; y: number },
  rect: Pick<TargetRect<unknown>, 'left' | 'top' | 'right' | 'bottom'>
): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}

/** Selects at most one nearby target, mirroring the Bubble Cursor contract. */
export function nearestTargetWithin<T>(
  point: { x: number; y: number },
  targets: TargetRect<T>[],
  radius: number
): T | null {
  let best: { target: T; distance: number } | null = null;
  for (const candidate of targets) {
    const distance = distanceToRect(point, candidate);
    if (distance > radius || (best && distance >= best.distance)) continue;
    best = { target: candidate.target, distance };
  }
  return best?.target ?? null;
}
