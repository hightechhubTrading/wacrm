import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { isMessageContinuation } from './message-groups';
const message = (values: Partial<Message> = {}): Message => ({
  id: 'm',
  conversation_id: 'c',
  sender_type: 'agent',
  sender_id: 'agent1',
  content_type: 'text',
  created_at: '2026-10-13T09:00:00Z',
  status: 'read',
  ...values,
});
describe('message grouping', () => {
  it('groups consecutive messages from the same author within five minutes', () =>
    expect(
      isMessageContinuation(
        message(),
        message({ created_at: '2026-10-13T09:04:00Z' })
      )
    ).toBe(true));
  it('does not group the first message', () =>
    expect(isMessageContinuation(undefined, message())).toBe(false));
  it('separates customer, agent, and automation messages', () =>
    expect(
      isMessageContinuation(message(), message({ sender_type: 'customer' }))
    ).toBe(false));
  it('separates different team members', () =>
    expect(
      isMessageContinuation(message(), message({ sender_id: 'agent2' }))
    ).toBe(false));
  it('separates AI-generated replies from human replies', () =>
    expect(
      isMessageContinuation(message(), message({ ai_generated: true }))
    ).toBe(false));
  it('starts a new group after a time gap or invalid/out-of-order date', () => {
    for (const created_at of [
      '2026-10-13T09:05:00Z',
      'bad',
      '2026-10-13T08:59:00Z',
    ])
      expect(isMessageContinuation(message(), message({ created_at }))).toBe(
        false
      );
  });
});
