import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReplay } from '@evolution-island/shared';
import { DEFAULT_CONFIG, type SimConfig } from '@evolution-island/sim-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayMain, trainSeed } from '../src/index.js';

const FAST: SimConfig = {
  ...DEFAULT_CONFIG,
  presets: {
    ...DEFAULT_CONFIG.presets,
    small: { ...DEFAULT_CONFIG.presets.small, generationLength: 60 },
  },
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ei-replay-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function quiet() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return { log, error };
}

describe('pnpm replay (Sprint 5.2)', () => {
  it('exports from a run folder where its training stopped, and verifies it', () => {
    const dir = tempDir();
    const run = join(dir, 'small-3');
    trainSeed({
      preset: 'small',
      seed: 3,
      generations: 2,
      saveEvery: 1,
      outDir: run,
      force: false,
      config: FAST,
    });
    const out = join(dir, 'a.replay.json');
    const { log } = quiet();
    expect(
      replayMain(['export', '--run', run, '--ticks', '250', '--hash-every', '100', '--out', out]),
    ).toBe(0);
    const replay = parseReplay(readFileSync(out, 'utf8'));
    expect(replay.start.generation).toBe(3);
    expect(replay.hashes.map((h) => h.tick)).toEqual([100, 200, 250]);
    expect(replayMain(['verify', out])).toBe(0);
    expect(log.mock.calls.at(-1)![0]).toMatch(/^OK: 250 ticks, 3 of 3 hashes match/);
  });

  it('exports from a fresh start and reports a tampered file with exit code 1', () => {
    const dir = tempDir();
    const out = join(dir, 'b.replay.json');
    const { error } = quiet();
    expect(
      replayMain([
        'export',
        '--preset',
        'small',
        '--seed',
        '5',
        '--ticks',
        '120',
        '--hash-every',
        '60',
        '--out',
        out,
      ]),
    ).toBe(0);
    expect(parseReplay(readFileSync(out, 'utf8')).start.generation).toBe(1);
    writeFileSync(
      out,
      readFileSync(out, 'utf8').replace(/"hash":"[0-9a-f]{16}"/, '"hash":"0000000000000000"'),
    );
    expect(replayMain(['verify', out])).toBe(1);
    expect(error.mock.calls.at(-1)![0]).toMatch(/^Diverged at tick 60: expected 0000000000000000/);
  });

  it('refuses bad input with exit code 2', () => {
    quiet();
    expect(replayMain(['export', '--ticks', '0', '--out', 'x'])).toBe(2);
    expect(replayMain(['export', '--run', 'r', '--seed', '1', '--ticks', '5', '--out', 'x'])).toBe(
      2,
    );
    expect(replayMain(['verify'])).toBe(2);
    expect(replayMain(['nope'])).toBe(2);
    expect(replayMain([])).toBe(0);
  });
});
