import { SIM_VERSION } from '@evolution-island/sim-core';

/** Human-readable simulation version, shown by the trainer CLI and the viewer. */
export function simVersionLabel(): string {
  return `sim v${SIM_VERSION}`;
}
