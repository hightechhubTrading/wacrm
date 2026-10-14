import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import { sortTriage, triageGroup } from './triage';
const conversation = (
  id: string,
  values: Partial<Conversation> = {}
): Conversation => ({
  id,
  user_id: 'u',
  contact_id: 'ct',
  status: 'open',
  unread_count: 0,
  created_at: '',
  updated_at: '',
  ...values,
});
describe('triage', () => {
  it('keeps resolved conversations out of attention groups even with stale urgency or unread counts', () => {
    expect(
      triageGroup(
        conversation('closed', {
          status: 'closed',
          ai_priority: 'urgent',
          unread_count: 3,
        })
      )
    ).toBe('closed');
  });
  it('orders urgency before unread and active, then recency, without changing input', () => {
    const input = [
      conversation('active'),
      conversation('unread', { unread_count: 2 }),
      conversation('high', { ai_priority: 'high' }),
      conversation('urgent', { ai_priority: 'urgent' }),
    ];
    expect(sortTriage(input).map((c) => c.id)).toEqual([
      'urgent',
      'high',
      'unread',
      'active',
    ]);
    expect(input[0].id).toBe('active');
    expect(
      sortTriage([
        conversation('older', { last_message_at: '2026-01-01' }),
        conversation('newer', { last_message_at: '2026-02-01' }),
      ])[0].id
    ).toBe('newer');
  });
  it('preserves stable ordering for missing or invalid dates', () => {
    expect(
      sortTriage([
        conversation('a', { last_message_at: 'bad' }),
        conversation('b'),
      ]).map((c) => c.id)
    ).toEqual(['a', 'b']);
  });
});
