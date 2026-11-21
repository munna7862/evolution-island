import {
  BASE_TICKS_PER_SECOND,
  buildReadyMessage,
  buildSimSnapshot,
  type MainToWorkerMessage,
  type SimSpeed,
  type WorkerToMainMessage,
} from '@evolution-island/shared';
import { createWorld, type World } from '@evolution-island/sim-core';

export interface SimRunnerHost {
  now(): number;
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
  emit(message: WorkerToMainMessage, transfer: readonly ArrayBuffer[]): void;
}

const MAX_ACCUMULATE_MS = 250;
const MAX_TICKS_PER_FIXED_SLICE = 64;
const MAX_SPEED_SLICE_BUDGET_MS = 12;
const FIXED_HIGH_SPEED_SNAPSHOT_INTERVAL_MS = 16;
const MAX_SPEED_SNAPSHOT_INTERVAL_MS = 33;
const TPS_WINDOW_MS = 250;

export class SimRunner {
  private readonly host: SimRunnerHost;

  private world: World | null = null;
  private runId = -1;
  private lastAckSeq = 0;
  private running = false;
  private speed: SimSpeed = 1;
  private pauseAtTick: number | null = null;
  private timerHandle: unknown = null;

  private accumulatorMs = 0;
  private lastLoopTimeMs = 0;
  private lastSnapshotTimeMs = 0;
  private tpsWindowStartMs = 0;
  private tpsWindowTicks = 0;
  private actualTicksPerSec = 0;

  constructor(host: SimRunnerHost) {
    this.host = host;
  }

