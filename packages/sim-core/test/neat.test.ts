import { describe, expect, it } from 'vitest';
import {
  Action,
  brainActivations,
  brainPolicyForConfig,
  brainSpecFromConfig,
  compileNeat,
  createEvolutionRun,
  createRngStream,
  createWorld,
  crossoverNeat,
  decodeNeat,
  DEFAULT_CONFIG,
  encodeNeat,
  genomeOps,
  mutateNeat,
  NEAT_FORMAT_VERSION,
  NeatRegistry,
  randomNeatGenome,
  validateGenome,
  validateNeatGenome,
  type BrainSpec,
  type NeatGenome,
  type NeatMutation,
  type SimConfig,
} from '../src/index.js';
import { gaussian } from '../src/genome.js';

const NEAT: SimConfig = {
  ...DEFAULT_CONFIG,
  brain: { ...DEFAULT_CONFIG.brain, kind: 'neat' },
};
const SPEC: BrainSpec = brainSpecFromConfig(NEAT);
const I = SPEC.inputs;
const O = SPEC.outputs;

/** Mutation settings with only the structural mutation under test switched on. */
function mutation(patch: Partial<NeatMutation['neat']>, rate = 0): NeatMutation {
  return {
    rate,
    sigma: 0.5,
    clamp: 4,
    initialWeightRange: 1,
    neat: {
      ...DEFAULT_CONFIG.brain.neat,
      addConnectionRate: 0,
      addNodeRate: 0,
      toggleRate: 0,
      ...patch,
    },
  };
}

/** A tiny genome by hand: 0 → h(I+O) → output 0, and 1 → output 0. */
function handGenome(): NeatGenome {
  const h = I + O;
  return {
    hidden: [{ id: h, splitFrom: 0, splitTo: I }],
    connections: [
      { from: 0, to: I, weight: 0.5, enabled: false },
      { from: 0, to: h, weight: 1, enabled: true },
      { from: 1, to: I, weight: -2, enabled: true },
      { from: h, to: I, weight: 3, enabled: true },
    ],
  };
}

