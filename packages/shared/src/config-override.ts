import { DEFAULT_CONFIG, type SimConfig } from '@evolution-island/sim-core';

/**
 * Config override files (Sprint 3.4): a partial `SimConfig` as JSON, merged onto a base config
 * (normally `DEFAULT_CONFIG`). Used by `pnpm train --config <file>` for tuning sweeps. Only keys
 * the base config has are accepted, each with the base value's type, so a typo can't silently
 * train with the defaults. A full config (e.g. the one stored in a run's `run.json`) is a valid
 * override too.
 */
export class ConfigOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigOverrideError';
  }
}

/** String fields with a fixed set of values (key paths; `*` = any preset id). */
const ENUM_VALUES: Readonly<Record<string, readonly string[]>> = {
  'evolution.selection': ['truncation', 'tournament'],
  'evolution.extinction': ['respawn', 'battle-royale'],
};

/** Fields that must keep the base value. */
const FIXED_FIELDS = new Set(['presets.*.id']);

/** Whole-number fields (the config hash writes them as 32-bit integers, `hashConfig`). */
const INTEGER_FIELDS = new Set([
  'presets.*.width',
  'presets.*.height',
  'presets.*.tribeCount',
  'presets.*.startingCreaturesPerTribe',
  'presets.*.minTribeSize',
  'presets.*.popCapPerTribe',
  'presets.*.generationLength',
  'presets.*.hotspotCount',
  'map.elevationOctaves',
  'map.moistureOctaves',
  'map.minFairnessWaterTiles',
  'map.targetFairnessWaterTiles',
  'map.maxGenerationAttempts',
  'creature.slowTileMoveCooldown',
  'brain.hiddenNeurons',
  'evolution.tournamentSize',
  'evolution.eliteCount',
  'evolution.hallOfFameSize',
  'evolution.benchmarkInterval',
]);

const MAX_UINT32 = 0xffffffff;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** `presets.small.width` → `presets.*.width`, for the field tables above. */
function fieldPattern(path: readonly string[]): string {
  return path.map((key, i) => (i === 1 && path[0] === 'presets' ? '*' : key)).join('.');
}

function mergeNumber(override: unknown, path: readonly string[]): number {
  const where = path.join('.');
  if (typeof override !== 'number' || !Number.isFinite(override)) {
    throw new ConfigOverrideError(`${where} must be a finite number`);
  }
  if (
    INTEGER_FIELDS.has(fieldPattern(path)) &&
    !(Number.isInteger(override) && override >= 0 && override <= MAX_UINT32)
  ) {
    throw new ConfigOverrideError(`${where} must be a whole number ≥ 0`);
  }
  return override;
}

function mergeString(base: string, override: unknown, path: readonly string[]): string {
  const where = path.join('.');
  const pattern = fieldPattern(path);
  if (typeof override !== 'string' || override.length === 0) {
    throw new ConfigOverrideError(`${where} must be a non-empty string`);
  }
  if (FIXED_FIELDS.has(pattern) && override !== base) {
    throw new ConfigOverrideError(`${where} cannot be changed (it is "${base}")`);
  }
  const allowed = ENUM_VALUES[pattern];
  if (allowed !== undefined && !allowed.includes(override)) {
    throw new ConfigOverrideError(`${where} must be one of ${allowed.join(', ')}`);
  }
  return override;
}

function mergeValue(base: unknown, override: unknown, path: readonly string[]): unknown {
  const where = path.length === 0 ? 'the config override' : path.join('.');
  if (isArray(base)) {
    if (!isArray(override) || override.length !== base.length) {
      throw new ConfigOverrideError(`${where} must be an array of ${base.length} values`);
    }
    return override.map((v, i) => mergeValue(base[i], v, [...path, String(i)]));
  }
  if (isPlainObject(base)) {
    if (!isPlainObject(override)) {
      throw new ConfigOverrideError(`${where} must be an object`);
    }
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (!Object.prototype.hasOwnProperty.call(base, key)) {
        throw new ConfigOverrideError(`unknown config key ${[...path, key].join('.')}`);
      }
      merged[key] = mergeValue(base[key], value, [...path, key]);
    }
    return merged;
  }
  if (typeof base === 'number') return mergeNumber(override, path);
  if (typeof base === 'string') return mergeString(base, override, path);
  if (typeof base === 'boolean') {
    if (typeof override !== 'boolean') {
      throw new ConfigOverrideError(`${where} must be true or false`);
    }
    return override;
  }
  throw new ConfigOverrideError(`${where} cannot be overridden`);
}

/**
 * `base` with `override` merged in: objects key by key (presets one preset at a time), arrays
 * as a whole. The result is a new config; `base` is not changed. Throws `ConfigOverrideError`
 * naming the offending key for unknown keys, wrong types, non-finite numbers, fractional or
 * negative whole-number fields, unknown enum values, wrong array lengths and preset id changes.
 */
export function applyConfigOverride(
  override: unknown,
  base: SimConfig = DEFAULT_CONFIG,
): SimConfig {
  // Checked field by field against `base` above, so the result has SimConfig's shape.
  return mergeValue(base, override, []) as SimConfig;
}

/** Parses a config override file's JSON text and merges it onto `base`. */
export function parseConfigOverride(text: string, base: SimConfig = DEFAULT_CONFIG): SimConfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigOverrideError(`the config override is not valid JSON (${reason})`);
  }
  return applyConfigOverride(json, base);
}
