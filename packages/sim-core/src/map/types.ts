import type { MapPresetId } from '../config.js';
import type { Seed } from '../rng.js';

/**
 * Tile biomes (plan §2.1). Numeric values match biomeMaxFood indices in config.ts.
 */
export const Biome = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Mountain: 5,
} as const;

export type Biome = (typeof Biome)[keyof typeof Biome];

export function isWalkable(biome: number): boolean {
  return (
    biome === Biome.ShallowWater ||
    biome === Biome.Sand ||
    biome === Biome.Grass ||
    biome === Biome.Forest
  );
}

export function isWater(biome: number): boolean {
  return biome === Biome.DeepWater || biome === Biome.ShallowWater;
}

export function isSlow(biome: number): boolean {
  return biome === Biome.ShallowWater || biome === Biome.Forest;
}

export function hidesCreatures(biome: number): boolean {
  return biome === Biome.Forest;
}

export interface SpawnZone {
  readonly tribeId: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly walkableCount: number;
  readonly foodInFairnessRadius: number;
  readonly waterInFairnessRadius: number;
}

export interface Hotspot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface WaterField {
  readonly dx: Int16Array;
  readonly dy: Int16Array;
}

export interface WorldMap {
  readonly width: number;
  readonly height: number;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly attempt: number;
  readonly walkableCount: number;
  readonly biomes: Uint8Array;
  readonly maxFood: Float32Array;
  readonly food: Float32Array;
  readonly waterDx: Int16Array;
  readonly waterDy: Int16Array;
  readonly spawnZones: readonly SpawnZone[];
  readonly hotspots: readonly Hotspot[];
  readonly hash: string;
}
