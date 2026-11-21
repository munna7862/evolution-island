import type {
  MainToWorkerMessage,
  SimSnapshot,
  WorkerToMainMessage,
} from '@evolution-island/shared';
import {
  brainSpecFromConfig,
  createEvolutionRun,
  createWorld,
  DEFAULT_CONFIG,
  weightCount,
  type EvolutionStart,
} from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import { SimRunner, type SimRunnerHost } from '../src/worker/sim-runner.js';

interface ScheduledTask {
  readonly id: number;
  readonly runAtMs: number;
  readonly fn: () => void;
  cancelled: boolean;
}

class MockRunnerHost implements SimRunnerHost {
  nowMs = 0;
  nextId = 1;
  readonly queue: ScheduledTask[] = [];
  readonly messages: WorkerToMainMessage[] = [];

  now(): number {
    return this.nowMs;
  }

  schedule(fn: () => void, delayMs: number): unknown {
    const task: ScheduledTask = {
      id: this.nextId++,
      runAtMs: this.nowMs + Math.max(0, delayMs),
      fn,
      cancelled: false,
    };
    this.queue.push(task);
    return task;
  }

  cancel(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null && 'cancelled' in handle) {
      (handle as ScheduledTask).cancelled = true;
    }
  }

  emit(message: WorkerToMainMessage): void {
    this.messages.push(message);
  }

  advanceBy(ms: number, stepMs = 5): void {
    const target = this.nowMs + ms;
    while (this.nowMs < target) {
      let nextTask: ScheduledTask | null = null;
      for (const task of this.queue) {
        if (task.cancelled || task.runAtMs > target) continue;
        if (nextTask === null || task.runAtMs < nextTask.runAtMs) {
          nextTask = task;
        }
      }
      if (nextTask === null) {
        this.nowMs = target;
        break;
      }
      this.nowMs = Math.max(this.nowMs, nextTask.runAtMs);
      nextTask.cancelled = true;
      nextTask.fn();
      // Prevent runaway max-speed loops within same millisecond.
      if (this.nowMs === target && stepMs > 0) {
        break;
      }
    }
  }

  latestSnapshot(): SimSnapshot {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.type === 'snapshot') return m.snapshot;
      if (m.type === 'ready') return m.snapshot;
    }
    throw new Error('No snapshot emitted yet');
  }
}

function send(runner: SimRunner, msg: MainToWorkerMessage): void {
  runner.handleMessage(msg);
}

