import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCreature, DEFAULT_CONFIG, SpatialGrid, type Creature } from '../src/index.js';

describe('SpatialGrid', () => {
  it('validates constructor parameters', () => {
    expect(() => new SpatialGrid(0, 10, 4)).toThrow(RangeError);
    expect(() => new SpatialGrid(10, -1, 4)).toThrow(RangeError);
    expect(() => new SpatialGrid(10, 10, 0)).toThrow(RangeError);
    expect(() => new SpatialGrid(10, 10, Number.NaN)).toThrow(RangeError);
  });

  it('indexes living creatures, excludes dead ones, and reflects moves after rebuild', () => {
    const grid = new SpatialGrid(32, 32, 8);
    const c0 = createCreature(0, 0, 7, 7, DEFAULT_CONFIG.creature);
    const c1 = createCreature(1, 0, 8, 8, DEFAULT_CONFIG.creature); // adjacent cell boundary
    const c2 = createCreature(2, 1, 20, 20, DEFAULT_CONFIG.creature);
    const dead = createCreature(3, 1, 7, 8, DEFAULT_CONFIG.creature);
    dead.alive = false;

    const creatures: Creature[] = [c0, c1, c2, dead];
    grid.rebuild(creatures);

    const found: number[] = [];
    grid.queryRadius(7, 7, 2, (c) => found.push(c.id));
    expect(found).toEqual([0, 1]);

    // Move c2 into radius and rebuild.
    c2.x = 7;
    c2.y = 8;
    grid.rebuild(creatures);

    const foundAfter: number[] = [];
    grid.queryRadius(7, 7, 1, (c) => foundAfter.push(c.id));
    expect(foundAfter).toEqual([0, 2]);

    // Radius 0 returns exact tile matches only.
    const exact: number[] = [];
    grid.queryRadius(7, 7, 0, (c) => exact.push(c.id));
    expect(exact).toEqual([0]);

    // Negative or NaN radius or non-finite query coordinates yield empty result.
    const invalid: number[] = [];
    grid.queryRadius(7, 7, -1, (c) => invalid.push(c.id));
    grid.queryRadius(7, 7, Number.NaN, (c) => invalid.push(c.id));
    grid.queryRadius(Number.NaN, 7, 4, (c) => invalid.push(c.id));
    grid.queryRadius(7, Number.POSITIVE_INFINITY, 4, (c) => invalid.push(c.id));
    expect(invalid).toEqual([]);
  });

  it('handles queryRadius before rebuild, corner cells, shrinking arrays, and NaN coordinates', () => {
    const grid = new SpatialGrid(32, 32, 8);

    // Query before any rebuild returns empty.
    const emptyBefore: number[] = [];
    grid.queryRadius(16, 16, 10, (c) => emptyBefore.push(c.id));
    expect(emptyBefore).toEqual([]);

    // Corner cells + NaN creature coordinates.
    const tenCreatures: Creature[] = [];
    for (let i = 0; i < 8; i++) {
      tenCreatures.push(createCreature(i, 0, i, 0, DEFAULT_CONFIG.creature));
    }
    tenCreatures.push(createCreature(8, 0, 31, 31, DEFAULT_CONFIG.creature));
    const nanCreature = createCreature(9, 0, 5, 5, DEFAULT_CONFIG.creature);
    nanCreature.x = Number.NaN;
    tenCreatures.push(nanCreature);

    grid.rebuild(tenCreatures);

    const topLeftCorner: number[] = [];
    grid.queryRadius(0, 0, 0, (c) => topLeftCorner.push(c.id));
    expect(topLeftCorner).toEqual([0]);

    const bottomRightCorner: number[] = [];
    grid.queryRadius(31, 31, 1, (c) => bottomRightCorner.push(c.id));
    expect(bottomRightCorner).toEqual([8]);

    // Shrink 10 -> 2 -> 0 and confirm no stale ghost entries remain.
    grid.rebuild(tenCreatures.slice(0, 2));
    const afterShrink2: number[] = [];
    grid.queryRadius(0, 0, 50, (c) => afterShrink2.push(c.id));
    expect(afterShrink2).toEqual([0, 1]);

    grid.rebuild([]);
    const afterShrink0: number[] = [];
    grid.queryRadius(0, 0, 50, (c) => afterShrink0.push(c.id));
    expect(afterShrink0).toEqual([]);
  });

  it('matches brute-force radius queries across random creature layouts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 32 }),
        fc.integer({ min: 1, max: 10 }),
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 40 }),
            y: fc.integer({ min: 0, max: 40 }),
            alive: fc.boolean(),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 16 }),
        (size, cellSize, specs, qx, qy, radius) => {
          const grid = new SpatialGrid(size, size, cellSize);
          const creatures = specs.map((s, id) => {
            const c = createCreature(
              id,
              id % 3,
              Math.min(size - 1, s.x),
              Math.min(size - 1, s.y),
              DEFAULT_CONFIG.creature,
            );
            c.alive = s.alive;
            return c;
          });
          grid.rebuild(creatures);

          const actualIds: number[] = [];
          grid.queryRadius(qx, qy, radius, (c) => actualIds.push(c.id));
          actualIds.sort((a, b) => a - b);

          const r2 = radius * radius;
          const expectedIds = creatures
            .filter((c) => c.alive && (c.x - qx) ** 2 + (c.y - qy) ** 2 <= r2)
            .map((c) => c.id);

          expect(actualIds).toEqual(expectedIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