describe('NEAT genomes (Phase 8)', () => {
  it('the config makes a format-2 spec whose hidden size is the hidden-node cap', () => {
    expect(SPEC.formatVersion).toBe(NEAT_FORMAT_VERSION);
    expect(SPEC.hidden).toBe(DEFAULT_CONFIG.brain.neat.maxHiddenNodes);
    expect(SPEC.inputs).toBe(brainSpecFromConfig(DEFAULT_CONFIG).inputs);
    expect(SPEC.outputs).toBe(brainSpecFromConfig(DEFAULT_CONFIG).outputs);
  });

  it('start with every input connected to every output, and round-trip through the flat array', () => {
    const genome = randomNeatGenome(SPEC, createRngStream(1), 1);
    validateGenome(SPEC, genome);
    const decoded = decodeNeat(genome);
    expect(decoded.hidden).toEqual([]);
    expect(decoded.connections).toHaveLength(I * O);
    expect(decoded.connections.every((c) => c.enabled && Math.abs(c.weight) <= 1)).toBe(true);
    expect(encodeNeat(decoded)).toEqual(genome);
  });

  it('run hidden nodes (softsign) before linear outputs, summing enabled connections only', () => {
    const genome = encodeNeat(handGenome());
    const inputs = new Float32Array(I);
    inputs[0] = 2;
    inputs[1] = 0.25;
    const { hidden, outputs } = brainActivations(SPEC, genome, inputs);
    const h = 2 / (1 + 2); // softsign(1 × 2)
    expect(hidden).toEqual([h]);
    expect(outputs[0]).toBe(-2 * 0.25 + 3 * h); // the disabled 0 → output weight is ignored
    expect(outputs.slice(1).every((v) => v === 0)).toBe(true);
    // Compiled once per genome array.
    expect(compileNeat(SPEC, genome)).toBe(compileNeat(SPEC, genome));
  });

  it('refuse malformed genomes, saying why', () => {
    const bad = (edit: (g: NeatGenome) => void, why: RegExp) => {
      const g = handGenome();
      edit(g);
      expect(() => {
        validateNeatGenome(SPEC, encodeNeat(g));
      }).toThrow(why);
    };
    bad(
      (g) => g.connections.push({ from: I + O, to: I + O, weight: 1, enabled: true }),
      /wrong way/,
    );
    bad(
      (g) => g.connections.push({ from: 5, to: 999, weight: 1, enabled: true }),
      /does not exist/,
    );
    bad((g) => g.connections.push({ from: I, to: I + 1, weight: 1, enabled: true }), /wrong way/);
    bad((g) => g.connections.push({ from: 0, to: I + O, weight: 2, enabled: true }), /sorted/);
    bad((g) => (g.connections[1]!.weight = Number.NaN), /finite/);
    // A cycle between two hidden nodes.
    bad((g) => {
      const h2 = I + O + 1;
      g.hidden.push({ id: h2, splitFrom: 1, splitTo: I });
      g.connections.push({ from: h2, to: I + O, weight: 1, enabled: true });
      g.connections.push({ from: I + O, to: h2, weight: 1, enabled: false });
      g.connections.sort((a, b) => (a.from !== b.from ? a.from - b.from : a.to - b.to));
    }, /cycle/);
    const tooMany: NeatGenome = {
      hidden: Array.from({ length: SPEC.hidden + 1 }, (_, k) => ({
        id: I + O + k,
        splitFrom: 0,
        splitTo: I,
      })),
      connections: [],
    };
    expect(() => {
      validateNeatGenome(SPEC, encodeNeat(tooMany));
    }).toThrow(/hidden nodes/);
    expect(() => {
      validateNeatGenome(SPEC, new Float32Array([0, 1, 0]));
    }).toThrow(/length/);
    const flags = encodeNeat(handGenome());
    flags[flags.length - 1] = 0.5;
    expect(() => {
      validateNeatGenome(SPEC, flags);
    }).toThrow(/0 or 1/);
  });

  it('an added node splits an enabled connection: a→n weight 1, n→b the old weight, a→b off', () => {
    const start = randomNeatGenome(SPEC, createRngStream(2), 1);
    const child = mutateNeat(
      SPEC,
      start,
      createRngStream(3),
      mutation({ addNodeRate: 1 }),
      new NeatRegistry(SPEC, [start]),
      gaussian,
    );
    validateGenome(SPEC, child);
    const g = decodeNeat(child);
    expect(g.hidden).toHaveLength(1);
    const node = g.hidden[0]!;
    expect(node.id).toBe(I + O);
    const find = (from: number, to: number) =>
      g.connections.find((c) => c.from === from && c.to === to)!;
    const split = decodeNeat(start).connections.find(
      (c) => c.from === node.splitFrom && c.to === node.splitTo,
    )!;
    expect(find(node.splitFrom, node.splitTo).enabled).toBe(false);
    expect(find(node.splitFrom, node.id)).toMatchObject({ weight: 1, enabled: true });
    expect(find(node.id, node.splitTo)).toMatchObject({ weight: split.weight, enabled: true });
  });

  it('the same split gets the same node id in every genome of a run (historical markings)', () => {
    const a = encodeNeat(handGenome());
    const registry = new NeatRegistry(SPEC, [a]);
    expect(registry.idFor(0, I)).toBe(I + O); // a's node
    expect(registry.idFor(1, I)).toBe(I + O + 1); // new: the next free id
    expect(registry.idFor(1, I)).toBe(I + O + 1);
  });

  it('structural mutations never break a genome or close a cycle (200 rounds, every rate on)', () => {
    const rng = createRngStream(4);
    let genome = randomNeatGenome(SPEC, rng, 1);
    const m = mutation({ addConnectionRate: 1, addNodeRate: 1, toggleRate: 0.05 }, 0.3);
    for (let round = 0; round < 200; round++) {
      genome = mutateNeat(SPEC, genome, rng, m, new NeatRegistry(SPEC, [genome]), gaussian);
      validateGenome(SPEC, genome);
    }
    const g = decodeNeat(genome);
    expect(g.hidden.length).toBe(SPEC.hidden); // grew to the cap, never past it
    expect(g.connections.length).toBeGreaterThan(I * O);
    expect(g.connections.length).toBeLessThanOrEqual(DEFAULT_CONFIG.brain.neat.maxConnections);
    expect(g.connections.every((c) => Math.abs(c.weight) <= 4)).toBe(true);
  });

  it("crossover keeps the fitter parent's structure; matching genes come from either parent", () => {
    const fitter = encodeNeat(handGenome());
    const other: NeatGenome = {
      hidden: [],
      connections: [
        { from: 0, to: I, weight: 9, enabled: true },
        { from: 1, to: I, weight: 7, enabled: true },
        { from: 2, to: I, weight: 5, enabled: true }, // only in the other parent: dropped
      ],
    };
    const seen = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const child = decodeNeat(crossoverNeat(fitter, encodeNeat(other), createRngStream(seed)));
      expect(child.hidden).toEqual(handGenome().hidden);
      expect(child.connections.map((c) => `${c.from}:${c.to}`)).toEqual(
        handGenome().connections.map((c) => `${c.from}:${c.to}`),
      );
      seen.add(child.connections.find((c) => c.from === 1)!.weight);
      // Unmatched genes always come from the fitter parent.
      expect(child.connections.find((c) => c.from === I + O)!.weight).toBe(3);
    }
    expect([...seen].sort()).toEqual([-2, 7]);
  });

  it('drive creatures through the normal brain policy (memory included)', () => {
    const genome = randomNeatGenome(SPEC, createRngStream(5), 1);
    const world = createWorld({
      preset: 'small',
      seed: 3,
      config: NEAT,
      policy: brainPolicyForConfig(NEAT, () => genome),
    });
    for (let i = 0; i < 20; i++) world.tick();
    const alive = world.creatures.filter((c) => c.alive);
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.some((c) => c.memory.some((v) => v !== 0))).toBe(true);
    expect(alive.some((c) => c.lastAction !== Action.STAY)).toBe(true);
  });

  it('genomeOps: the MLP operators draw exactly as before; NEAT operators make NEAT genomes', () => {
    const spec = brainSpecFromConfig(DEFAULT_CONFIG);
    const ops = genomeOps(spec, DEFAULT_CONFIG.evolution, DEFAULT_CONFIG.brain);
    const r1 = createRngStream(6);
    const r2 = createRngStream(6);
    expect(ops.random(r1).length).toBe(383);
    ops.random(r2);
    expect(r1.getState()).toEqual(r2.getState());
    const neatOps = genomeOps(SPEC, NEAT.evolution, NEAT.brain);
    const g = neatOps.random(createRngStream(7));
    validateGenome(SPEC, g);
    validateGenome(SPEC, neatOps.mutate(g, createRngStream(8)));
  });
});

