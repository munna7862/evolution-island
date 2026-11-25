import {
  SIM_VERSION,
  type EvolutionStart,
  type Hotspot,
  type MapPresetId,
  type Seed,
  type SpawnZone,
  type World,
} from '@evolution-island/sim-core';

export const BASE_TICKS_PER_SECOND = 10;

export type SimSpeed = 1 | 2 | 5 | 20 | 'max';

export const SIM_SPEEDS: readonly SimSpeed[] = [1, 2, 5, 20, 'max'];

export function speedToTicksPerSecond(speed: SimSpeed): number {
  return speed === 'max' ? Number.POSITIVE_INFINITY : speed * BASE_TICKS_PER_SECOND;
}

export function formatSpeed(speed: SimSpeed): string {
  return speed === 'max' ? 'Max' : `${speed}×`;
}

export function isSimSpeed(value: unknown): value is SimSpeed {
  return value === 1 || value === 2 || value === 5 || value === 20 || value === 'max';
}

/**
 * Compact, single-ArrayBuffer typed-array packing of all living creatures for zero-copy
 * worker -> main thread transfer (`15` bytes per living creature).
 */
export interface CreatureBuffer {
  readonly count: number;
  readonly buffer: ArrayBuffer;
  readonly ids: Uint32Array;
  readonly prevX: Uint16Array;
  readonly prevY: Uint16Array;
  readonly x: Uint16Array;
  readonly y: Uint16Array;
  readonly tribeIds: Uint8Array;
  readonly lastMoveDir: Int8Array;
  readonly healthRatio: Uint8Array;
  /** The creature's call as allies hear it, 0..255 (0 = silent; Sprint 4.3). */
  readonly call: Uint8Array;
}

export interface TransferableMapData {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly width: number;
  readonly height: number;
  readonly attempt: number;
  readonly hash: string;
  readonly walkableCount: number;
  readonly biomes: Uint8Array<ArrayBuffer>;
  readonly maxFood: Float32Array<ArrayBuffer>;
  readonly spawnZones: readonly SpawnZone[];
  readonly hotspots: readonly Hotspot[];
}

export interface SimSnapshot {
  readonly runId: number;
  readonly ackSeq: number;
  readonly tick: number;
  readonly generation: number;
  readonly livingCount: number;
  readonly tribePopulations: readonly number[];
  readonly actualTicksPerSec: number;
  readonly running: boolean;
  readonly speed: SimSpeed;
  readonly tickDurationMs: number;
  readonly creatures: CreatureBuffer;
  readonly worldHash: string | null;
}

export type MainToWorkerMessage =
  | {
      readonly type: 'init';
      readonly runId: number;
      readonly seq?: number;
      readonly preset: MapPresetId;
      readonly seed: Seed;
      readonly speed: SimSpeed;
      readonly running: boolean;
      readonly pauseAtTick: number | null;
      /**
       * Play a saved checkpoint (Sprint 3.3): an `EvolutionRun` starts from these genomes and
       * keeps evolving. Omitted: the random policy (no brains), as before.
       */
      readonly start?: EvolutionStart;
    }
  | {
      readonly type: 'setRunning';
      readonly runId: number;
      readonly seq?: number;
      readonly running: boolean;
    }
  | {
      readonly type: 'setSpeed';
      readonly runId: number;
      readonly seq?: number;
      readonly speed: SimSpeed;
    }
  | {
      readonly type: 'step';
      readonly runId: number;
      readonly seq?: number;
      readonly ticks: number;
    }
  | {
      readonly type: 'setPauseAtTick';
      readonly runId: number;
      readonly seq?: number;
      readonly targetTick: number | null;
    }
  | {
      readonly type: 'requestHash';
      readonly runId: number;
      readonly requestId: number;
    };

export type WorkerToMainMessage =
  | {
      readonly type: 'ready';
      readonly runId: number;
      readonly simVersion: number;
      readonly preset: MapPresetId;
      readonly seed: Seed;
      readonly map: TransferableMapData;
      readonly snapshot: SimSnapshot;
    }
  | {
      readonly type: 'snapshot';
      readonly snapshot: SimSnapshot;
    }
  | {
      readonly type: 'hash';
      readonly runId: number;
      readonly requestId: number;
      readonly tick: number;
      readonly worldHash: string;
    }
  | {
      readonly type: 'error';
      readonly runId: number;
      readonly message: string;
    };

export const CREATURE_STRIDE_BYTES = 16;

function clampUint16(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(65535, Math.trunc(value));
}

