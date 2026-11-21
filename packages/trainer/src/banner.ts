import { simVersionLabel } from '@evolution-island/shared';

/** First line the trainer prints. The real CLI (flags, runs) arrives in Sprint 3.3. */
export function banner(): string {
  return `Evolution Island trainer (${simVersionLabel()})`;
}
