import type { CallRecord } from './types';

/** Polling an unchanged call list should not invalidate every call consumer. */
export function sameCalls(
  previous: CallRecord[],
  incoming: CallRecord[]
): boolean {
  return (
    previous.length === incoming.length &&
    previous.every((call, index) => {
      const next = incoming[index];
      const keys = Object.keys(call) as (keyof CallRecord)[];
      return (
        keys.length === Object.keys(next).length &&
        keys.every((key) => call[key] === next[key])
      );
    })
  );
}