function packExactLiving(world: World, count: number): CreatureBuffer {
  const buffer = new ArrayBuffer(count * CREATURE_STRIDE_BYTES);

  // Stride layout keeps 4-byte alignment for Uint32Array and 2-byte alignment for Uint16Arrays.
  const ids = new Uint32Array(buffer, 0, count);
  const prevX = new Uint16Array(buffer, count * 4, count);
  const prevY = new Uint16Array(buffer, count * 6, count);
  const x = new Uint16Array(buffer, count * 8, count);
  const y = new Uint16Array(buffer, count * 10, count);
  const tribeIds = new Uint8Array(buffer, count * 12, count);
  const lastMoveDir = new Int8Array(buffer, count * 13, count);
  const healthRatio = new Uint8Array(buffer, count * 14, count);
  const call = new Uint8Array(buffer, count * 15, count);

  const maxHealth = world.config.creature.maxHealth;
  let writeIdx = 0;

  for (const c of world.creatures) {
    if (!c.alive) continue;
    if (writeIdx >= count) {
      // Defensive fallback if external caller mutated world.livingCount out of sync.
      let actualAlive = 0;
      for (const entry of world.creatures) {
        if (entry.alive) actualAlive++;
      }
      return packExactLiving(world, actualAlive);
    }
    ids[writeIdx] = c.id;
    prevX[writeIdx] = clampUint16(c.prevX);
    prevY[writeIdx] = clampUint16(c.prevY);
    x[writeIdx] = clampUint16(c.x);
    y[writeIdx] = clampUint16(c.y);
    tribeIds[writeIdx] = c.tribeId;
    lastMoveDir[writeIdx] = c.lastMoveDir;
    const ratio =
      Number.isFinite(c.health) && Number.isFinite(maxHealth) && maxHealth > 0
        ? Math.round((c.health / maxHealth) * 255)
        : 0;
    healthRatio[writeIdx] = Math.max(0, Math.min(255, ratio));
    call[writeIdx] = Number.isFinite(c.call)
      ? Math.round(Math.max(0, Math.min(1, c.call)) * 255)
      : 0;
    writeIdx++;
  }

  if (writeIdx !== count) {
    return packExactLiving(world, writeIdx);
  }

  return {
    count: writeIdx,
    buffer,
    ids,
    prevX,
    prevY,
    x,
    y,
    tribeIds,
    lastMoveDir,
    healthRatio,
    call,
  };
}

export function packCreatureSnapshot(world: World): CreatureBuffer {
  const hintCount = Number.isFinite(world.livingCount)
    ? Math.max(0, Math.trunc(world.livingCount))
    : 0;
  return packExactLiving(world, hintCount);
}

export function countTribePopulations(world: World): number[] {
  const counts = new Array<number>(world.map.spawnZones.length).fill(0);
  for (const c of world.creatures) {
    if (!c.alive) continue;
    if (c.tribeId >= 0 && c.tribeId < counts.length) {
      counts[c.tribeId] = counts[c.tribeId]! + 1;
    }
  }
  return counts;
}

/**
 * Clones static map terrain arrays before transferring so the worker keeps its own map intact.
 */
export function extractTransferableMapData(world: World): TransferableMapData {
  const { map } = world;
  return {
    preset: map.preset,
    seed: map.seed,
    width: map.width,
    height: map.height,
    attempt: map.attempt,
    hash: map.hash,
    walkableCount: map.walkableCount,
    biomes: new Uint8Array(map.biomes),
    maxFood: new Float32Array(map.maxFood),
    spawnZones: map.spawnZones,
    hotspots: map.hotspots,
  };
}

export interface SnapshotMeta {
  readonly runId: number;
  readonly ackSeq?: number;
  readonly actualTicksPerSec: number;
  readonly running: boolean;
  readonly speed: SimSpeed;
  readonly tickDurationMs: number;
  readonly includeHash: boolean;
}

export function buildSimSnapshot(world: World, meta: SnapshotMeta): SimSnapshot {
  const creatures = packCreatureSnapshot(world);
  return {
    runId: meta.runId,
    ackSeq: meta.ackSeq ?? 0,
    tick: world.tickCount,
    generation: world.generation,
    livingCount: creatures.count,
    tribePopulations: countTribePopulations(world),
    actualTicksPerSec: meta.actualTicksPerSec,
    running: meta.running,
    speed: meta.speed,
    tickDurationMs: meta.tickDurationMs,
    creatures,
    worldHash: meta.includeHash ? world.hash() : null,
  };
}

export function buildReadyMessage(
  world: World,
  meta: SnapshotMeta,
): Extract<WorkerToMainMessage, { type: 'ready' }> {
  return {
    type: 'ready',
    runId: meta.runId,
    simVersion: SIM_VERSION,
    preset: world.preset,
    seed: world.seed,
    map: extractTransferableMapData(world),
    snapshot: buildSimSnapshot(world, meta),
  };
}
