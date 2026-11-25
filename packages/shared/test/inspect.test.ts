import {
  brainPolicyForConfig,
  brainSpecFromConfig,
  createBrainScratch,
  createWorld,
  DEFAULT_CONFIG,
  forwardPass,
  hashWorld,
  randomGenome,
  createRngStream,
  readSensors,
  SENSOR_COUNT,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { actionName, currentChampion, inspectCreature } from '../src/index.js';

const SPEC = brainSpecFromConfig(DEFAULT_CONFIG);

function brainWorld() {
  const rng = createRngStream('inspect');
  const genomes = [0, 1, 2].map(() => randomGenome(SPEC, rng, 1));
  const world = createWorld({
    preset: 'small',
    seed: 42,
    populate: false,
    policy: brainPolicyForConfig(DEFAULT_CONFIG, (c) => c.genome),
  });
  world.startGeneration(1, [
    { tribeId: 0, genomes: [genomes[0]!, genomes[1]!] },
    { tribeId: 1, genomes: [genomes[2]!] },
  ]);
  for (let t = 0; t < 30; t++) world.tick();
  return world;
}

describe('inspectCreature (Sprint 6.2)', () => {
  it('shows the brain inputs and activations the policy would use, without changing the world', () => {
    const world = brainWorld();
    const creature = world.creatures[0]!;
    const before = hashWorld(world);
    const inspection = inspectCreature(world, creature, true);
    expect(hashWorld(world)).toBe(before);

    const inputs = new Float32Array(SPEC.inputs);
    readSensors(world, creature, inputs);
    inputs.set(creature.memory, SENSOR_COUNT);
    const scratch = createBrainScratch(SPEC);
    const outputs = Array.from(forwardPass(SPEC, creature.genome, inputs, scratch));
    expect(inspection.inputs.map((v) => v.value)).toEqual(Array.from(inputs));
    expect(inspection.inputs[0]!.name).toBe('energy');
    expect(inspection.inputs.at(-1)!.name).toBe('memory 2');
    expect(inspection.hidden).toEqual(Array.from(scratch.hidden));
    expect(inspection.outputs!.map((o) => o.value)).toEqual(outputs);
    expect(inspection.outputs!.map((o) => o.name).slice(0, 2)).toEqual(['MOVE_N', 'MOVE_E']);
    expect(inspection).toMatchObject({ id: 0, tribeId: 0, age: creature.age, x: creature.x });
    expect(inspection.lastAction).toBe(actionName(creature.lastAction));
  });

  it('shows sensors only for a creature without a brain', () => {
    const world = createWorld({ preset: 'small', seed: 3 });
    world.tick();
    const inspection = inspectCreature(world, world.creatures[0]!, false);
    expect(inspection.inputs).toHaveLength(SENSOR_COUNT);
    expect(inspection.hidden).toBeNull();
    expect(inspection.outputs).toBeNull();
  });
});

describe('currentChampion', () => {
  it('is the living tribe member with the best fitness so far, ties to the lowest id', () => {
    const world = brainWorld();
    const [a, b] = world.creatures.filter((c) => c.tribeId === 0);
    a!.stats.ticksAlive = 10;
    b!.stats.ticksAlive = 10;
    expect(currentChampion(world, 0)?.id).toBe(a!.id);
    b!.stats.foodEaten = 5;
    expect(currentChampion(world, 0)?.id).toBe(b!.id);
    b!.alive = false;
    expect(currentChampion(world, 0)?.id).toBe(a!.id);
    expect(currentChampion(world, 7)).toBeNull();
  });
});
