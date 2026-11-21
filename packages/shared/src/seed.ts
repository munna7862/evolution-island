import type { Seed } from '@evolution-island/sim-core';

const CANONICAL_INT_PATTERN = /^-?(?:0|[1-9]\d*)$/;

/**
 * Parses a raw seed string (from URL query params, UI input, or CLI flags) into a
 * canonical `Seed` (`number` for safe base-10 integers, otherwise `string`).
 * Keeps viewer URLs/inputs and trainer CLI flags consistent with sim-core's `normalizeSeed`.
 */
export function parseSeed(raw: string, fallback: Seed = 42): Seed {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  if (CANONICAL_INT_PATTERN.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed)) {
      return parsed === 0 ? 0 : parsed;
    }
  }
  return trimmed;
}
