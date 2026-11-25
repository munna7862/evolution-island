import type { GenerationReport } from '@evolution-island/shared';

/**
 * Live dashboard data (plan §4 Sprint 6.1): per tribe, the series over generations that the
 * charts draw, and the leaderboard of the latest finished generation. Pure data, so it is unit
 * tested without a DOM; `DashboardView` draws it.
 */

export interface LeaderboardRow {
  readonly tribeId: number;
  readonly alive: boolean;
  readonly territoryPct: number;
  readonly kills: number;
  readonly avgFitness: number;
  /** The tribe's latest benchmark score up to that generation (benchmarks run every N). */
  readonly benchmarkScore: number | null;
  readonly tribeScore: number;
  /** Members in the finished generation. */
  readonly population: number;
}

export interface DashboardState {
  /** Last finished generation, or null before the first one ends. */
  readonly generation: number | null;
  /** Leaderboard of that generation, best tribe score first (ties → lower id). */
  readonly rows: readonly LeaderboardRow[];
}

/** One line per tribe: y values in generation order, null where there is no value. */
export interface ChartSeries {
  readonly tribeId: number;
  readonly values: readonly (number | null)[];
}

export type ChartMetric = 'avgFitness' | 'benchmarkScore' | 'population';

export class DashboardData {
  private readonly reports: GenerationReport[] = [];

  reset(): void {
    this.reports.length = 0;
  }

  /** Adds finished generations (in order; repeats of a known generation are ignored). */
  add(reports: readonly GenerationReport[]): void {
    for (const report of reports) {
      const last = this.reports[this.reports.length - 1];
      if (last !== undefined && report.generation <= last.generation) continue;
      this.reports.push(report);
    }
  }

  generations(): number[] {
    return this.reports.map((r) => r.generation);
  }

  state(): DashboardState {
    const latest = this.reports[this.reports.length - 1];
    if (latest === undefined) return { generation: null, rows: [] };
    const rows = latest.tribes.map((t): LeaderboardRow => {
      let benchmark: number | null = null;
      for (const r of this.reports) {
        const score = r.tribes.find((x) => x.tribeId === t.tribeId)?.benchmarkScore ?? null;
        if (score !== null) benchmark = score;
      }
      return {
        tribeId: t.tribeId,
        alive: t.alive,
        territoryPct: t.territoryPct,
        kills: t.kills,
        avgFitness: t.avgFitness,
        benchmarkScore: benchmark,
        tribeScore: t.tribeScore,
        population: t.population,
      };
    });
    rows.sort((a, b) => b.tribeScore - a.tribeScore || a.tribeId - b.tribeId);
    return { generation: latest.generation, rows };
  }

  series(metric: ChartMetric): ChartSeries[] {
    const ids = [...new Set(this.reports.flatMap((r) => r.tribes.map((t) => t.tribeId)))].sort(
      (a, b) => a - b,
    );
    return ids.map((tribeId) => ({
      tribeId,
      values: this.reports.map((r) => {
        const t = r.tribes.find((x) => x.tribeId === tribeId);
        return t === undefined ? null : t[metric];
      }),
    }));
  }
}

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Pixel paths for a line chart of `series` in a `width` × `height` box with `pad` margin: x evenly
 * spaced over the values, y scaled from 0 (or the smallest value, if negative) to the largest.
 * A null value breaks the line (benchmark generations only), so each series is a list of runs.
 */
export function chartPaths(
  series: readonly ChartSeries[],
  width: number,
  height: number,
  pad = 4,
  /** Join the points across nulls instead of breaking the line (benchmark scores). */
  connectGaps = false,
): { readonly paths: ChartPoint[][][]; readonly max: number } {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = all.length > 0 ? Math.max(...all) : 0;
  const min = Math.min(0, ...all);
  const span = max - min > 0 ? max - min : 1;
  const count = Math.max(1, ...series.map((s) => s.values.length));
  const xOf = (i: number) => pad + (count === 1 ? 0 : (i * (width - 2 * pad)) / (count - 1));
  const yOf = (v: number) => height - pad - ((v - min) * (height - 2 * pad)) / span;
  const paths = series.map((s) => {
    const runs: ChartPoint[][] = [];
    let current: ChartPoint[] = [];
    s.values.forEach((v, i) => {
      if (v === null) {
        if (connectGaps) return;
        if (current.length > 0) runs.push(current);
        current = [];
        return;
      }
      current.push({ x: xOf(i), y: yOf(v) });
    });
    if (current.length > 0) runs.push(current);
    return runs;
  });
  return { paths, max };
}
