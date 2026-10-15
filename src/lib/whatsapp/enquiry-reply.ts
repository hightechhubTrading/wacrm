import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureFollowup } from '@/lib/ai/followups';

/** Template quick replies arrive as `button`, unlike session interactive replies. */
export function templateButtonReply(button?: { text?: string; payload?: string }) {
  if (!button) return null;
  const text = button.text?.trim() || button.payload?.trim();
  return text ? { text, id: button.payload?.trim() || text } : null;
}

export function enquiryReplyAction(text: string) {
  switch (text.trim().replace(/،/g, ',').replace(/\s+/g, ' ')) {
    case 'نعم, أود المتابعة': return 'continue';
    case 'ليس الآن': return 'pause';
    default: return null;
  }
}

// These are sales-enquiry reminders. Never cancel operational work or bookings.
export async function closeEnquiryReminders(
  db: SupabaseClient, accountId: string, conversationId: string,
) {
  const { error } = await db.from('ai_followups')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('account_id', accountId).eq('conversation_id', conversationId)
    .in('kind', ['quotation', 'location', 'comparison'])
    .in('status', ['open', 'acknowledged', 'deferred']);
  if (error) throw new Error('Could not close enquiry reminders');
}

export async function handleEnquiryReply(db: SupabaseClient, args: {
  accountId: string; conversationId: string; text: string;
  parentMessageId?: string; messageId: string; ownerId: string | null;
}): Promise<boolean> {
  const action = enquiryReplyAction(args.text);
  if (!action || !args.parentMessageId) return false;
  // A generic "not now" in another menu must not change sales work.
  const { data: parent, error } = await db.from('messages')
    .select('template_name').eq('conversation_id', args.conversationId)
    .eq('message_id', args.parentMessageId).eq('content_type', 'template')
    .maybeSingle();
  if (error) throw new Error('Could not resolve enquiry template reply');
  if (parent?.template_name !== 'enquiry_final_check_ar') return false;
  if (action === 'pause') {
    await closeEnquiryReminders(db, args.accountId, args.conversationId);
  } else {
    const id = await ensureFollowup(db, {
      accountId: args.accountId, conversationId: args.conversationId,
      sourceMessageId: args.messageId, kind: 'handoff', ownerId: args.ownerId,
    });
    if (!id) throw new Error('Could not create requested sales follow-up');
  }
  return true;
}
