export type Settled<R> =
  { readonly ok: true; readonly value: R } | { readonly ok: false; readonly error: unknown };

/**
 * Runs `jobs` with at most `concurrency` in flight; results come back in job order, whatever
 * order the jobs finish in. A failing job doesn't stop the others: every job is settled.
 */
export async function runPool<J, R>(
  jobs: readonly J[],
  concurrency: number,
  runJob: (job: J, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const results = new Array<Settled<R>>(jobs.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await runJob(jobs[index]!, index) };
      } catch (error: unknown) {
        results[index] = { ok: false, error };
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), jobs.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
