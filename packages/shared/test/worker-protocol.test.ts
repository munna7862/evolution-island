import { createWorld, SIM_VERSION } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  BASE_TICKS_PER_SECOND,
  buildReadyMessage,
  buildSimSnapshot,
  countTribePopulations,
  CREATURE_STRIDE_BYTES,
  extractTransferableMapData,
  formatSpeed,
  isSimSpeed,
  packCreatureSnapshot,
  SIM_SPEEDS,
  speedToTicksPerSecond,
} from '../src/index.js';

describe('worker-protocol helpers', () => {
  it('converts, formats, and validates simulation speeds', () => {
    expect(BASE_TICKS_PER_SECOND).toBe(10);
    expect(SIM_SPEEDS).toEqual([1, 2, 5, 20, 'max']);
    expect(speedToTicksPerSecond(1)).toBe(10);
    expect(speedToTicksPerSecond(2)).toBe(20);
    expect(speedToTicksPerSecond(5)).toBe(50);
    expect(speedToTicksPerSecond(20)).toBe(200);
    expect(speedToTicksPerSecond('max')).toBe(Number.POSITIVE_INFINITY);

    expect(formatSpeed(1)).toBe('1×');
    expect(formatSpeed(20)).toBe('20×');
    expect(formatSpeed('max')).toBe('Max');

    for (const s of SIM_SPEEDS) {
      expect(isSimSpeed(s)).toBe(true);
    }
    expect(isSimSpeed(3)).toBe(false);
    expect(isSimSpeed('fast')).toBe(false);
    expect(isSimSpeed(null)).toBe(false);
  });

  it('packs living creatures into a single aligned ArrayBuffer and excludes dead ones', () => {
    const world = createWorld({ preset: 'small', seed: 42 });
    world.tick();
    const initialLiving = world.livingCount;

    // Kill the first creature and verify it is excluded from the packed snapshot.
    const victim = world.creatures[0]!;
    victim.alive = false;
    world.livingCount--;

    const buf = packCreatureSnapshot(world);
    expect(buf.count).toBe(initialLiving - 1);
    expect(buf.buffer.byteLength).toBe(buf.count * CREATURE_STRIDE_BYTES);
    expect(buf.ids.buffer).toBe(buf.buffer);
    expect(buf.prevX.buffer).toBe(buf.buffer);
    expect(buf.prevY.buffer).toBe(buf.buffer);
    expect(buf.x.buffer).toBe(buf.buffer);
    expect(buf.y.buffer).toBe(buf.buffer);
    expect(buf.tribeIds.buffer).toBe(buf.buffer);
    expect(buf.lastMoveDir.buffer).toBe(buf.buffer);
    expect(buf.healthRatio.buffer).toBe(buf.buffer);
    expect(Array.from(buf.ids)).not.toContain(victim.id);

    // Health ratio clamps cleanly to [0, 255].
    const second = world.creatures[1]!;
    second.health = world.config.creature.maxHealth * 2;
    const clampedBuf = packCreatureSnapshot(world);
    expect(clampedBuf.healthRatio[0]).toBe(255);
  });

  it('handles empty worlds and counts tribe populations', () => {
    const emptyWorld = createWorld({ preset: 'small', seed: 7, populate: false });
    const emptyBuf = packCreatureSnapshot(emptyWorld);
    expect(emptyBuf.count).toBe(0);
    expect(emptyBuf.buffer.byteLength).toBe(0);
    expect(countTribePopulations(emptyWorld)).toEqual([0, 0]);

    const fullWorld = createWorld({ preset: 'medium', seed: 7 });
    expect(countTribePopulations(fullWorld)).toEqual([50, 50, 50, 50]);
  });

  it('clones map terrain arrays for transfer without aliasing worker buffers', () => {
    const world = createWorld({ preset: 'small', seed: 12 });
    const transferred = extractTransferableMapData(world);

    expect(transferred.biomes).not.toBe(world.map.biomes);
    expect(transferred.maxFood).not.toBe(world.map.maxFood);
    expect(transferred.biomes).toEqual(world.map.biomes);
    expect(transferred.maxFood).toEqual(world.map.maxFood);
    expect(transferred.hash).toBe(world.map.hash);
  });

  it('builds snapshots with optional worldHash computation', () => {
    const world = createWorld({ preset: 'small', seed: 42 });
    world.tick();

    const fastSnap = buildSimSnapshot(world, {
      runId: 3,
      actualTicksPerSec: 10,
      running: true,
      speed: 1,
      tickDurationMs: 100,
      includeHash: false,
    });
    expect(fastSnap.worldHash).toBeNull();
    expect(fastSnap.tick).toBe(1);
    expect(fastSnap.tribePopulations).toEqual([25, 25]);

    const hashedSnap = buildSimSnapshot(world, {
      runId: 3,
      ackSeq: 9,
      actualTicksPerSec: 0,
      running: false,
      speed: 1,
      tickDurationMs: 0,
      includeHash: true,
    });
    expect(hashedSnap.ackSeq).toBe(9);
    expect(hashedSnap.worldHash).toBe(world.hash());

    const ready = buildReadyMessage(world, {
      runId: 4,
      ackSeq: 2,
      actualTicksPerSec: 0,
      running: false,
      speed: 2,
      tickDurationMs: 0,
      includeHash: true,
    });
    expect(ready.type).toBe('ready');
    expect(ready.simVersion).toBe(SIM_VERSION);
    expect(ready.snapshot.ackSeq).toBe(2);
    expect(ready.map.hash).toBe(world.map.hash);
  });

  it('preserves prevX/prevY/lastMoveDir and defends against NaN health or mismatched livingCount', () => {
    const world = createWorld({ preset: 'small', seed: 42 });
    const c0 = world.creatures[0]!;
    c0.prevX = 11;
    c0.prevY = 22;
    c0.lastMoveDir = -1;
    c0.health = Number.NaN;

    // Simulate out-of-sync livingCount (both too low and too high).
    world.livingCount = 5;
    const resyncLow = packCreatureSnapshot(world);
    expect(resyncLow.count).toBe(50);
    expect(resyncLow.buffer.byteLength).toBe(50 * CREATURE_STRIDE_BYTES);
    expect(resyncLow.prevX[0]).toBe(11);
    expect(resyncLow.prevY[0]).toBe(22);
    expect(resyncLow.lastMoveDir[0]).toBe(-1);
    expect(resyncLow.healthRatio[0]).toBe(0);

    world.livingCount = 120;
    const resyncHigh = packCreatureSnapshot(world);
    expect(resyncHigh.count).toBe(50);
    expect(resyncHigh.buffer.byteLength).toBe(50 * CREATURE_STRIDE_BYTES);
  });
});
