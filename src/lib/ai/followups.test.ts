import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { followupPatch, ensureFollowup, recordReplyEvent } from './followups';
const now = new Date('2026-10-12T10:00:00Z');
describe('human follow-up transitions', () => {
  it('requires specific completion evidence and records the authenticated actor', () => {
    expect(
      followupPatch(
        { status: 'completed', completion_evidence: 'done' },
        'agent',
        now
      )
    ).toBeNull();
    expect(
      followupPatch(
        {
          status: 'completed',
          completion_evidence:
            'Technician attended and customer confirmed repair',
          completed_by: 'spoof',
        },
        'agent',
        now
      )
    ).toMatchObject({ completed_by: 'agent', status: 'completed' });
  });
  it('cannot defer without a future date or turn a requested date into a confirmed booking', () => {
    expect(followupPatch({ status: 'deferred' }, 'agent', now)).toBeNull();
    expect(
      followupPatch({ status: 'deferred', due_at: '2026-10-11' }, 'agent', now)
    ).toBeNull();
    const patch = followupPatch(
      { status: 'deferred', due_at: '2026-11-01', requested_at: '2026-11-02' },
      'agent',
      now
    );
    expect(patch).toMatchObject({
      next_reminder_at: '2026-11-01T00:00:00.000Z',
    });
    expect(patch).not.toHaveProperty('confirmed_at');
  });
  it('does not accept caller-controlled ownership/tenant or unsupported transitions', () => {
    expect(followupPatch({ status: 'open' }, 'agent', now)).toBeNull();
    expect(
      followupPatch(
        { status: 'acknowledged', owner_id: 'other', account_id: 'other' },
        'agent',
        now
      )
    ).toEqual({
      status: 'acknowledged',
      updated_at: now.toISOString(),
      owner_id: 'agent',
    });
  });
  it('handles storage failures without allowing them to interrupt the handoff', async () => {
    const db = {
      rpc: vi.fn().mockRejectedValue(new Error('db offline')),
      from: () => ({ insert: () => Promise.reject(new Error('db offline')) }),
    } as unknown as SupabaseClient;
    expect(
      await ensureFollowup(db, {
        accountId: 'account',
        conversationId: 'thread',
        kind: 'repair',
        ownerId: null,
      })
    ).toBeNull();
    await expect(
      recordReplyEvent(db, {
        accountId: 'account',
        conversationId: 'thread',
        outcome: 'failed',
        reason: 'generation_failed',
      })
    ).resolves.toBeUndefined();
  });
  it('passes deterministic deduplication to the database and preserves the originating message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'task', error: null });
    expect(
      await ensureFollowup({ rpc } as unknown as SupabaseClient, {
        accountId: 'a',
        conversationId: 'c',
        sourceMessageId: 'm',
        kind: 'inspection',
        ownerId: 'agent',
      })
    ).toBe('task');
    expect(rpc).toHaveBeenCalledWith(
      'ensure_ai_followup',
      expect.objectContaining({
        p_source_message_id: 'm',
        p_kind: 'inspection',
        p_account_id: 'a',
      })
    );
  });
});
