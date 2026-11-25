// Sprint 6.3: family tree — parentage recorded at breeding, kept for recent generations.
import { describe, expect, it } from 'vitest';
import {
  breedGenomes,
  brainSpecFromConfig,
  createEvolutionRun,
  createRngStream,
  DEFAULT_CONFIG,
  LINEAGE_GENERATIONS,
  respawnGenomes,
  type LineageTree,
  type Parentage,
  type SimConfig,
} from '../src/index.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);
const QUICK: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 60 },
  },
  evolution: { ...DEFAULT_CONFIG.evolution, benchmarkInterval: 1000 },
};

function genomes(n: number): Float32Array[] {
  return Array.from({ length: n }, (_, i) => new Float32Array(400).fill(i).subarray(0, 383));
}

describe('parentage at breeding (Sprint 6.3)', () => {
  it('records elites, crossovers and copies without changing a single draw', () => {
    const candidates = genomes(6).map((g) => Float32Array.from(g));
    const plain = breedGenomes(
      SPEC,
      candidates,
      10,
      DEFAULT_CONFIG.evolution,
      createRngStream('b'),
    );
    const parentage: Parentage[] = [];
    const tracked = breedGenomes(
      SPEC,
      candidates,
      10,
      DEFAULT_CONFIG.evolution,
      createRngStream('b'),
      parentage,
    );
    expect(tracked).toEqual(plain);
    expect(parentage).toHaveLength(10);
    expect(parentage.slice(0, 2)).toEqual([
      { parents: [0], fromHallOfFame: false },
      { parents: [1], fromHallOfFame: false },
    ]);
    for (const p of parentage.slice(2)) {
      expect(p.parents).toHaveLength(2);
      for (const i of p.parents) expect(i).toBeLessThan(6);
    }
    const noCross = { ...DEFAULT_CONFIG.evolution, crossover: false };
    const copies: Parentage[] = [];
    breedGenomes(SPEC, candidates, 4, noCross, createRngStream('c'), copies);
    expect(copies.slice(2).every((p) => p.parents.length === 1)).toBe(true);
    const fresh: Parentage[] = [];
    breedGenomes(SPEC, [], 3, DEFAULT_CONFIG.evolution, createRngStream('d'), fresh);
    expect(fresh.every((p) => p.parents.length === 0)).toBe(true);
  });

  it('marks a hall-of-fame champion brought back to an extinct tribe', () => {
    const hof = [{ genome: new Float32Array(383).fill(1), benchmarkScore: 900, generation: 4 }];
    const parentage: Parentage[] = [];
    respawnGenomes(
      SPEC,
      hof,
      genomes(3),
      5,
      DEFAULT_CONFIG.evolution,
      createRngStream('r'),
      parentage,
    );
    expect(parentage[0]).toEqual({ parents: [0], fromHallOfFame: true });
    expect(parentage).toHaveLength(5);
    expect(parentage.slice(1).every((p) => !p.fromHallOfFame)).toBe(true);
  });
});

describe('EvolutionRun.championLineage', () => {
  it('traces a champion back through its real parents, with ranks and fitness', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 8, config: QUICK });
    for (let g = 0; g < 4; g++) run.runGeneration();
    const tree = run.championLineage(0, 3)!;
    expect(tree).toMatchObject({ generation: 4, tribeId: 0, rank: 0 });
    expect(tree.fitness).toBe(run.tribes[0]!.history.at(-1)!.maxFitness);
    const levels: LineageTree[][] = [[tree]];
    for (let d = 0; d < 3; d++) levels.push(levels[d]!.flatMap((n) => n.parents));
    expect(levels[1]!.length).toBeGreaterThan(0);
    for (const [d, level] of levels.entries()) {
      for (const node of level) {
        expect(node.generation).toBe(4 - d);
        expect(node.tribeId).toBe(0);
        expect(node.rank).not.toBeNull();
        expect(node.parents.length).toBeLessThanOrEqual(2);
      }
    }
    // Generation 1 are founders: no parents.
    expect(run.championLineage(0, 10)!).toBeDefined();
  });

  it('keeps only the last LINEAGE_GENERATIONS generations', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 8, config: QUICK });
    for (let g = 0; g < LINEAGE_GENERATIONS + 5; g++) run.runGeneration();
    let depth = 0;
    let node: LineageTree | undefined = run.championLineage(1, 100)!;
    while (node !== undefined) {
      depth++;
      node = node.parents[0];
    }
    expect(depth).toBeLessThanOrEqual(LINEAGE_GENERATIONS);
    expect(depth).toBeGreaterThan(LINEAGE_GENERATIONS - 3);
  }, 60_000);
});
