export function computeInterpolationAlpha(
  elapsedMs: number,
  tickDurationMs: number,
  running: boolean,
): number {
  if (
    !running ||
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(tickDurationMs) ||
    tickDurationMs <= 0
  ) {
    return 1;
  }
  return Math.max(0, Math.min(1, elapsedMs / tickDurationMs));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
