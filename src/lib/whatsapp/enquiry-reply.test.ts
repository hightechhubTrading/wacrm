import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { templateButtonReply, enquiryReplyAction, handleEnquiryReply } from './enquiry-reply';
import { isOptOutKeyword } from './opt-out';

function fixture(templateName = 'enquiry_final_check_ar') {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query),
    in: vi.fn(() => query), update: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: { template_name: templateName }, error: null })),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  const rpc = vi.fn(async () => ({ data: 'task', error: null }));
  return { query, rpc, db: { from: vi.fn(() => query), rpc } as unknown as SupabaseClient };
}
const args = {
  accountId: 'account', conversationId: 'conversation', text: 'ليس الآن',
  parentMessageId: 'template-message', messageId: 'reply', ownerId: 'agent',
};

describe('final enquiry template replies', () => {
  it('reads actual template button text and payload independently', () => {
    expect(templateButtonReply({ text: 'ليس الآن', payload: 'pause' }))
      .toEqual({ text: 'ليس الآن', id: 'pause' });
    expect(templateButtonReply({ text: 'ليس الآن' })?.id).toBe('ليس الآن');
    expect(templateButtonReply()).toBeNull();
  });
  it('matches full labels, including Arabic punctuation, without guessing intent', () => {
    expect(enquiryReplyAction(' نعم، أود المتابعة ')).toBe('continue');
    expect(enquiryReplyAction('ليس الآن')).toBe('pause');
    expect(enquiryReplyAction('ليس الآن ولكن غداً')).toBeNull();
    expect(isOptOutKeyword(' إيقاف المتابعة ')).toBe(true);
    expect(isOptOutKeyword('لا أريد إيقاف المتابعة')).toBe(false);
  });
  it('only closes active sales reminders in this account and conversation', async () => {
    const { db, query } = fixture();
    expect(await handleEnquiryReply(db, args)).toBe(true);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(query.eq).toHaveBeenCalledWith('account_id', 'account');
    expect(query.eq).toHaveBeenCalledWith('conversation_id', 'conversation');
    expect(query.in).toHaveBeenCalledWith('kind', ['quotation', 'location', 'comparison']);
    expect(query.in).toHaveBeenCalledWith('status', ['open', 'acknowledged', 'deferred']);
  });
  it('does not act on a different template or a reply without context', async () => {
    const { db, query } = fixture('other_menu');
    expect(await handleEnquiryReply(db, args)).toBe(false);
    expect(await handleEnquiryReply(db, { ...args, parentMessageId: undefined })).toBe(false);
    expect(query.update).not.toHaveBeenCalled();
  });
  it('creates staff work when the customer asks to continue without re-enabling marketing', async () => {
    const { db, rpc, query } = fixture();
    expect(await handleEnquiryReply(db, { ...args, text: 'نعم، أود المتابعة' })).toBe(true);
    expect(rpc).toHaveBeenCalledWith('ensure_ai_followup', expect.objectContaining({
      p_account_id: 'account', p_conversation_id: 'conversation',
      p_source_message_id: 'reply', p_kind: 'handoff', p_owner_id: 'agent',
    }));
    expect(query.update).not.toHaveBeenCalled();
  });
});
