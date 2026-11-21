import { Biome, type WorldMap } from '../src/index.js';

/**
 * Hand-made test map: every land tile (sand/grass/forest) holds `foodVal` food. No spawn zones,
 * no water field; use `createWorld({ map, populate: false })` and `spawnCreature`.
 */
export function makeMiniMap(biomesGrid: Biome[][], foodVal = 50): WorldMap {
  const height = biomesGrid.length;
  const width = biomesGrid[0]!.length;
  const size = width * height;
  const biomes = new Uint8Array(size);
  const maxFood = new Float32Array(size);
  const food = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const b = biomesGrid[y]![x]!;
      biomes[idx] = b;
      const mf = b === Biome.Grass || b === Biome.Forest || b === Biome.Sand ? foodVal : 0;
      maxFood[idx] = mf;
      food[idx] = mf;
    }
  }

  return {
    width,
    height,
    preset: 'small',
    seed: 'mini',
    attempt: 0,
    walkableCount: size,
    biomes,
    maxFood,
    food,
    waterDx: new Int16Array(size),
    waterDy: new Int16Array(size),
    spawnZones: [],
    hotspots: [],
    hash: '0000000000000000',
  };
}
