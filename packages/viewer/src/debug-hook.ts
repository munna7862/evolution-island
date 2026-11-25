import type { ReplayStatus } from '@evolution-island/shared';
import type { SimSpeed } from '@evolution-island/shared';
import type { MapPresetId, Seed } from '@evolution-island/sim-core';
import type { CameraState } from './renderer/camera.js';

/** The saved checkpoint being played (Sprint 3.3). */
export interface PlayingCheckpoint {
  readonly label: string;
  readonly generation: number;
  readonly preset: MapPresetId;
  readonly seed: Seed;
  /** Creatures per tribe at the start of the played generation. */
  readonly tribeSizes: readonly number[];
}

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
  /**
   * `random`: random-policy creatures; `checkpoint`: a loaded run's champions, evolving on;
   * `replay`: a replay file, checked against its recorded hashes (Sprint 5.2).
   */
  readonly mode: 'random' | 'checkpoint' | 'replay';
  /** Progress of the replay being played, or null. */
  readonly replay: ReplayStatus | null;
  readonly checkpoint: PlayingCheckpoint | null;
  /** Labels of the saved generations found in the loaded files. */
  readonly checkpointOptions: readonly string[];
  /** Last message about loading a run ('' if none); `runMessageIsError` marks refusals. */
  readonly runMessage: string;
  readonly runMessageIsError: boolean;
}

export interface EvolutionIslandDebugHook extends EvolutionIslandDebugState {
  getState(): EvolutionIslandDebugState;
  pauseAtTick(targetTick: number | null): void;
  requestHash(): Promise<{ readonly tick: number; readonly worldHash: string }>;
  /** The replay of what was played since the start (what "Export replay" saves). */
  exportReplay(): Promise<string>;
}

declare global {
  interface Window {
    __ei?: EvolutionIslandDebugHook;
  }
}
