import {
  brainSpecFromConfig,
  createEvolutionRun,
  DEFAULT_CONFIG,
  hashConfig,
  SIM_VERSION,
  weightCount,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  checkpointDirName,
  checkpointStart,
  GenomeFileError,
  hallOfFameFileName,
  parseCheckpoint,
  parseGenome,
  parseRunManifest,
  RunFileError,
  serializeCheckpoint,
  serializeGenome,
  serializeRunManifest,
  type CheckpointContent,
  type LoadedGenome,
  type RunFileErrorReason,
} from '../src/index.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);
const CONFIG_HASH = hashConfig(DEFAULT_CONFIG);
const EXPECTED = { brain: SPEC, configHash: CONFIG_HASH };

function expectReason(fn: () => unknown, reason: RunFileErrorReason): void {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RunFileError);
    expect((error as RunFileError).reason).toBe(reason);
    return;
  }
  expect.fail(`expected a RunFileError (${reason})`);
}

function genome(value: number): LoadedGenome {
  const weights = new Float32Array(weightCount(SPEC)).fill(value);
  return parseGenome(serializeGenome(SPEC, weights, CONFIG_HASH));
}

function content(): CheckpointContent {
  return {
    configHash: CONFIG_HASH,
    preset: 'small',
    seed: 42,
    generation: 20,
    tribes: [
      {
        tribeId: 0,
        alive: true,
        size: 5,
        hallOfFame: [
          { rank: 2, generation: 10, benchmarkScore: 600.5, file: hallOfFameFileName(0, 2) },
          { rank: 1, generation: 20, benchmarkScore: 750.25, file: hallOfFameFileName(0, 1) },
        ],
      },
      {
        tribeId: 1,
        alive: true,
        size: 3,
        hallOfFame: [
          { rank: 1, generation: 1, benchmarkScore: 500, file: hallOfFameFileName(1, 1) },
        ],
      },
    ],
  };
}

function genomes(): Map<string, LoadedGenome> {
  return new Map([
    [hallOfFameFileName(0, 1), genome(0.5)],
    [hallOfFameFileName(0, 2), genome(-0.5)],
    [hallOfFameFileName(1, 1), genome(0.25)],
  ]);
}

function edited(edit: (file: Record<string, unknown>) => void): string {
  const file = JSON.parse(serializeCheckpoint(content())) as Record<string, unknown>;
  edit(file);
  return JSON.stringify(file);
}

describe('run file names', () => {
  it('pads checkpoint folders so they sort by generation', () => {
    expect(checkpointDirName(1)).toBe('gen-0001');
    expect(checkpointDirName(500)).toBe('gen-0500');
    expect(checkpointDirName(12345)).toBe('gen-12345');
    expect(hallOfFameFileName(3, 1)).toBe('tribe-3-hof-1.genome.json');
  });
});

describe('checkpoint files', () => {
  it('round-trip, stamped with this build, hall of fame sorted by rank', () => {
    const parsed = parseCheckpoint(serializeCheckpoint(content()));
    expect(parsed.simVersion).toBe(SIM_VERSION);
    expect(parsed.configHash).toBe(CONFIG_HASH);
    expect(parsed.generation).toBe(20);
    expect(parsed.tribes[0]!.hallOfFame.map((e) => e.rank)).toEqual([1, 2]);
    expect(parsed.tribes[0]!.hallOfFame[0]!.benchmarkScore).toBe(750.25);
  });

  it('keeps string seeds', () => {
    const parsed = parseCheckpoint(serializeCheckpoint({ ...content(), seed: 'island' }));
    expect(parsed.seed).toBe('island');
  });

  it('refuses malformed files', () => {
    const bad = [
      'not json',
      '[]',
      edited((f) => (f['format'] = 'evolution-island/genome')),
      edited((f) => (f['fileVersion'] = 2)),
      edited((f) => (f['preset'] = 'gigantic')),
      edited((f) => (f['generation'] = 0)),
      edited((f) => (f['configHash'] = 'XYZ')),
      edited((f) => (f['seed'] = 1.5)),
      edited((f) => (f['tribes'] = {})),
      edited((f) => {
        const tribes = f['tribes'] as Record<string, unknown>[];
        tribes.push({ ...tribes[0]! });
      }),
      edited((f) => {
        const tribe = (f['tribes'] as Record<string, unknown>[])[0]!;
        (tribe['hallOfFame'] as Record<string, unknown>[])[0]!['file'] = '../escape.json';
      }),
      edited((f) => {
        const tribe = (f['tribes'] as Record<string, unknown>[])[0]!;
        (tribe['hallOfFame'] as Record<string, unknown>[])[0]!['benchmarkScore'] = null;
      }),
    ];
    for (const text of bad) {
      expectReason(() => parseCheckpoint(text), 'malformed');
    }
  });
});

