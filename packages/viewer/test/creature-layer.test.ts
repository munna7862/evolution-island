import { packCreatureSnapshot } from '@evolution-island/shared';
import { createWorld } from '@evolution-island/sim-core';
import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TILE_WORLD_SIZE } from '../src/renderer/camera.js';
import { CreatureLayer, RIPPLE_PERIOD_MS } from '../src/renderer/creature-layer.js';

describe('CreatureLayer', () => {
  it('pools sprites across growing/shrinking snapshots, interpolates positions, and cleans up', () => {
    const layer = new CreatureLayer(
      () => Texture.EMPTY,
      () => Texture.EMPTY,
    );

    const world = createWorld({ preset: 'small', seed: 42 }); // 50 creatures
    const snap1 = packCreatureSnapshot(world);
    layer.setSnapshot(snap1, 1000, 100, true);
    expect(layer.getRenderedCount()).toBe(50);
    expect(layer.container.children).toHaveLength(50);

    // Move first creature and verify smooth interpolation across frames.
    const c0 = world.creatures[0]!;
    c0.prevX = 10;
    c0.prevY = 20;
    c0.x = 11;
    c0.y = 20;
    c0.health = world.config.creature.maxHealth * 0.5;
    const snap2 = packCreatureSnapshot(world);
    layer.setSnapshot(snap2, 1100, 100, true);

    const firstSprite = layer.container.children[0]!;
    expect(firstSprite.position.x).toBeCloseTo(10.5 * TILE_WORLD_SIZE, 4);

    const needsMore = layer.updateInterpolation(1150);
    expect(needsMore).toBe(true);
    expect(layer.didPositionChange()).toBe(true);
    expect(firstSprite.position.x).toBeCloseTo(11.0 * TILE_WORLD_SIZE, 4);

    const done = layer.updateInterpolation(1200);
    expect(done).toBe(true); // final snap changed position
    expect(firstSprite.position.x).toBeCloseTo(11.5 * TILE_WORLD_SIZE, 4);
    expect(layer.updateInterpolation(1216)).toBe(false);

    // Grow pool (200 creatures) then shrink back to 0 without recreating pool entries.
    const mediumWorld = createWorld({ preset: 'medium', seed: 42 });
    const medSnap = packCreatureSnapshot(mediumWorld);
    layer.setSnapshot(medSnap, 1300, 0, false);
    expect(layer.getRenderedCount()).toBe(200);
    expect(layer.container.children).toHaveLength(200);

    const emptyWorld = createWorld({ preset: 'small', seed: 1, populate: false });
    const emptySnap = packCreatureSnapshot(emptyWorld);
    layer.setSnapshot(emptySnap, 1400, 0, false);
    expect(layer.getRenderedCount()).toBe(0);
    expect(layer.container.children.every((child) => !child.visible)).toBe(true);

    layer.destroy();
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws a fading, growing ripple ring around each calling creature (Sprint 4.3)', () => {
    const layer = new CreatureLayer(
      () => Texture.EMPTY,
      () => Texture.EMPTY,
    );
    const world = createWorld({ preset: 'small', seed: 42 });
    world.creatures[3]!.call = 1;
    world.creatures[7]!.call = 0.5;
    layer.setSnapshot(packCreatureSnapshot(world), 1000, 100, false);
    expect(layer.getRippleCount()).toBe(2);
    const rings = layer.rippleContainer.children.filter((r) => r.visible);
    expect(rings).toHaveLength(2);
    const creature3 = layer.container.children[3]!;
    expect(rings[0]!.position.x).toBe(creature3.position.x);
    expect(rings[0]!.alpha).toBeCloseTo(1, 6); // phase 0: full strength
    expect(rings[1]!.alpha).toBeCloseTo(128 / 255, 6);
    // Half a period later: bigger and half faded; ripples keep asking for frames even when paused.
    expect(layer.updateInterpolation(1000 + RIPPLE_PERIOD_MS / 2)).toBe(true);
    expect(layer.didPositionChange()).toBe(true);
    expect(rings[0]!.alpha).toBeCloseTo(0.5, 6);
    expect(rings[0]!.width).toBeGreaterThan(creature3.width);
    // Silent again: no ripples, no extra frames.
    world.creatures[3]!.call = 0;
    world.creatures[7]!.call = 0;
    layer.setSnapshot(packCreatureSnapshot(world), 2000, 100, false);
    expect(layer.getRippleCount()).toBe(0);
    expect(layer.rippleContainer.children.every((r) => !r.visible)).toBe(true);
    expect(layer.updateInterpolation(2050)).toBe(false);
    layer.destroy();
    expect(layer.rippleContainer.children).toHaveLength(0);
  });
});