describe('SimRunner', () => {
  it('emits ready on init and ignores messages with stale runId', () => {
    const host = new MockRunnerHost();
    const runner = new SimRunner(host);

    send(runner, {
      type: 'init',
      runId: 1,
      preset: 'small',
      seed: 42,
      speed: 1,
      running: false,
      pauseAtTick: null,
    });

    expect(host.messages).toHaveLength(1);
    const ready = host.messages[0]!;
    expect(ready.type).toBe('ready');
    if (ready.type === 'ready') {
      expect(ready.runId).toBe(1);
      expect(ready.snapshot.tick).toBe(0);
      expect(ready.snapshot.livingCount).toBe(50);
      expect(ready.snapshot.creatures.count).toBe(50);
      expect(ready.snapshot.worldHash).toMatch(/^[0-9a-f]{16}$/);
    }

    // Stale runId must be ignored.
    send(runner, { type: 'step', runId: 99, ticks: 5 });
    expect(host.messages).toHaveLength(1);
    expect(host.latestSnapshot().tick).toBe(0);
  });

  it('supports pause, resume, step(k), and exact pauseAtTick stopping', () => {
    const host = new MockRunnerHost();
    const runner = new SimRunner(host);

    send(runner, {
      type: 'init',
      runId: 1,
      preset: 'small',
      seed: 42,
      speed: 2, // 50 ms per tick
      running: true,
      pauseAtTick: 10,
    });

    // Advance 300 ms -> ~6 ticks.
    host.advanceBy(300);
    const mid = host.latestSnapshot();
    expect(mid.tick).toBeGreaterThanOrEqual(5);
    expect(mid.tick).toBeLessThan(10);
    expect(mid.running).toBe(true);

    // Pause and step once.
    send(runner, { type: 'setRunning', runId: 1, running: false });
    const pausedTick = host.latestSnapshot().tick;
    send(runner, { type: 'step', runId: 1, ticks: 1 });
    expect(host.latestSnapshot().tick).toBe(pausedTick + 1);
    expect(host.latestSnapshot().running).toBe(false);

    // Resume until pauseAtTick=10.
    send(runner, { type: 'setRunning', runId: 1, running: true });
    host.advanceBy(500);
    const stopped = host.latestSnapshot();
    expect(stopped.tick).toBe(10);
    expect(stopped.running).toBe(false);
    expect(stopped.worldHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces identical state hash at tick N across mid-run speed changes, pauses, and steps', () => {
    const reference = createWorld({ preset: 'small', seed: 42 });
    for (let t = 0; t < 100; t++) {
      reference.tick();
    }
    const expectedHash = reference.hash();

    // Run 1: constant 1x speed to tick 100.
    const hostA = new MockRunnerHost();
    const runnerA = new SimRunner(hostA);
    send(runnerA, {
      type: 'init',
      runId: 1,
      preset: 'small',
      seed: 42,
      speed: 1,
      running: true,
      pauseAtTick: 100,
    });
    for (let i = 0; i < 120 && hostA.latestSnapshot().tick < 100; i++) {
      hostA.advanceBy(100);
    }
    expect(hostA.latestSnapshot().tick).toBe(100);
    expect(hostA.latestSnapshot().worldHash).toBe(expectedHash);

    // Run 2: switch speeds mid-run (1x -> 20x -> pause -> step 5 -> 5x -> max -> 2x) to tick 100.
    const hostB = new MockRunnerHost();
    const runnerB = new SimRunner(hostB);
    send(runnerB, {
      type: 'init',
      runId: 7,
      preset: 'small',
      seed: 42,
      speed: 1,
      running: true,
      pauseAtTick: 100,
    });
    hostB.advanceBy(1000); // ~10 ticks at 1x
    send(runnerB, { type: 'setSpeed', runId: 7, speed: 20 });
    hostB.advanceBy(100); // ~20 ticks at 20x
    send(runnerB, { type: 'setRunning', runId: 7, running: false });
    send(runnerB, { type: 'step', runId: 7, ticks: 5 });
    send(runnerB, { type: 'setSpeed', runId: 7, speed: 5 });
    send(runnerB, { type: 'setRunning', runId: 7, running: true });
    hostB.advanceBy(400); // ~20 ticks at 5x
    // Pause at tick 85 under max speed, then finish to tick 100 at 2x speed.
    send(runnerB, { type: 'setPauseAtTick', runId: 7, targetTick: 85 });
    send(runnerB, { type: 'setSpeed', runId: 7, speed: 'max' });
    for (let i = 0; i < 10 && hostB.latestSnapshot().tick < 85; i++) {
      hostB.advanceBy(1);
    }
    expect(hostB.latestSnapshot().tick).toBe(85);
    expect(hostB.latestSnapshot().running).toBe(false);

    send(runnerB, { type: 'setPauseAtTick', runId: 7, targetTick: 100 });
    send(runnerB, { type: 'setSpeed', runId: 7, speed: 2 });
    send(runnerB, { type: 'setRunning', runId: 7, running: true });
    for (let i = 0; i < 100 && hostB.latestSnapshot().tick < 100; i++) {
      hostB.advanceBy(50);
    }

    const finalB = hostB.latestSnapshot();
    expect(finalB.tick).toBe(100);
    expect(finalB.running).toBe(false);
    expect(finalB.worldHash).toBe(expectedHash);
  });

  it('handles requestHash, invalid steps, destroy, re-init cancellation, ackSeq, and same-tick zero duration', () => {
    const host = new MockRunnerHost();
    const runner = new SimRunner(host);

    send(runner, {
      type: 'init',
      runId: 1,
      seq: 1,
      preset: 'small',
      seed: 42,
      speed: 1,
      running: false,
      pauseAtTick: 5,
    });
    expect(host.latestSnapshot().ackSeq).toBe(1);

    // Step 2 ticks then resume and change speed: non-tick control emits tickDurationMs === 0.
    send(runner, { type: 'step', runId: 1, seq: 2, ticks: 2 });
    expect(host.latestSnapshot().ackSeq).toBe(2);
    send(runner, { type: 'setRunning', runId: 1, seq: 3, running: true });
    expect(host.latestSnapshot().tickDurationMs).toBe(0);
    expect(host.latestSnapshot().ackSeq).toBe(3);

    send(runner, { type: 'setSpeed', runId: 1, seq: 4, speed: 5 });
    expect(host.latestSnapshot().tickDurationMs).toBe(0);
    expect(host.latestSnapshot().ackSeq).toBe(4);

    // Advance to pauseAtTick (5).
    host.advanceBy(200);
    expect(host.latestSnapshot().tick).toBe(5);
    expect(host.latestSnapshot().running).toBe(false);

    // Trying to resume at pauseAtTick emits paused ack without starting.
    const msgCountBefore = host.messages.length;
    send(runner, { type: 'setRunning', runId: 1, seq: 5, running: true });
    expect(host.messages.length).toBe(msgCountBefore + 1);
    expect(host.latestSnapshot().running).toBe(false);
    expect(host.latestSnapshot().ackSeq).toBe(5);

    // requestHash returns exact worldHash.
    send(runner, { type: 'requestHash', runId: 1, requestId: 77 });
    const hashMsg = host.messages[host.messages.length - 1]!;
    expect(hashMsg.type).toBe('hash');
    if (hashMsg.type === 'hash') {
      expect(hashMsg.requestId).toBe(77);
      expect(hashMsg.tick).toBe(5);
      expect(hashMsg.worldHash).toBe(host.latestSnapshot().worldHash);
    }

    // setPauseAtTick <= tickCount while running stops immediately.
    send(runner, { type: 'setPauseAtTick', runId: 1, targetTick: null });
    send(runner, { type: 'setRunning', runId: 1, seq: 6, running: true });
    send(runner, { type: 'setPauseAtTick', runId: 1, seq: 7, targetTick: 4 });
    expect(host.latestSnapshot().running).toBe(false);
    expect(host.latestSnapshot().ackSeq).toBe(7);

    // Invalid step emits an error message cleanly.
    send(runner, { type: 'step', runId: 1, ticks: 0 });
    const errMsg = host.messages[host.messages.length - 1]!;
    expect(errMsg.type).toBe('error');

    // Re-init mid-run cancels earlier scheduled tasks; destroy cancels current tasks.
    send(runner, {
      type: 'init',
      runId: 2,
      seq: 8,
      preset: 'small',
      seed: 9,
      speed: 1,
      running: true,
      pauseAtTick: null,
    });
    send(runner, {
      type: 'init',
      runId: 3,
      seq: 9,
      preset: 'small',
      seed: 9,
      speed: 1,
      running: true,
      pauseAtTick: null,
    });
    runner.destroy();
    const activeTasks = host.queue.filter((t) => !t.cancelled);
    expect(activeTasks).toHaveLength(0);
  });

  describe('playing a saved checkpoint (Sprint 3.3)', () => {
    const spec = brainSpecFromConfig(DEFAULT_CONFIG);
    const genome = (v: number) => new Float32Array(weightCount(spec)).fill(v);
    const start = (): EvolutionStart => ({
      generation: 40,
      tribes: [
        { tribeId: 0, alive: true, genomes: [genome(0.2), genome(-0.2)], hallOfFame: [] },
        {
          tribeId: 1,
          alive: true,
          genomes: [genome(0.1), genome(0.4), genome(-0.4)],
          hallOfFame: [{ genome: genome(0.1), benchmarkScore: 600, generation: 40 }],
        },
      ],
    });

    it('starts an EvolutionRun from the given genomes and matches Node tick for tick', () => {
      const host = new MockRunnerHost();
      const runner = new SimRunner(host);
      send(runner, {
        type: 'init',
        runId: 3,
        preset: 'small',
        seed: 42,
        speed: 1,
        running: false,
        pauseAtTick: null,
        start: start(),
      });
      const ready = host.messages[0]!;
      expect(ready.type).toBe('ready');
      expect(host.latestSnapshot().generation).toBe(40);
      expect(host.latestSnapshot().tribePopulations).toEqual([2, 3]);

      send(runner, { type: 'step', runId: 3, ticks: 25 });
      send(runner, { type: 'requestHash', runId: 3, requestId: 1 });
      const reply = host.messages.at(-1)!;
      const expected = createEvolutionRun({ preset: 'small', seed: 42, start: start() });
      for (let i = 0; i < 25; i++) expected.tick();
      expect(reply).toMatchObject({ type: 'hash', tick: 25, worldHash: expected.world.hash() });
    });

    it('plays a checkpoint in which a tribe was eliminated', () => {
      const host = new MockRunnerHost();
      const runner = new SimRunner(host);
      send(runner, {
        type: 'init',
        runId: 4,
        preset: 'small',
        seed: 42,
        speed: 'max',
        running: false,
        pauseAtTick: null,
        start: {
          generation: 1,
          tribes: [
            { tribeId: 0, alive: true, genomes: [genome(0)], hallOfFame: [] },
            { tribeId: 1, alive: false, genomes: [], hallOfFame: [] },
          ],
        },
      });
      send(runner, { type: 'step', runId: 4, ticks: 3 });
      expect(host.latestSnapshot().tick).toBe(3);
      expect(host.latestSnapshot().tribePopulations).toEqual([1, 0]);
    });
  });
});
