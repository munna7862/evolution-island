import type { SimSpeed } from '@evolution-island/shared';
import type { MapPresetId, Seed } from '@evolution-island/sim-core';
import type { CameraState } from './renderer/camera.js';

export interface EvolutionIslandDebugState {
  readonly simVersion: number;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly mapHash: string;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly walkableCount: number;
  readonly tribeCount: number;
  readonly hotspotCount: number;
  readonly tick: number;
  readonly generation: number;
  readonly population: number;
  readonly tribePopulations: readonly number[];
  readonly running: boolean;
  readonly speed: SimSpeed;
  readonly actualTicksPerSec: number;
  readonly worldHash: string | null;
  readonly renderedCreatureCount: number;
  readonly fps: number;
  readonly chunkCount: number;
  readonly visibleChunkCount: number;
  readonly renderCount: number;
  readonly rendererType: string;
  readonly overlaysVisible: boolean;
  readonly camera: CameraState;
}

export interface EvolutionIslandDebugHook extends EvolutionIslandDebugState {
  getState(): EvolutionIslandDebugState;
  pauseAtTick(targetTick: number | null): void;
  requestHash(): Promise<{ readonly tick: number; readonly worldHash: string }>;
}

declare global {
  interface Window {
    __ei?: EvolutionIslandDebugHook;
  }
}
