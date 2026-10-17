import { describe, expect, it } from 'vitest';
import type { Deal } from '@/types';
import {
  attachDealSummaries,
  type SummaryConversation,
  type AssistanceSummary,
} from './deal-summaries';
const deal = {
  id: 'deal',
  contact_id: 'customer',
  notes: 'A manual note is not an AI summary',
} as Deal;
const conversation: SummaryConversation = {
  id: 'chat',
  contact_id: 'customer',
  last_message_at: '2026-10-17T10:00:00Z',
  updated_at: '2026-10-17T10:00:00Z',
  ai_context_summary: 'Customer asks for shutters.',
  ai_context_summary_at: '2026-10-17T09:00:00Z',
  ai_handoff_summary: 'Older handoff',
};
const brief: AssistanceSummary = {
  conversation_id: 'chat',
  status: 'ready',
  analysis: { summary: 'Customer sent measurements; quotation pending.' },
  updated_at: '2026-10-17T10:00:00Z',
};
describe('pipeline saved AI summaries', () => {
  it('uses the most recent saved recap without changing deal notes', () => {
    const result = attachDealSummaries([deal], [conversation], [brief])[0];
    expect(result.aiSummary?.text).toBe(
      'Customer sent measurements; quotation pending.'
    );
    expect(result.notes).toBe(deal.notes);
  });
  it('uses a newer rolling summary over an older assistance brief', () => {
    expect(
      attachDealSummaries(
        [deal],
        [{ ...conversation, ai_context_summary_at: '2026-10-17T11:00:00Z' }],
        [brief]
      )[0].aiSummary?.text
    ).toBe(conversation.ai_context_summary);
  });
  it('honors an explicit conversation link, including inaccessible links', () => {
    const linked = { ...deal, conversation_id: 'older' };
    const older = {
      ...conversation,
      id: 'older',
      last_message_at: '2026-09-01',
      ai_context_summary: 'Linked job recap',
    };
    expect(
      attachDealSummaries([linked], [conversation, older], [])[0].aiSummary
        ?.text
    ).toBe('Linked job recap');
    expect(
      attachDealSummaries([linked], [conversation], [])[0].aiSummary
    ).toBeNull();
  });
  it('uses the latest customer conversation and never borrows another customer’s text', () => {
    expect(
      attachDealSummaries(
        [deal],
        [
          conversation,
          {
            ...conversation,
            id: 'latest',
            last_message_at: '2026-10-18',
            ai_context_summary: 'Latest recap',
          },
        ],
        []
      )[0].aiSummary?.text
    ).toBe('Latest recap');
    expect(
      attachDealSummaries(
        [deal],
        [{ ...conversation, contact_id: 'someone-else' }],
        []
      )[0].aiSummary
    ).toBeNull();
  });
  it('ignores unfinished or malformed AI analysis and falls back to saved context', () => {
    for (const candidate of [
      { ...brief, status: 'processing' },
      { ...brief, analysis: { summary: 42 } },
    ])
      expect(
        attachDealSummaries([deal], [conversation], [candidate])[0].aiSummary
          ?.text
      ).toBe(conversation.ai_context_summary);
  });
  it('shows no summary when only manual notes exist', () => {
    expect(attachDealSummaries([deal], [], [])[0].aiSummary).toBeNull();
    expect(
      attachDealSummaries(
        [deal],
        [
          {
            ...conversation,
            ai_context_summary: null,
            ai_handoff_summary: null,
          },
        ],
        []
      )[0].aiSummary
    ).toBeNull();
  });
  it('retains a conversation action even when no recap has been generated', () => {
    const result = attachDealSummaries(
      [deal],
      [{ ...conversation, ai_context_summary: null, ai_handoff_summary: null }],
      []
    )[0];
    expect(result.aiSummary).toBeNull();
    expect(result.customerConversationId).toBe('chat');
  });
  it('falls back to a saved human-handoff recap', () => {
    expect(
      attachDealSummaries(
        [deal],
        [{ ...conversation, ai_context_summary: null }],
        []
      )[0].aiSummary?.text
    ).toBe('Older handoff');
  });
});
