// Sprint 3.3 acceptance: the viewer plays genomes loaded from a trainer run. The run folder is made
// by the built trainer CLI (two seeds → worker_threads), so this also covers the real CLI path.
// `pnpm test:e2e` builds the trainer and its dependencies before Playwright starts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkpointStart,
  parseCheckpoint,
  parseGenome,
  type LoadedGenome,
} from '@evolution-island/shared';
import {
  brainSpecFromConfig,
  createEvolutionRun,
  DEFAULT_CONFIG,
  hashConfig,
} from '@evolution-island/sim-core';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/debug-hook.js';

const TRAINER_CLI = fileURLToPath(new URL('../../trainer/dist/cli.js', import.meta.url));

let runsDir = '';

test.beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'ei-e2e-runs-'));
  const output = execFileSync(
    process.execPath,
    [
      TRAINER_CLI,
      ...['--preset', 'small', '--seeds', '1-2', '--generations', '3', '--save-every', '2'],
      ...['--out', runsDir, '--workers', '2', '--quiet'],
    ],
    { encoding: 'utf8' },
  );
  expect(output).toContain('on 2 worker threads');
  expect(output).toMatch(/\[seed 1\] done: 3 generations/);
  expect(output).toMatch(/\[seed 2\] done: 3 generations/);
});

test.afterAll(() => {
  if (runsDir !== '') rmSync(runsDir, { recursive: true, force: true });
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function checkpointDir(seed: number, generation: number): string {
  return join(
    runsDir,
    `small-${seed}`,
    'checkpoints',
    `gen-${String(generation).padStart(4, '0')}`,
  );
}

/** What Node computes for the same checkpoint: the world hash after `ticks` ticks. */
function nodeHashAfter(dir: string, ticks: number): string {
  const checkpoint = parseCheckpoint(readFileSync(join(dir, 'checkpoint.json'), 'utf8'));
  const genomes = new Map<string, LoadedGenome>();
  for (const tribe of checkpoint.tribes) {
    for (const entry of tribe.hallOfFame) {
      genomes.set(entry.file, parseGenome(readFileSync(join(dir, entry.file), 'utf8')));
    }
  }
  const start = checkpointStart(checkpoint, genomes, {
    brain: brainSpecFromConfig(DEFAULT_CONFIG),
    configHash: hashConfig(DEFAULT_CONFIG),
  });
  const run = createEvolutionRun({ preset: checkpoint.preset, seed: checkpoint.seed, start });
  for (let i = 0; i < ticks; i++) run.tick();
  return run.world.hash();
}

async function runTo(page: Page, tick: number): Promise<string> {
  await page.evaluate((t) => {
    window.__ei!.pauseAtTick(t);
  }, tick);
  await page.click('#play-pause-btn');
  await expect
    .poll(
      () =>
        page.evaluate((t) => {
          const s = window.__ei?.getState();
          return s !== undefined && s.tick === t && !s.running;
        }, tick),
      { timeout: 30_000 },
    )
    .toBe(true);
  const reply = await page.evaluate(() => window.__ei!.requestHash());
  expect(reply.tick).toBe(tick);
  return reply.worldHash;
}

/** Drops loose files on the map, as the browser would after a drag from the file manager. */
async function dropFiles(page: Page, files: readonly { name: string; text: string }[]) {
  await page.evaluate((list) => {
    const data = new DataTransfer();
    for (const f of list) data.items.add(new File([f.text], f.name, { type: 'application/json' }));
    const target = document.querySelector('#viewport')!;
    target.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
    );
  }, files);
}

function filesOf(dir: string): { name: string; text: string }[] {
  return readdirSync(dir).map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

test.describe('Loading a trained run (Sprint 3.3)', () => {
  test('plays a run folder picked with "Load run…", exactly as Node does', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?paused=1&speed=max');
    await expect.poll(() => page.evaluate(() => window.__ei?.mode)).toBe('random');

    await page.locator('#run-input').setInputFiles(join(runsDir, 'small-1'));
    await expect
      .poll(() => page.evaluate(() => window.__ei?.checkpoint?.label))
      .toBe('Gen 3 · small-1');
    const state = await page.evaluate(() => window.__ei!.getState());
    expect(state.mode).toBe('checkpoint');
    expect(state.checkpointOptions).toEqual([
      'Gen 1 · small-1',
      'Gen 2 · small-1',
      'Gen 3 · small-1',
    ]);
    expect(state.preset).toBe('small');
    expect(state.seed).toBe(1);
    expect(state.generation).toBe(3);
    expect(state.tribePopulations).toEqual(state.checkpoint!.tribeSizes);
    expect(state.runMessageIsError).toBe(false);
    await expect(page.locator('#run-info')).toHaveText('Watching Gen 3 · small-1 champions');
    await expect(page.locator('#hud-generation')).toHaveText('Gen 3');

    // Past the end of generation 3 (1,500 ticks on Small): breeding in the browser matches too.
    const browserHash = await runTo(page, 1600);
    expect(browserHash).toBe(nodeHashAfter(checkpointDir(1, 3), 1600));
    expect(await page.evaluate(() => window.__ei!.generation)).toBe(4);

    // Another saved generation from the menu.
    await page.locator('#checkpoint-select').selectOption({ label: 'Gen 1 · small-1' });
    await expect.poll(() => page.evaluate(() => window.__ei?.generation)).toBe(1);
    expect(await runTo(page, 50)).toBe(nodeHashAfter(checkpointDir(1, 1), 50));

    // Generating a map leaves the run.
    await page.click('#generate-btn');
    await expect.poll(() => page.evaluate(() => window.__ei?.mode)).toBe('random');
    expect(errors).toEqual([]);
  });

  test('plays a checkpoint folder dropped on the map', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?paused=1&speed=max');
    await expect.poll(() => page.evaluate(() => window.__ei?.mode)).toBe('random');

    await dropFiles(page, filesOf(checkpointDir(2, 2)));
    await expect
      .poll(() => page.evaluate(() => window.__ei?.checkpoint?.label))
      .toBe('Gen 2 · small-2');
    await expect(page.locator('#drop-overlay')).toBeHidden();
    expect(await runTo(page, 80)).toBe(nodeHashAfter(checkpointDir(2, 2), 80));
    expect(errors).toEqual([]);
  });

  test('refuses a checkpoint from another simulation version and keeps running', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/?paused=1&speed=max');
    await expect.poll(() => page.evaluate(() => window.__ei?.mode)).toBe('random');
    const mapHash = await page.evaluate(() => window.__ei!.mapHash);

    const files = filesOf(checkpointDir(1, 2)).map((f) =>
      f.name === 'checkpoint.json'
        ? { ...f, text: f.text.replace(/"simVersion": \d+/, '"simVersion": 1') }
        : f,
    );
    await dropFiles(page, files);
    await expect.poll(() => page.evaluate(() => window.__ei?.runMessageIsError)).toBe(true);
    const state = await page.evaluate(() => window.__ei!.getState());
    expect(state.runMessage).toMatch(/simVersion 1/);
    expect(state.mode).toBe('random');
    expect(state.mapHash).toBe(mapHash);
    await expect(page.locator('#run-info')).toHaveClass(/is-error/);

    await dropFiles(page, [{ name: 'notes.json', text: '{}' }]);
    await expect
      .poll(() => page.evaluate(() => window.__ei?.runMessage))
      .toMatch(/^No saved generation found/);
    expect(errors).toEqual([]);
  });
});
