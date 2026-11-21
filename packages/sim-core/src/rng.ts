/**
 * Seeded deterministic PRNG (sfc32 with 128-bit state) and named independent streams.
 * See docs/master-plan.md §3.1 and §3.3.
 */

export type Seed = number | string;

export type RngState = readonly [number, number, number, number];

export type RngStreamName = 'map' | 'spawn' | 'evolution' | 'tick' | 'policy';

export interface RngStreams {
  readonly map: RngStream;
  readonly spawn: RngStream;
  readonly evolution: RngStream;
  /** Tick resolution: the Phase B action-order shuffle. */
  readonly tick: RngStream;
  /** Decision policies that need randomness (Phase 2's random policy); brains use none. */
  readonly policy: RngStream;
}

const UINT32_SPAN = 4294967296; // 2^32
const WARMUP_DRAWS = 15;

/**
 * Canonicalizes a numeric or string seed into a deterministic string representation.
 * Rejects NaN and non-finite numbers; normalizes -0 to '0'.
 */
export function normalizeSeed(seed: Seed): string {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new RangeError(`Seed must be a finite number, received ${seed}`);
    }
    const canonical = seed === 0 ? 0 : seed;
    return `n:${canonical}`;
  }
  return `s:${seed}`;
}

/**
 * 128-bit string hash (cyrb128) producing four 32-bit unsigned integers for sfc32 seeding.
 */
export function cyrb128(input: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ ch, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ ch, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ ch, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ ch, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Independent 128-bit sfc32 pseudo-random number stream.
 */
export class RngStream {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(a: number, b: number, c: number, d: number) {
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
  }

  static fromSeed(seed: Seed): RngStream {
    const [a, b, c, d] = cyrb128(normalizeSeed(seed));
    const stream = new RngStream(a, b, c, d);
    for (let i = 0; i < WARMUP_DRAWS; i++) {
      stream.nextUint32();
    }
    return stream;
  }

  static fromState(state: RngState): RngStream {
    const raw: unknown = state;
    if (!Array.isArray(raw) || raw.length !== 4) {
      throw new RangeError('RngState must be a 4-element array');
    }
    const nums: number[] = [];
    for (let i = 0; i < 4; i++) {
      const v: unknown = raw[i];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) {
        throw new RangeError(`RngState[${i}] must be a uint32 integer, received ${String(v)}`);
      }
      nums.push(v);
    }
    return new RngStream(nums[0]!, nums[1]!, nums[2]!, nums[3]!);
  }

  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** Returns a uniform unsigned 32-bit integer in [0, 0xffffffff]. */
  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + t) | 0;
    return t >>> 0;
  }

  /** Returns a uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / UINT32_SPAN;
  }

  /** Returns a uniform float in [min, max). */
  nextRange(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new RangeError(`nextRange requires finite min < max, received [${min}, ${max})`);
    }
    const halfSpan = max * 0.5 - min * 0.5;
    const u = this.nextFloat();
    const value = min + u * halfSpan + u * halfSpan;
    // Guard against IEEE-754 rounding hitting max when nextFloat() is 1 - 2^-32 and min is negative.
    return value >= max ? min : value;
  }

  /** Returns an unbiased integer in [min, maxExclusive). */
  nextInt(min: number, maxExclusive: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(maxExclusive) || maxExclusive <= min) {
      throw new RangeError(
        `nextInt requires safe integers with min < maxExclusive, received [${min}, ${maxExclusive})`,
      );
    }
    const range = maxExclusive - min;
    if (!Number.isSafeInteger(range) || range > UINT32_SPAN) {
      throw new RangeError(`nextInt range exceeds 2^32: ${range}`);
    }
    if (range === UINT32_SPAN) {
      return min + this.nextUint32();
    }
    const limit = Math.floor(UINT32_SPAN / range) * range;
    let roll = this.nextUint32();
    while (roll >= limit) {
      roll = this.nextUint32();
    }
    return min + (roll % range);
  }

  /** In-place deterministic Fisher-Yates shuffle. Returns the same array reference. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }
}

export function createRngStream(seed: Seed): RngStream {
  return RngStream.fromSeed(seed);
}

/**
 * Derives an independent RNG stream from a master seed and stream label.
 * Draws from sibling streams never influence this stream.
 */
export function deriveRngStream(masterSeed: Seed, label: string): RngStream {
  const normalized = normalizeSeed(masterSeed);
  return RngStream.fromSeed(`${normalized.length}:${normalized}::${label}`);
}

export function createRngStreams(masterSeed: Seed): RngStreams {
  return {
    map: deriveRngStream(masterSeed, 'map'),
    spawn: deriveRngStream(masterSeed, 'spawn'),
    evolution: deriveRngStream(masterSeed, 'evolution'),
    tick: deriveRngStream(masterSeed, 'tick'),
    policy: deriveRngStream(masterSeed, 'policy'),
  };
}
