import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATIONS,
  MAX_SEEDS,
  parseSeedList,
  parseTrainArgs,
  runFolderName,
  UsageError,
  type TrainOptions,
} from '../src/index.js';

function train(argv: string[], cpus = 8): TrainOptions {
  const command = parseTrainArgs(argv, cpus);
  if (command.kind !== 'train') throw new Error('expected a train command');
  return command.options;
}

describe('parseSeedList', () => {
  it('reads single seeds, ranges and lists, in the order written', () => {
    expect(parseSeedList('7')).toEqual([7]);
    expect(parseSeedList('1-4')).toEqual([1, 2, 3, 4]);
    expect(parseSeedList('9, 1-2,5')).toEqual([9, 1, 2, 5]);
    expect(parseSeedList('-2--1')).toEqual([-2, -1]);
  });

  it('refuses malformed lists, descending ranges, duplicates and huge lists', () => {
    for (const bad of ['', 'a', '1-', '1,,2', '5-1', '1-3,2', `1-${MAX_SEEDS + 1}`, '1.5']) {
      expect(() => parseSeedList(bad), bad).toThrow(UsageError);
    }
  });
});

describe('parseTrainArgs', () => {
  it('takes the plan example as written', () => {
    expect(
      train([
        '--preset',
        'medium',
        '--seed',
        '42',
        '--generations',
        '500',
        '--out',
        'runs/medium-42/',
      ]),
    ).toEqual({
      preset: 'medium',
      seeds: [42],
      generations: 500,
      out: 'runs/medium-42/',
      saveEvery: null, // the config's benchmarkInterval, resolved by main()
      configPath: null,
      workers: 1,
      force: false,
      quiet: false,
    });
  });

  it('has defaults for everything', () => {
    const options = train([]);
    expect(options.preset).toBe('medium');
    expect(options.seeds).toEqual([42]);
    expect(options.generations).toBe(DEFAULT_GENERATIONS);
    expect(options.out).toBe(join('runs', 'medium-42'));
  });

  it('runs several seeds on CPU count − 1 workers (at most one per seed)', () => {
    const options = train(['--preset', 'small', '--seeds', '1-10'], 8);
    expect(options.seeds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(options.workers).toBe(7);
    expect(options.out).toBe(join('runs', 'small-seeds-1-10'));
    expect(train(['--seeds', '1,2'], 8).workers).toBe(2);
    expect(train(['--seeds', '1-4'], 1).workers).toBe(1);
    expect(train(['--seeds', '1-4', '--workers', '3']).workers).toBe(3);
  });

  it('accepts text seeds and keeps numbers as numbers', () => {
    expect(train(['--seed', 'island']).seeds).toEqual(['island']);
    expect(train(['--seed', '007']).seeds).toEqual(['007']);
    expect(train(['--seed=-3']).seeds).toEqual([-3]); // negative values need the = form
  });

  it('reads the switches', () => {
    const options = train(['--save-every', '25', '--force', '--quiet']);
    expect([options.saveEvery, options.force, options.quiet]).toEqual([25, true, true]);
  });

  it('takes a --config file path (read and checked by main())', () => {
    expect(train(['--config', 'sweeps/sigma-0.3.json']).configPath).toBe('sweeps/sigma-0.3.json');
    expect(train([]).configPath).toBeNull();
  });

  it('asks for help', () => {
    expect(parseTrainArgs(['--help'], 8)).toEqual({ kind: 'help' });
    expect(parseTrainArgs(['-h'], 8)).toEqual({ kind: 'help' });
  });

  it('refuses what it cannot run', () => {
    const bad = [
      ['--preset', 'gigantic'],
      ['--seed', '1', '--seeds', '1-2'],
      ['--seed', ' '],
      ['--generations', '0'],
      ['--generations', '1.5'],
      ['--generations', '10x'],
      ['--save-every', '-1'],
      ['--workers', '0'],
      ['--out', ''],
      ['--config', ' '],
      ['--config'],
      ['--unknown'],
      ['positional'],
      ['--generations'],
    ];
    for (const argv of bad) {
      expect(() => parseTrainArgs(argv, 8), argv.join(' ')).toThrow(UsageError);
    }
  });
});

describe('runFolderName', () => {
  it('is <preset>-<seed>, with unsafe characters replaced', () => {
    expect(runFolderName('small', 42)).toBe('small-42');
    expect(runFolderName('huge', 'my island/2')).toBe('huge-my_island_2');
  });
});
