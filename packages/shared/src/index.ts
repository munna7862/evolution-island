export { parseSeed } from './seed.js';
export { simVersionLabel } from './version-label.js';
export {
  BASE_TICKS_PER_SECOND,
  buildReadyMessage,
  buildSimSnapshot,
  countTribePopulations,
  CREATURE_STRIDE_BYTES,
  extractTransferableMapData,
  formatSpeed,
  isSimSpeed,
  packCreatureSnapshot,
  SIM_SPEEDS,
  speedToTicksPerSecond,
  type CreatureBuffer,
  type MainToWorkerMessage,
  type SimSnapshot,
  type SimSpeed,
  type SnapshotMeta,
  type TransferableMapData,
  type WorkerToMainMessage,
} from './worker-protocol.js';
