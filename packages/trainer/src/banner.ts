import { simVersionLabel } from '@evolution-island/shared';

/** First line the trainer prints. */
export function banner(): string {
  return `Evolution Island trainer (${simVersionLabel()})`;
}
