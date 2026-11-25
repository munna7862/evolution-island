import {
  BASE_TICKS_PER_SECOND,
  buildReadyMessage,
  buildSimSnapshot,
  DEFAULT_REPLAY_HASH_EVERY,
  parseReplay,
  serializeReplay,
  startReplayRun,
  type GenerationReport,
  type MainToWorkerMessage,
  type ReplayHash,
  type ReplayStatus,
  type SimSpeed,
  type WorkerToMainMessage,
} from '@evolution-island/shared';
import {
  createEvolutionRun,
  createWorld,
  hashConfig,
  SIM_VERSION,
  type EvolutionRun,
  type EvolutionRunState,
  type World,
} from '@evolution-island/sim-core';

/** What the worker played since its start, for "Export replay" (Sprint 5.2). */
interface PlayedRun {
  readonly run: EvolutionRun;
  readonly start: EvolutionRunState;
  readonly startTick: number;
  /** run.hash() every DEFAULT_REPLAY_HASH_EVERY ticks played. */
  readonly hashes: ReplayHash[];
}

/** A replay being played (Sprint 5.2). */
interface PlayingReplay {
  readonly ticks: number;
  readonly expected: ReadonlyMap<number, string>;
  checked: number;
  matched: number;
  mismatch: ReplayStatus['mismatch'];
}

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
  /** Advances one tick; false once nothing can advance (a finished battle-royale run). */
  private advance: () => boolean = () => false;
  /** Set once `advance` returned false: the run is over, so it behaves like a pause target. */
  private ended = false;
  private played: PlayedRun | null = null;
  private replay: PlayingReplay | null = null;
  /** Generations already reported to the dashboard (Sprint 6.1). */
  private reportedThrough = 0;
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

      if (msg.type !== 'requestHash' && msg.type !== 'exportReplay' && msg.seq !== undefined) {
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
        case 'exportReplay':
          this.host.emit(this.exportReplay(msg.requestId), []);
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
    this.ended = false;
    this.speed = msg.speed;
    this.pauseAtTick = msg.pauseAtTick;
    this.played = null;
    this.replay = null;
    if (msg.replay !== undefined) {
      const file = parseReplay(msg.replay);
      const run = startReplayRun(file);
      this.trackPlayed(run, file.start);
      const replay: PlayingReplay = {
        ticks: file.ticks,
        expected: new Map(file.hashes.map((h) => [h.tick, h.hash])),
        checked: 0,
        matched: 0,
        mismatch: null,
      };
      this.replay = replay;
      this.world = run.world;
      this.advance = () => {
        const played = this.playedTicks();
        if (run.finished || played >= replay.ticks || replay.mismatch !== null) return false;
        this.tickRun(run);
        return true;
      };
    } else if (msg.start === undefined) {
      const world = createWorld({ preset: msg.preset, seed: msg.seed });
      this.world = world;
      this.advance = () => {
        world.tick();
        return true;
      };
    } else {
      const run = createEvolutionRun({ preset: msg.preset, seed: msg.seed, start: msg.start });
      this.trackPlayed(run, run.captureState());
      this.world = run.world;
      this.advance = () => {
        if (run.finished) return false;
        this.tickRun(run);
        return true;
      };
    }

    const atPauseTarget = this.atStop(this.world);
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
    // TypeScript keeps `played` narrowed to null from above, though trackPlayed set it.
    const played = this.played as PlayedRun | null;
    if (played !== null) this.reportGenerations(played.run);

    if (this.running) {
      this.scheduleNextSlice(this.initialDelayMs());
    }
  }

  private handleSetRunning(nextRunning: boolean): void {
    if (this.world === null) return;
    const atPauseTarget = this.atStop(this.world);
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
      if (!this.tickOnce()) break;
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
      if (!this.tickOnce()) {
        this.accumulatorMs = 0;
        break;
      }
      this.accumulatorMs -= stepMs;
      ticksRun++;
    }

    const hitPauseTarget = this.atStop(world);
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
      if (!this.tickOnce()) break;
      ticksRun++;
      if (this.host.now() - sliceStart >= MAX_SPEED_SLICE_BUDGET_MS) {
        break;
      }
    }

    const hitPauseTarget = this.atStop(world);
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

  /** One tick; false (and `ended`) when the run cannot advance any more. */
  private trackPlayed(run: EvolutionRun, start: EvolutionRunState): void {
    this.played = { run, start, startTick: run.world.tickCount, hashes: [] };
    this.reportedThrough = 0;
  }

  /** Sends the dashboard every finished generation not reported yet (Sprint 6.1). */
  private reportGenerations(run: EvolutionRun): void {
    const generations = new Set<number>();
    for (const t of run.tribes) {
      for (const h of t.history)
        if (h.generation > this.reportedThrough) generations.add(h.generation);
    }
    if (generations.size === 0) return;
    const reports: GenerationReport[] = [...generations]
      .sort((a, b) => a - b)
      .map((generation) => ({
        generation,
        tribes: run.tribes.flatMap((t) => {
          const h = t.history.find((x) => x.generation === generation);
          return h === undefined
            ? []
            : [
                {
                  tribeId: t.id,
                  // An eliminated tribe's last generation is the one it died out in.
                  alive: t.alive || generation < (t.history.at(-1)?.generation ?? 0),
                  population: h.population,
                  survivors: h.survivors,
                  avgFitness: h.avgFitness,
                  maxFitness: h.maxFitness,
                  territoryPct: h.territoryPct,
                  kills: h.kills,
                  tribeScore: h.tribeScore,
                  benchmarkScore: h.benchmarkScore,
                },
              ];
        }),
      }));
    this.reportedThrough = reports[reports.length - 1]!.generation;
    this.host.emit({ type: 'generationStats', runId: this.runId, reports }, []);
  }

  private playedTicks(): number {
    return this.played === null ? 0 : this.played.run.world.tickCount - this.played.startTick;
  }

  /** One run tick, then the replay bookkeeping: recorded hashes for export, and checks. */
  private tickRun(run: EvolutionRun): void {
    const generation = run.generation;
    run.tick();
    if (run.generation !== generation || run.finished) this.reportGenerations(run);
    const played = this.playedTicks();
    const due = played % DEFAULT_REPLAY_HASH_EVERY === 0;
    const replay = this.replay;
    const want = replay?.expected.get(played);
    if (!due && want === undefined) return;
    const hash = run.hash();
    if (due) this.played!.hashes.push({ tick: played, hash });
    if (replay !== null && want !== undefined) {
      replay.checked++;
      if (hash === want) replay.matched++;
      else replay.mismatch = { tick: played, expected: want, actual: hash };
    }
  }

  private replayStatus(): ReplayStatus | null {
    const r = this.replay;
    if (r === null) return null;
    return {
      played: this.playedTicks(),
      ticks: r.ticks,
      checked: r.checked,
      matched: r.matched,
      total: r.expected.size,
      mismatch: r.mismatch,
    };
  }

  /** The replay of everything played since the start (checkpoint or replay mode). */
  private exportReplay(requestId: number): Extract<WorkerToMainMessage, { type: 'replayExport' }> {
    const base = { type: 'replayExport' as const, runId: this.runId, requestId };
    const p = this.played;
    const ticks = this.playedTicks();
    if (p === null) {
      return { ...base, text: null, error: 'Only a saved generation or a replay can be exported' };
    }
    if (ticks < 1) return { ...base, text: null, error: 'Play at least one tick first' };
    const hashes = p.hashes.filter((h) => h.tick <= ticks);
    // Always end with the hash after the last tick played.
    if (hashes.at(-1)?.tick !== ticks) hashes.push({ tick: ticks, hash: p.run.hash() });
    const text = serializeReplay({
      simVersion: SIM_VERSION,
      configHash: hashConfig(p.run.config),
      config: p.run.config,
      preset: p.run.world.preset,
      seed: p.run.world.seed,
      start: p.start,
      ticks,
      hashEvery: DEFAULT_REPLAY_HASH_EVERY,
      hashes,
      events: [],
    });
    return { ...base, text, error: null };
  }

  private tickOnce(): boolean {
    if (this.ended || !this.advance()) {
      this.ended = true;
      return false;
    }
    return true;
  }

  private atStop(world: World): boolean {
    return this.ended || (this.pauseAtTick !== null && world.tickCount >= this.pauseAtTick);
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
      replay: this.replayStatus(),
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
