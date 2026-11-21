import { simVersionLabel } from '@evolution-island/shared';

export const APP_NAME = 'Evolution Island';

/** One-line status badge in the viewer header. */
export function statusLine(): string {
  return `${simVersionLabel()} · Viewer v0`;
}