describe('run manifest', () => {
  it('round-trips what the viewer needs and ignores the stored config', () => {
    const text = serializeRunManifest({
      configHash: CONFIG_HASH,
      brain: SPEC,
      preset: 'medium',
      seed: 7,
      generations: 500,
      saveEvery: 10,
      completedGenerations: 20,
      checkpoints: [1, 10, 20],
      timing: { elapsedSeconds: 3.5, ticks: 40_000, ticksPerSecond: 11_428 },
      config: DEFAULT_CONFIG,
    });
    expect(parseRunManifest(text)).toEqual({
      simVersion: SIM_VERSION,
      configHash: CONFIG_HASH,
      preset: 'medium',
      seed: 7,
      generations: 500,
      completedGenerations: 20,
      checkpoints: [1, 10, 20],
    });
    expectReason(
      () => parseRunManifest(text.replace('"checkpoints": [', '"checkpoints": [0,')),
      'malformed',
    );
  });
});

describe('checkpointStart (what the viewer plays)', () => {
  it('gives every tribe its saved size, cycling through its hall of fame best first', () => {
    const start = checkpointStart(
      parseCheckpoint(serializeCheckpoint(content())),
      genomes(),
      EXPECTED,
    );
    expect(start.generation).toBe(20);
    const [t0, t1] = start.tribes;
    expect(t0!.genomes.map((g) => g[0])).toEqual([0.5, -0.5, 0.5, -0.5, 0.5]);
    expect(t1!.genomes.map((g) => g[0])).toEqual([0.25, 0.25, 0.25]);
    expect(t0!.hallOfFame.map((e) => [e.generation, e.benchmarkScore])).toEqual([
      [20, 750.25],
      [10, 600.5],
    ]);
  });

  it('starts an EvolutionRun that plays exactly those genomes', () => {
    const start = checkpointStart(
      parseCheckpoint(serializeCheckpoint(content())),
      genomes(),
      EXPECTED,
    );
    const run = createEvolutionRun({ preset: 'small', seed: 42, start });
    expect(run.generation).toBe(20);
    expect(run.tribes.map((t) => t.size)).toEqual([5, 3]);
    const firstOfTribe1 = run.world.creatures.find((c) => c.tribeId === 1)!;
    expect(firstOfTribe1.genome[0]).toBe(0.25);
  });

  it('gives an eliminated tribe no creatures', () => {
    const c = content();
    const checkpoint = parseCheckpoint(
      serializeCheckpoint({ ...c, tribes: [c.tribes[0]!, { ...c.tribes[1]!, alive: false }] }),
    );
    expect(checkpointStart(checkpoint, genomes(), EXPECTED).tribes[1]!.genomes).toEqual([]);
  });

  it('refuses other sim versions, other configs, missing and incompatible genome files', () => {
    const checkpoint = parseCheckpoint(serializeCheckpoint(content()));
    expectReason(
      () => checkpointStart({ ...checkpoint, simVersion: SIM_VERSION - 1 }, genomes(), EXPECTED),
      'sim-version-mismatch',
    );
    expectReason(
      () => checkpointStart({ ...checkpoint, configHash: '0123456789abcdef' }, genomes(), EXPECTED),
      'config-hash-mismatch',
    );
    const missing = genomes();
    missing.delete(hallOfFameFileName(0, 2));
    expectReason(() => checkpointStart(checkpoint, missing, EXPECTED), 'missing-file');

    const wrongConfig = genomes();
    const weights = new Float32Array(weightCount(SPEC));
    wrongConfig.set(
      hallOfFameFileName(1, 1),
      parseGenome(serializeGenome(SPEC, weights, '0123456789abcdef')),
    );
    expect(() => checkpointStart(checkpoint, wrongConfig, EXPECTED)).toThrow(GenomeFileError);
  });

  it('refuses a living tribe without hall of fame', () => {
    const c = content();
    const checkpoint = parseCheckpoint(
      serializeCheckpoint({ ...c, tribes: [c.tribes[0]!, { ...c.tribes[1]!, hallOfFame: [] }] }),
    );
    expectReason(() => checkpointStart(checkpoint, genomes(), EXPECTED), 'malformed');
  });
});
