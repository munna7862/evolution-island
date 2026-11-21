// worker_threads entry: trains one seed (`workerData` = SeedJob) and posts progress, then the
// summary. Errors propagate to the parent as the worker's 'error' event.
import { parentPort, workerData } from 'node:worker_threads';
import { assertSeedJob, type SeedWorkerMessage } from './worker-messages.js';
import { trainSeed } from './train-seed.js';

const port = parentPort;
if (port === null) {
  throw new Error('seed-worker.js must run in a worker thread');
}
const post = (message: SeedWorkerMessage): void => {
  port.postMessage(message);
};
const summary = trainSeed(assertSeedJob(workerData), (progress) => {
  post({ type: 'progress', progress });
});
post({ type: 'done', summary });
