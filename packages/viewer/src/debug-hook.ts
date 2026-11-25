import type { DashboardState, FeedEvent } from './dashboard.js';
import type {
  CreatureInspection,
  InspectTarget,
  ReplayStatus,
  ClimateStatus,
} from '@evolution-island/shared';
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
  /** Live dashboard (Sprint 6.1): the last finished generation's leaderboard. */
  readonly dashboard: DashboardState;
  /** The inspected creature, live (Sprint 6.2), and the creature the camera follows. */
  readonly inspection: CreatureInspection | null;
  readonly following: number | null;
  /** Climate now and the world event waiting for a map click (Sprint 7.2). */
  readonly climate: ClimateStatus | null;
  readonly armedEvent: string | null;
  /** Events feed, newest first, and the family tree's levels (Sprint 6.3). */
  readonly feed: readonly FeedEvent[];
  readonly familyTree:
    | readonly (readonly {
        readonly generation: number;
        readonly id: number;
        readonly rank: number | null;
      }[])[]
    | null;
}

export interface EvolutionIslandDebugHook extends EvolutionIslandDebugState {
  getState(): EvolutionIslandDebugState;
  pauseAtTick(targetTick: number | null): void;
  requestHash(): Promise<{ readonly tick: number; readonly worldHash: string }>;
  /** The replay of what was played since the start (what "Export replay" saves). */
  exportReplay(): Promise<string>;
  /** Opens the inspector on a target (what a click or a dashboard row does). */
  inspect(target: InspectTarget): void;
  /** Every living creature's tile in the latest snapshot. */
  creatureTiles(): { readonly id: number; readonly x: number; readonly y: number }[];
}

declare global {
  interface Window {
    __ei?: EvolutionIslandDebugHook;
  }
}
