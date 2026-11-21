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
  readonly population: number;
  readonly chunkCount: number;
  readonly visibleChunkCount: number;
  readonly renderCount: number;
  readonly rendererType: string;
  readonly overlaysVisible: boolean;
  readonly camera: CameraState;
}

export interface EvolutionIslandDebugHook extends EvolutionIslandDebugState {
  getState(): EvolutionIslandDebugState;
}

declare global {
  interface Window {
    __ei?: EvolutionIslandDebugHook;
  }
}
