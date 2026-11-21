import type { EvolutionRun, GenerationStats } from '@evolution-island/sim-core';

/** One row of `stats.json` / `stats.csv`: a tribe's generation (plan §3.5 `GenerationStats`). */
export interface StatsRow extends GenerationStats {
  readonly tribeId: number;
  /** Size the tribe was given for the next generation (0 once eliminated). */
  readonly nextSize: number;
}

export const STATS_FILE_FORMAT = 'evolution-island/stats';
export const STATS_FILE_VERSION = 1;

/** Rows of the generation that just ended, tribes in ascending id order. */
export function statsRowsFor(run: EvolutionRun, generation: number): StatsRow[] {
  const rows: StatsRow[] = [];
  for (const tribe of run.tribes) {
    const stats = tribe.history.find((h) => h.generation === generation);
    if (stats === undefined) continue; // eliminated before this generation
    rows.push({ ...stats, tribeId: tribe.id, nextSize: tribe.alive ? tribe.size : 0 });
  }
  return rows;
}

const CSV_COLUMNS = [
  'generation',
  'tribeId',
  'population',
  'survivors',
  'deaths',
  'avgFitness',
  'maxFitness',
  'foodGathered',
  'territoryPct',
  'kills',
  'tribeScore',
  'benchmarkScore',
  'nextSize',
] as const satisfies readonly (keyof StatsRow)[];

/** Numbers as JavaScript prints them (shortest exact form); `null` as an empty cell. */
export function statsToCsv(rows: readonly StatsRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((column) => (row[column] === null ? '' : String(row[column]))).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function statsToJson(rows: readonly StatsRow[]): string {
  return `${JSON.stringify({ format: STATS_FILE_FORMAT, fileVersion: STATS_FILE_VERSION, rows }, null, 1)}\n`;
}
