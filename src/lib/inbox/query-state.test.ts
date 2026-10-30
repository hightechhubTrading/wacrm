import { expect, it } from 'vitest';
import {
  DEFAULT_INBOX_QUERY,
  parseInboxQuery,
  writeInboxQuery,
  parseSavedInboxViews,
} from './query-state';
import { searchDayBoundary } from './message-search';
const tag = '10000000-0000-4000-8000-000000000001';
it('round-trips queue filters while preserving selected message and unrelated URLs', () => {
  const original = new URL(
    'https://app.test/inbox?c=conversation&m=message&quotation=quote#keep'
  );
  const query = {
    ...DEFAULT_INBOX_QUERY,
    search: 'نافذة + glass',
    view: 'needs_reply' as const,
    sort: 'oldest' as const,
    tags: [tag],
    company: 'A & B',
    agent: '__unassigned__',
  };
  const url = writeInboxQuery(original, query);
  expect(parseInboxQuery(url.search)).toEqual(query);
  expect(url.searchParams.get('c')).toBe('conversation');
  expect(url.searchParams.get('m')).toBe('message');
  expect(url.searchParams.get('quotation')).toBe('quote');
  expect(url.hash).toBe('#keep');
  expect(writeInboxQuery(url, DEFAULT_INBOX_QUERY).search).toBe(
    '?c=conversation&m=message&quotation=quote'
  );
});
it('normalizes untrusted URL/storage filters and role-restricted sales views', () => {
  const parsed = parseInboxQuery(
    '?view=not-a-view&sort=bad&tag=malformed&agent=malformed'
  );
  expect(parsed).toEqual(DEFAULT_INBOX_QUERY);
  expect(parseInboxQuery('?view=needs_reply', false).view).toBe('all');
  expect(parseInboxQuery(`?tag=${tag}&tag=${tag}`).tags).toEqual([tag]);
  expect(parseSavedInboxViews('invalid')).toEqual([]);
  expect(
    parseSavedInboxViews(
      JSON.stringify([
        {
          id: tag,
          name: 'Follow up',
          query: { view: 'needs_reply', tags: ['malformed'] },
        },
      ]),
      false
    )
  ).toEqual([{ id: tag, name: 'Follow up', query: DEFAULT_INBOX_QUERY }]);
});
it('validates calendar dates and treats the through date as inclusive', () => {
  expect(searchDayBoundary('2026-02-30')).toBeNull();
  expect(searchDayBoundary('garbage')).toBeNull();
  expect(searchDayBoundary('2026-10-25')).toBe('2026-10-24T21:00:00.000Z');
  expect(searchDayBoundary('2026-10-25', true)).toBe(
    '2026-10-25T21:00:00.000Z'
  );
});
