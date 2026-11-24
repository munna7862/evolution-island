import { Worker } from 'node:worker_threads';
import type { SeedJob, SeedProgress, SeedSummary } from './train-seed.js';
import { isSeedWorkerMessage } from './worker-messages.js';

/** Trains one seed on its own `worker_threads` thread (needs the built `dist/seed-worker.js`). */
export function runSeedInWorker(
  job: SeedJob,
  onProgress: (progress: SeedProgress) => void,
): Promise<SeedSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./seed-worker.js', import.meta.url), { workerData: job });
    let summary: SeedSummary | null = null;
    let failure: Error | null = null;
    worker.on('message', (message: unknown) => {
      if (!isSeedWorkerMessage(message)) return;
      if (message.type === 'progress') onProgress(message.progress);
      else summary = message.summary;
    });
    worker.on('error', (error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
    });
    worker.on('exit', (code) => {
      if (summary !== null) resolve(summary);
      else
        reject(
          failure ?? new Error(`worker for seed ${String(job.seed)} exited with code ${code}`),
        );
    });
  });
}
