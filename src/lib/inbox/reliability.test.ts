import { expect, it, vi } from 'vitest';
it('retains only allowlisted bounded event counts and numeric timings', async () => {
  vi.resetModules();
  const { recordReliability, reliabilitySnapshot, reliabilityTimings } =
    await import('./reliability');
  recordReliability('send.accepted', 12.8);
  recordReliability('send.accepted', 7);
  recordReliability('queue.failed', Infinity);
  recordReliability('customer text' as 'send.accepted', 10);
  expect(reliabilitySnapshot()).toEqual({
    'send.accepted': 2,
    'queue.failed': 1,
  });
  expect(reliabilityTimings()).toEqual({
    'send.accepted': { samples: 2, totalMs: 20, maxMs: 13 },
  });
  expect(Object.isFrozen(reliabilitySnapshot())).toBe(true);
  expect(Object.isFrozen(reliabilityTimings()['send.accepted'])).toBe(true);
});
