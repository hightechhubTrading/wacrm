import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { mergeMessageHistory } from './message-history';
const message = (id: string, time: string, text = id) =>
  ({ id, created_at: time, content_text: text }) as Message;
describe('mergeMessageHistory', () => {
  it('keeps older history and realtime arrivals when a recent page refreshes', () => {
    const current = [
      message('old', '2026-01-01'),
      message('recent', '2026-01-02'),
      message('live', '2026-01-03'),
    ];
    const merged = mergeMessageHistory(current, [
      message('recent', '2026-01-02', 'updated'),
    ]);
    expect(merged.map((row) => row.id)).toEqual(['old', 'recent', 'live']);
    expect(merged[1].content_text).toBe('updated');
  });
  it('deduplicates overlapping pages and orders equal timestamps consistently', () => {
    expect(
      mergeMessageHistory(
        [message('c', '2026-01-02')],
        [
          message('b', '2026-01-01'),
          message('a', '2026-01-01'),
          message('c', '2026-01-02'),
        ]
      ).map((row) => row.id)
    ).toEqual(['a', 'b', 'c']);
  });
});
