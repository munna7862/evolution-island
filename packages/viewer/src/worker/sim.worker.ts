import type { MainToWorkerMessage } from '@evolution-island/shared';
import { SimRunner } from './sim-runner.js';

interface WorkerGlobal {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<MainToWorkerMessage>) => void,
  ): void;
}

const workerSelf = globalThis as unknown as WorkerGlobal;

const runner = new SimRunner({
  now: () => performance.now(),
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
  cancel: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  emit: (message, transfer) => {
    workerSelf.postMessage(message, [...transfer]);
  },
});

workerSelf.addEventListener('message', (event) => {
  runner.handleMessage(event.data);
});
