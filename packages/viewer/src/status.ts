import { simVersionLabel } from '@evolution-island/shared';

export const APP_NAME = 'Evolution Island';

/** One-line status under the title. The map view replaces this in Sprint 1.2. */
export function statusLine(): string {
  return `${simVersionLabel()} · viewer skeleton`;
}