  handleMessage(msg: MainToWorkerMessage): void {
    try {
      if (msg.type === 'init') {
        this.handleInit(msg);
        return;
      }

      if (this.world === null || msg.runId !== this.runId) {
        return;
      }

      if (msg.type !== 'requestHash' && msg.seq !== undefined) {
        this.lastAckSeq = msg.seq;
      }

      switch (msg.type) {
        case 'setRunning':
          this.handleSetRunning(msg.running);
          break;
        case 'setSpeed':
          this.handleSetSpeed(msg.speed);
          break;
        case 'step':
          this.handleStep(msg.ticks);
          break;
        case 'setPauseAtTick':
          this.handleSetPauseAtTick(msg.targetTick);
          break;
        case 'requestHash':
          this.host.emit(
            {
              type: 'hash',
              runId: this.runId,
              requestId: msg.requestId,
              tick: this.world.tickCount,
              worldHash: this.world.hash(),
            },
            [],
          );
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.stopTimer();
      this.running = false;
      this.actualTicksPerSec = 0;
      this.host.emit(
        {
          type: 'error',
          runId: msg.type === 'init' ? msg.runId : this.runId,
          message,
        },
        [],
      );
    }
  }

  destroy(): void {
    this.stopTimer();
    this.running = false;
    this.world = null;
  }

  private handleInit(msg: Extract<MainToWorkerMessage, { type: 'init' }>): void {
    this.stopTimer();
    this.runId = msg.runId;
    this.lastAckSeq = msg.seq ?? 0;
    this.speed = msg.speed;
    this.pauseAtTick = msg.pauseAtTick;
    this.world = createWorld({ preset: msg.preset, seed: msg.seed });

    const atPauseTarget = this.pauseAtTick !== null && this.world.tickCount >= this.pauseAtTick;
    this.running = msg.running && !atPauseTarget;
    this.resetTiming();

    const ready = buildReadyMessage(this.world, {
      runId: this.runId,
      ackSeq: this.lastAckSeq,
      actualTicksPerSec: 0,
      running: this.running,
      speed: this.speed,
      tickDurationMs: 0,
      includeHash: !this.running,
    });

    this.host.emit(ready, [
      ready.map.biomes.buffer,
      ready.map.maxFood.buffer,
      ready.snapshot.creatures.buffer,
    ]);

    if (this.running) {
      this.scheduleNextSlice(this.initialDelayMs());
    }
  }

  private handleSetRunning(nextRunning: boolean): void {
    if (this.world === null) return;
    const atPauseTarget = this.pauseAtTick !== null && this.world.tickCount >= this.pauseAtTick;
    const targetRunning = nextRunning && !atPauseTarget;

    if (targetRunning === this.running) {
      if (nextRunning && !targetRunning) {
        // Already stopped at pauseAtTick: acknowledge control and keep UI paused.
        this.emitSnapshot(true, 0);
      }
      return;
    }

    this.running = targetRunning;
    if (!this.running) {
      this.stopTimer();
      this.actualTicksPerSec = 0;
      this.accumulatorMs = 0;
      this.emitSnapshot(true, 0);
      return;
    }

    this.resetTiming();
    // Emit tickDurationMs = 0 so sprites do not replay the previously completed tick.
    this.emitSnapshot(false, 0);
    this.scheduleNextSlice(this.initialDelayMs());
  }

  private handleSetSpeed(nextSpeed: SimSpeed): void {
    if (this.world === null) return;
    if (this.speed === nextSpeed) {
      this.emitSnapshot(!this.running, 0);
      return;
    }

    this.speed = nextSpeed;
    this.accumulatorMs = 0;
    this.lastLoopTimeMs = this.host.now();

    if (this.running) {
      this.stopTimer();
      this.emitSnapshot(false, 0);
      this.scheduleNextSlice(this.initialDelayMs());
    } else {
      this.emitSnapshot(true, 0);
    }
  }

  private handleStep(ticks: number): void {
    if (this.world === null) return;
    if (!Number.isInteger(ticks) || ticks < 1) {
      throw new RangeError(`step requires a positive integer tick count, received ${ticks}`);
    }

    this.stopTimer();
    this.running = false;
    this.accumulatorMs = 0;
    this.actualTicksPerSec = 0;

    for (let i = 0; i < ticks; i++) {
      if (this.pauseAtTick !== null && this.world.tickCount >= this.pauseAtTick) {
        break;
      }
      this.world.tick();
    }

    this.emitSnapshot(true, 0);
  }

  private handleSetPauseAtTick(targetTick: number | null): void {
    if (this.world === null) return;
    this.pauseAtTick = targetTick;

    if (this.running && targetTick !== null && this.world.tickCount >= targetTick) {
      this.stopTimer();
      this.running = false;
      this.accumulatorMs = 0;
      this.actualTicksPerSec = 0;
      this.emitSnapshot(true, 0);
    }
  }

  private runSlice(): void {
    this.timerHandle = null;
    if (!this.running || this.world === null) {
      return;
    }

    try {
      if (this.speed === 'max') {
        this.runMaxSpeedSlice();
      } else {
        this.runFixedSpeedSlice(this.speed);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.stopTimer();
      this.running = false;
      this.actualTicksPerSec = 0;
      this.host.emit({ type: 'error', runId: this.runId, message }, []);
    }
  }

  private runFixedSpeedSlice(speedNum: Exclude<SimSpeed, 'max'>): void {
    const world = this.world!;
    const stepMs = 1000 / (speedNum * BASE_TICKS_PER_SECOND);
    const sliceStart = this.host.now();
    const elapsed = Math.min(MAX_ACCUMULATE_MS, Math.max(0, sliceStart - this.lastLoopTimeMs));
    this.lastLoopTimeMs = sliceStart;
    this.accumulatorMs += elapsed;

    let ticksRun = 0;
    while (
      this.accumulatorMs >= stepMs &&
      ticksRun < MAX_TICKS_PER_FIXED_SLICE &&
      (this.pauseAtTick === null || world.tickCount < this.pauseAtTick)
    ) {
      world.tick();
      this.accumulatorMs -= stepMs;
      ticksRun++;
    }

    const hitPauseTarget = this.pauseAtTick !== null && world.tickCount >= this.pauseAtTick;
    const nowAfter = this.host.now();
    this.updateTps(ticksRun, nowAfter);

    if (hitPauseTarget) {
      this.running = false;
      this.actualTicksPerSec = 0;
      this.accumulatorMs = 0;
    }

    const shouldEmit =
      hitPauseTarget ||
      (ticksRun > 0 &&
        (speedNum <= 5 ||
          nowAfter - this.lastSnapshotTimeMs >= FIXED_HIGH_SPEED_SNAPSHOT_INTERVAL_MS));

    if (shouldEmit) {
      const tickDurationMs = this.running && speedNum <= 5 ? stepMs : 0;
      this.emitSnapshot(hitPauseTarget, tickDurationMs, nowAfter);
    }

    if (this.running) {
      const delay = Math.max(0, Math.ceil(stepMs - this.accumulatorMs));
      this.scheduleNextSlice(delay);
    }
  }

  private runMaxSpeedSlice(): void {
    const world = this.world!;
    const sliceStart = this.host.now();
    let ticksRun = 0;
    while (ticksRun < 256 && (this.pauseAtTick === null || world.tickCount < this.pauseAtTick)) {
      world.tick();
      ticksRun++;
      if (this.host.now() - sliceStart >= MAX_SPEED_SLICE_BUDGET_MS) {
        break;
      }
    }

    const hitPauseTarget = this.pauseAtTick !== null && world.tickCount >= this.pauseAtTick;
    const nowAfter = this.host.now();
    this.updateTps(ticksRun, nowAfter);

    if (hitPauseTarget) {
      this.running = false;
      this.actualTicksPerSec = 0;
    }

    if (hitPauseTarget || nowAfter - this.lastSnapshotTimeMs >= MAX_SPEED_SNAPSHOT_INTERVAL_MS) {
      this.emitSnapshot(hitPauseTarget, 0, nowAfter);
    }

    if (this.running) {
      this.scheduleNextSlice(0);
    }
  }

  private resetTiming(): void {
    const now = this.host.now();
    this.accumulatorMs = 0;
    this.lastLoopTimeMs = now;
    this.lastSnapshotTimeMs = now;
    this.tpsWindowStartMs = now;
    this.tpsWindowTicks = 0;
    this.actualTicksPerSec = 0;
  }

  private initialDelayMs(): number {
    if (this.speed === 'max') return 0;
    return Math.ceil(1000 / (this.speed * BASE_TICKS_PER_SECOND));
  }

  private currentTickDurationMs(): number {
    if (!this.running || this.speed === 'max' || this.speed > 5) {
      return 0;
    }
    return 1000 / (this.speed * BASE_TICKS_PER_SECOND);
  }

  private updateTps(ticksRun: number, nowMs: number): void {
    if (ticksRun > 0) {
      this.tpsWindowTicks += ticksRun;
    }
    const elapsedMs = nowMs - this.tpsWindowStartMs;
    if (elapsedMs >= TPS_WINDOW_MS) {
      this.actualTicksPerSec = (this.tpsWindowTicks * 1000) / elapsedMs;
      this.tpsWindowStartMs = nowMs;
      this.tpsWindowTicks = 0;
    } else if (this.actualTicksPerSec === 0 && ticksRun > 0 && elapsedMs > 0) {
      this.actualTicksPerSec = (this.tpsWindowTicks * 1000) / elapsedMs;
    }
  }

  private emitSnapshot(
    includeHash: boolean,
    tickDurationMs: number,
    nowMs = this.host.now(),
  ): void {
    if (this.world === null) return;
    this.lastSnapshotTimeMs = nowMs;
    const snapshot = buildSimSnapshot(this.world, {
      runId: this.runId,
      ackSeq: this.lastAckSeq,
      actualTicksPerSec: this.actualTicksPerSec,
      running: this.running,
      speed: this.speed,
      tickDurationMs,
      includeHash,
    });
    this.host.emit({ type: 'snapshot', snapshot }, [snapshot.creatures.buffer]);
  }

  private scheduleNextSlice(delayMs: number): void {
    this.stopTimer();
    this.timerHandle = this.host.schedule(() => {
      this.runSlice();
    }, delayMs);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) {
      this.host.cancel(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
