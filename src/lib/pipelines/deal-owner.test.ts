import { describe, it, expect } from 'vitest';
import type { Deal } from '@/types';
import {
  attachDealSummaries,
  type SummaryConversation,
} from './deal-summaries';
import { getPipelineOwner } from './deal-owner';
import { filterDeals, DEFAULT_DEAL_FILTERS, UNASSIGNED } from './deal-views';
const profile = {
  id: 'profile-sara',
  user_id: 'user-sara',
  full_name: 'Sara',
  avatar_url: null,
};
const conversation = {
  id: 'chat',
  contact_id: 'customer',
  assigned_agent_id: 'user-sara',
  last_message_at: '2026-10-17',
  updated_at: '2026-10-17',
  ai_context_summary: null,
  ai_context_summary_at: null,
  ai_handoff_summary: null,
} as SummaryConversation;
const deal = {
  id: 'one',
  contact_id: 'customer',
  title: 'Shutters',
  created_at: '2026-10-17',
  value: 0,
} as Deal;
describe('pipeline conversation assignment', () => {
  it('shows the existing inbox owner when the deal is unassigned', () => {
    const result = attachDealSummaries(
      [deal],
      [conversation],
      [],
      [profile]
    )[0];
    expect(getPipelineOwner(result)).toMatchObject({
      id: 'profile-sara',
      userId: 'user-sara',
      name: 'Sara',
      source: 'conversation',
    });
    expect(result.assigned_to).toBeUndefined();
    expect(result.aiSummary).toBeNull();
    expect(
      filterDeals([result], { ...DEFAULT_DEAL_FILTERS, owner: UNASSIGNED })
    ).toHaveLength(0);
    expect(
      filterDeals([result], { ...DEFAULT_DEAL_FILTERS, owner: 'profile-sara' })
    ).toHaveLength(1);
  });
  it('uses conversation assignment over a different persisted deal owner', () => {
    const result = attachDealSummaries(
      [{ ...deal, assigned_to: 'profile-other' }],
      [conversation],
      [],
      [profile]
    )[0];
    expect(getPipelineOwner(result).id).toBe('profile-sara');
    expect(result.assigned_to).toBe('profile-other');
  });
  it('honors unassignment in the inbox even when a deal owner is still set', () => {
    const result = attachDealSummaries(
      [{ ...deal, assigned_to: 'profile-other' }],
      [{ ...conversation, assigned_agent_id: null }],
      [],
      [profile]
    )[0];
    expect(getPipelineOwner(result).id).toBeNull();
    expect(
      filterDeals([result], { ...DEFAULT_DEAL_FILTERS, owner: UNASSIGNED })
    ).toHaveLength(1);
  });
  it('keeps unknown profile names assigned rather than claiming unassigned', () => {
    const result = attachDealSummaries([deal], [conversation], [])[0];
    expect(getPipelineOwner(result).id).toBe('user:user-sara');
    expect(
      filterDeals([result], { ...DEFAULT_DEAL_FILTERS, owner: UNASSIGNED })
    ).toHaveLength(0);
  });
  it('uses the explicitly linked conversation rather than another customer thread', () => {
    const result = attachDealSummaries(
      [{ ...deal, conversation_id: 'older' }],
      [
        conversation,
        {
          ...conversation,
          id: 'older',
          assigned_agent_id: 'user-other',
          last_message_at: '2026-01-01',
        },
      ],
      [],
      [profile]
    )[0];
    expect(getPipelineOwner(result).userId).toBe('user-other');
  });
  it('falls back to deal ownership when no conversation can be resolved', () => {
    expect(
      getPipelineOwner({
        ...deal,
        assigned_to: 'profile-sara',
        assignee: {
          id: profile.id,
          user_id: profile.user_id,
          full_name: 'Sara',
          email: '',
          role: 'agent',
          created_at: '2026-10-17',
        },
      })
    ).toMatchObject({ id: 'profile-sara', source: 'deal' });
  });
  it('does not classify a failed ownership lookup as unassigned', () => {
    const result = { ...deal, conversationOwnerUnavailable: true };
    expect(getPipelineOwner(result).unavailable).toBe(true);
    expect(
      filterDeals([result], { ...DEFAULT_DEAL_FILTERS, owner: UNASSIGNED })
    ).toHaveLength(0);
  });
});
