import {
  brainSpecFromConfig,
  createZeroGenome,
  DEFAULT_CONFIG,
  hashConfig,
  SIM_VERSION,
  weightCount,
} from '@evolution-island/sim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertGenomeCompatible,
  GENOME_FILE_FORMAT,
  GenomeFileError,
  parseGenome,
  serializeGenome,
  type GenomeFileErrorReason,
} from '../src/index.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);
const CONFIG_HASH = hashConfig(DEFAULT_CONFIG);

function expectReason(fn: () => unknown, reason: GenomeFileErrorReason): void {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GenomeFileError);
    expect((error as GenomeFileError).reason).toBe(reason);
    return;
  }
  expect.fail(`expected a GenomeFileError (${reason})`);
}

function validFile(): Record<string, unknown> {
  return JSON.parse(serializeGenome(SPEC, createZeroGenome(SPEC), CONFIG_HASH)) as Record<
    string,
    unknown
  >;
}

describe('genome files', () => {
  it('carry the format, simVersion, config hash and brain spec', () => {
    const file = validFile();
    expect(file['format']).toBe(GENOME_FILE_FORMAT);
    expect(file['simVersion']).toBe(SIM_VERSION);
    expect(file['configHash']).toBe(CONFIG_HASH);
    expect(file['brain']).toEqual(SPEC);
    expect(file['weights']).toHaveLength(weightCount(SPEC));
  });

  it('round-trip every float32 weight exactly', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ noNaN: true, noDefaultInfinity: true }), {
          minLength: weightCount(SPEC),
          maxLength: weightCount(SPEC),
        }),
        (values) => {
          const weights = Float32Array.from(values);
          const loaded = parseGenome(serializeGenome(SPEC, weights, CONFIG_HASH));
          // -0 is written as 0; it computes identically (sums start at +0).
          const expected = Array.from(weights, (w) => (w === 0 ? 0 : w));
          expect(Array.from(loaded.weights)).toEqual(expected);
          expect(loaded.brain).toEqual(SPEC);
          expect(loaded.simVersion).toBe(SIM_VERSION);
          expect(loaded.configHash).toBe(CONFIG_HASH);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refuses to write invalid genomes', () => {
    const genome = createZeroGenome(SPEC);
    genome[3] = Number.NaN;
    expect(() => serializeGenome(SPEC, genome, CONFIG_HASH)).toThrow(RangeError);
    expect(() => serializeGenome(SPEC, new Float32Array(10), CONFIG_HASH)).toThrow(RangeError);
    expect(() => serializeGenome(SPEC, createZeroGenome(SPEC), 'not-a-hash')).toThrow(RangeError);
  });

  it.each([
    ['invalid JSON', () => '{nope'],
    ['a non-object', () => '[1, 2]'],
    ['the wrong format', () => JSON.stringify({ ...validFile(), format: 'something-else' })],
    ['a newer fileVersion', () => JSON.stringify({ ...validFile(), fileVersion: 2 })],
    ['a missing simVersion', () => JSON.stringify({ ...validFile(), simVersion: undefined })],
    ['a missing configHash', () => JSON.stringify({ ...validFile(), configHash: undefined })],
    ['a malformed configHash', () => JSON.stringify({ ...validFile(), configHash: 'ABC' })],
    ['a missing brain', () => JSON.stringify({ ...validFile(), brain: null })],
    [
      'an invalid brain spec',
      () => JSON.stringify({ ...validFile(), brain: { ...SPEC, hidden: 0 } }),
    ],
    ['too few weights', () => JSON.stringify({ ...validFile(), weights: [1, 2, 3] })],
    [
      'a non-numeric weight',
      () =>
        JSON.stringify({
          ...validFile(),
          weights: ['x', ...new Array<number>(weightCount(SPEC) - 1).fill(0)],
        }),
    ],
    [
      'a NaN weight (written as null)',
      () =>
        JSON.stringify({
          ...validFile(),
          weights: [null, ...new Array<number>(weightCount(SPEC) - 1).fill(0)],
        }),
    ],
    [
      'a weight beyond float32 range',
      () =>
        JSON.stringify({
          ...validFile(),
          weights: [1e300, ...new Array<number>(weightCount(SPEC) - 1).fill(0)],
        }),
    ],
  ])('rejects %s as malformed', (_label, makeText) => {
    expectReason(() => parseGenome(makeText()), 'malformed');
  });

  it('refuses genomes for another brain shape, simVersion or (when asked) config', () => {
    const loaded = parseGenome(serializeGenome(SPEC, createZeroGenome(SPEC), CONFIG_HASH));
    expect(() => {
      assertGenomeCompatible(loaded, { brain: SPEC });
    }).not.toThrow();
    expect(() => {
      assertGenomeCompatible(loaded, { brain: SPEC, configHash: CONFIG_HASH });
    }).not.toThrow();

    expectReason(() => {
      assertGenomeCompatible(loaded, { brain: { ...SPEC, hidden: 13 } });
    }, 'brain-spec-mismatch');
    expectReason(() => {
      assertGenomeCompatible(loaded, { brain: SPEC, simVersion: SIM_VERSION + 1 });
    }, 'sim-version-mismatch');
    expectReason(() => {
      assertGenomeCompatible(loaded, { brain: SPEC, configHash: '0123456789abcdef' });
    }, 'config-hash-mismatch');
  });
});