describe('NEAT evolution runs (Phase 8)', () => {
  const QUICK: SimConfig = {
    ...NEAT,
    presets: {
      ...NEAT.presets,
      small: { ...NEAT.presets.small, generationLength: 150 },
    },
    brain: {
      ...NEAT.brain,
      neat: { ...NEAT.brain.neat, addConnectionRate: 0.5, addNodeRate: 0.3 },
    },
    evolution: { ...NEAT.evolution, benchmarkInterval: 2 },
  };

  it('grow hidden nodes, and a resumed run continues exactly (node ids need no saved state)', () => {
    const run = createEvolutionRun({ preset: 'small', seed: 11, config: QUICK });
    while (run.generation < 4) run.runGeneration();
    const state = run.captureState();
    const resumed = createEvolutionRun({ preset: 'small', seed: 11, config: QUICK, resume: state });
    expect(resumed.hash()).toBe(run.hash());
    while (run.generation < 7) {
      run.runGeneration();
      resumed.runGeneration();
      expect(resumed.hash()).toBe(run.hash());
    }
    const hidden = run.world.creatures.map((c) => decodeNeat(c.genome).hidden.length);
    expect(Math.max(...hidden)).toBeGreaterThan(0);
    // Every genome alive is valid, and so is every benchmarked champion.
    for (const c of run.world.creatures) validateGenome(SPEC, c.genome);
    for (const t of run.tribes) for (const e of t.hallOfFame) validateGenome(SPEC, e.genome);
  }, 60_000);
});
