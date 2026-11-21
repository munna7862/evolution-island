import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, generateMap, hashConfig, hashMap, StateHasher } from '../src/index.js';

describe('StateHasher, hashConfig & hashMap', () => {
  it('produces identical 16-char hex digests and uint32 digests for identical streams', () => {
    const build = () => {
      const h = new StateHasher();
      h.writeBoolean(true)
        .writeUint8(255)
        .writeInt16(-12)
        .writeInt32(-999_999)
        .writeUint32(4_000_000_000)
        .writeFloat32(3.5)
        .writeFloat64(123.456789)
        .writeString('tribe-red')
        .writeUint8Array(new Uint8Array([1, 2, 3]))
        .writeInt16Array(new Int16Array([-5, 0, 5]))
        .writeFloat32Array(new Float32Array([0.25, -0.75]));
      return h;
    };

    const a = build();
    const b = build();
    expect(a.digest()).toMatch(/^[0-9a-f]{16}$/);
    expect(a.digest()).toBe(b.digest());
    expect(a.digestUint32()).toBe(b.digestUint32());
    expect(a.digestUint32()).toBeGreaterThanOrEqual(0);
    expect(a.digestUint32()).toBeLessThanOrEqual(0xffffffff);
  });

  it('detects single-value changes and avoids length-prefix collisions', () => {
    const a = new StateHasher().writeString('ab').writeString('c').digest();
    const b = new StateHasher().writeString('a').writeString('bc').digest();
    expect(a).not.toBe(b);

    const arrA = new StateHasher()
      .writeUint8Array(new Uint8Array([1, 2]))
      .writeUint8Array(new Uint8Array([3]))
      .digest();
    const arrB = new StateHasher()
      .writeUint8Array(new Uint8Array([1]))
      .writeUint8Array(new Uint8Array([2, 3]))
      .digest();
    expect(arrA).not.toBe(arrB);
  });

  it('canonicalizes -0, float32 underflow (-1e-50) and NaN payloads', () => {
    const pos = new StateHasher().writeFloat32(0).writeFloat64(0).digest();
    const neg = new StateHasher().writeFloat32(-0).writeFloat64(-0).digest();
    expect(pos).toBe(neg);

    const f32Zero = new StateHasher().writeFloat32(0).digest();
    const f32Underflow = new StateHasher().writeFloat32(-1e-50).digest();
    expect(f32Underflow).toBe(f32Zero);

    const nanA = new StateHasher().writeFloat64(Number.NaN).digest();
    const nanB = new StateHasher().writeFloat64(0 / 0).digest();
    expect(nanA).toBe(nanB);
  });

  it('hashes DEFAULT_CONFIG deterministically and detects preset and map tweaks', () => {
    const h1 = hashConfig(DEFAULT_CONFIG);
    const h2 = hashConfig(DEFAULT_CONFIG);
    expect(h1).toBe(h2);

    const modifiedMap = {
      ...DEFAULT_CONFIG,
      map: {
        ...DEFAULT_CONFIG.map,
        hotspotMaxFood: DEFAULT_CONFIG.map.hotspotMaxFood + 1,
      },
    };
    expect(hashConfig(modifiedMap)).not.toBe(h1);

    const modifiedPreset = {
      ...DEFAULT_CONFIG,
      presets: {
        ...DEFAULT_CONFIG.presets,
        small: {
          ...DEFAULT_CONFIG.presets.small,
          width: DEFAULT_CONFIG.presets.small.width + 2,
        },
      },
    };
    expect(hashConfig(modifiedPreset)).not.toBe(h1);
  });

  it('computes map.hash via hashMap and detects mutations to every map field', () => {
    const map = generateMap({ preset: 'small', seed: 42 });
    expect(hashMap(map)).toBe(map.hash);

    const mutBiomes = new Uint8Array(map.biomes);
    mutBiomes[0] = (mutBiomes[0]! + 1) % 6;
    expect(hashMap({ ...map, biomes: mutBiomes })).not.toBe(map.hash);

    const mutMaxFood = new Float32Array(map.maxFood);
    mutMaxFood[0] = mutMaxFood[0]! + 1;
    expect(hashMap({ ...map, maxFood: mutMaxFood })).not.toBe(map.hash);

    const mutFood = new Float32Array(map.food);
    mutFood[0] = mutFood[0]! + 1;
    expect(hashMap({ ...map, food: mutFood })).not.toBe(map.hash);

    const mutWaterDx = new Int16Array(map.waterDx);
    mutWaterDx[0] = mutWaterDx[0]! + 1;
    expect(hashMap({ ...map, waterDx: mutWaterDx })).not.toBe(map.hash);

    const mutWaterDy = new Int16Array(map.waterDy);
    mutWaterDy[0] = mutWaterDy[0]! + 1;
    expect(hashMap({ ...map, waterDy: mutWaterDy })).not.toBe(map.hash);

    expect(
      hashMap({
        ...map,
        spawnZones: map.spawnZones.map((z, idx) => (idx === 0 ? { ...z, x: z.x + 1 } : z)),
      }),
    ).not.toBe(map.hash);

    expect(
      hashMap({
        ...map,
        hotspots: map.hotspots.map((s, idx) => (idx === 0 ? { ...s, x: s.x + 1 } : s)),
      }),
    ).not.toBe(map.hash);

    expect(hashMap({ ...map, attempt: map.attempt + 1 })).not.toBe(map.hash);
    expect(hashMap({ ...map, seed: '42' })).not.toBe(map.hash);
  });
});
