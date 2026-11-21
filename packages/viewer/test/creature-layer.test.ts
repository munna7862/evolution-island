import { packCreatureSnapshot } from '@evolution-island/shared';
import { createWorld } from '@evolution-island/sim-core';
import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TILE_WORLD_SIZE } from '../src/renderer/camera.js';
import { CreatureLayer } from '../src/renderer/creature-layer.js';

describe('CreatureLayer', () => {
  it('pools sprites across growing/shrinking snapshots, interpolates positions, and cleans up', () => {
    const layer = new CreatureLayer(() => Texture.EMPTY);

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
});
