import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRngStream, createRngStreams, deriveRngStream, RngStream } from '../src/rng.js';

describe('RngStream (sfc32)', () => {
  it('produces identical sequences for the same numeric or string seed', () => {
    const a = createRngStream(42);
    const b = createRngStream(42);
    const s1 = createRngStream('island-alpha');
    const s2 = createRngStream('island-alpha');

    for (let i = 0; i < 50; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
      expect(s1.nextFloat()).toBe(s2.nextFloat());
    }
  });

  it('produces different sequences for different seeds and distinguishes numeric vs string', () => {
    const num42 = createRngStream(42);
    const num43 = createRngStream(43);
    const str42 = createRngStream('42');

    const seqNum42 = Array.from({ length: 8 }, () => num42.nextUint32());
    const seqNum43 = Array.from({ length: 8 }, () => num43.nextUint32());
    const seqStr42 = Array.from({ length: 8 }, () => str42.nextUint32());

    expect(seqNum42).not.toEqual(seqNum43);
    expect(seqNum42).not.toEqual(seqStr42);
  });

  it('normalizes -0 to 0 and rejects non-finite seeds', () => {
    const posZero = createRngStream(0);
    const negZero = createRngStream(-0);
    for (let i = 0; i < 10; i++) {
      expect(posZero.nextUint32()).toBe(negZero.nextUint32());
    }

    expect(() => createRngStream(Number.NaN)).toThrow(RangeError);
    expect(() => createRngStream(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createRngStream(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('validates nextRange and nextInt bounds and handles extreme ranges', () => {
    const rng = createRngStream(123);
    expect(() => rng.nextRange(5, 5)).toThrow(RangeError);
    expect(() => rng.nextRange(5, 2)).toThrow(RangeError);
    expect(() => rng.nextRange(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);

    for (let i = 0; i < 20; i++) {
      const v = rng.nextRange(-1e308, 1e308);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1e308);
      expect(v).toBeLessThan(1e308);
    }

    expect(() => rng.nextInt(3, 3)).toThrow(RangeError);
    expect(() => rng.nextInt(4, 2)).toThrow(RangeError);
    expect(() => rng.nextInt(0.5, 5)).toThrow(RangeError);
    expect(() => rng.nextInt(0, 0x1_0000_0001)).toThrow(RangeError);

    const fullUint = rng.nextInt(0, 0x1_0000_0000);
    expect(Number.isInteger(fullUint)).toBe(true);
    expect(fullUint).toBeGreaterThanOrEqual(0);
    expect(fullUint).toBeLessThan(0x1_0000_0000);
  });

  it('round-trips internal state with getState/fromState and rejects invalid states', () => {
    const original = createRngStream('checkpoint');
    for (let i = 0; i < 100; i++) {
      original.nextUint32();
    }
    const saved = original.getState();
    const restored = RngStream.fromState(saved);

    for (let i = 0; i < 25; i++) {
      expect(restored.nextUint32()).toBe(original.nextUint32());
    }

    expect(() =>
      RngStream.fromState([1, 2, 3] as unknown as readonly [number, number, number, number]),
    ).toThrow(RangeError);
    expect(() => RngStream.fromState([Number.NaN, 1, 2, 3])).toThrow(RangeError);
    expect(() => RngStream.fromState([Number.POSITIVE_INFINITY, 1, 2, 3])).toThrow(RangeError);
    expect(() => RngStream.fromState([1.5, 1, 2, 3])).toThrow(RangeError);
    expect(() => RngStream.fromState([-1, 1, 2, 3])).toThrow(RangeError);
    expect(() => RngStream.fromState([0x1_0000_0000, 1, 2, 3])).toThrow(RangeError);
  });

  it('keeps named streams completely independent and avoids delimiter collisions', () => {
    const baseline = createRngStreams(999);
    const mutated = createRngStreams(999);

    for (let i = 0; i < 10_000; i++) {
      mutated.map.nextUint32();
    }

    for (let i = 0; i < 20; i++) {
      expect(mutated.spawn.nextUint32()).toBe(baseline.spawn.nextUint32());
      expect(mutated.evolution.nextUint32()).toBe(baseline.evolution.nextUint32());
      expect(mutated.tick.nextUint32()).toBe(baseline.tick.nextUint32());
    }

    const d1 = deriveRngStream('a::b', 'c');
    const d2 = deriveRngStream('a', 'b::c');
    const s1 = Array.from({ length: 6 }, () => d1.nextUint32());
    const s2 = Array.from({ length: 6 }, () => d2.nextUint32());
    expect(s1).not.toEqual(s2);
  });

  it('handles shuffle edge cases (empty and single-element arrays)', () => {
    const rng = createRngStream(55);
    const empty: number[] = [];
    const single = [42];
    expect(rng.shuffle(empty)).toBe(empty);
    expect(empty).toEqual([]);
    expect(rng.shuffle(single)).toBe(single);
    expect(single).toEqual([42]);
  });

  it('satisfies range and permutation properties', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: 1, max: 200 }),
        (seed, min, span) => {
          const rng = createRngStream(seed);
          const f = rng.nextFloat();
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);

          const maxExclusive = min + span;
          const n = rng.nextInt(min, maxExclusive);
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(min);
          expect(n).toBeLessThan(maxExclusive);

          const r = rng.nextRange(min, maxExclusive);
          expect(r).toBeGreaterThanOrEqual(min);
          expect(r).toBeLessThan(maxExclusive);

          const items = Array.from({ length: 16 }, (_, idx) => idx);
          const shuffled = rng.shuffle([...items]);
          expect(shuffled).toHaveLength(items.length);
          expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
        },
      ),
      { numRuns: 100 },
    );
  });
});
