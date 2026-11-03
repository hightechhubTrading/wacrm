import { expect, it } from 'vitest';
import {
  CONVERSATION_WORK_STATUSES,
  workStatusLifecycle,
  WORK_STATUS_VIEWS,
} from './work-status';
import {
  normalizeInboxQuery,
  parseInboxQuery,
  writeInboxQuery,
} from './query-state';
it('maps commercial stages to the existing inbox lifecycle', () => {
  for (const stage of CONVERSATION_WORK_STATUSES)
    expect(['open', 'pending', 'closed']).toContain(workStatusLifecycle(stage));
  expect(workStatusLifecycle('awaiting_customer')).toBe('pending');
  expect(workStatusLifecycle('completed')).toBe('closed');
  expect(workStatusLifecycle('cancelled')).toBe('closed');
  expect(workStatusLifecycle('installation')).toBe('open');
});
it('preserves every work filter in URLs and rejects unknown stages', () => {
  for (const view of WORK_STATUS_VIEWS) {
    const query = normalizeInboxQuery({ view });
    expect(
      parseInboxQuery(
        writeInboxQuery(new URL('https://example.com/inbox'), query).search
      ).view
    ).toBe(view);
  }
  expect(parseInboxQuery('?view=work:invented').view).toBe('all');
});
