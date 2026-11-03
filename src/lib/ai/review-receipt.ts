import type { SupabaseClient } from '@supabase/supabase-js';
import { engineSendText } from '@/lib/flows/meta-send';
import { recordReplyEvent } from './followups';

/** Fixed, truthful receipt only. Rejected drafts/actions never enter this path.
 * Claim is at-most-once per trigger and at most once/hour per conversation,
 * including concurrent workers. Failed sends retain the claim (no retry spam). */
export async function sendReviewReceipt(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    contactId: string;
    userId: string;
    triggerMessageId?: string;
    expectedAssignee: string | null;
    maxReplies: number;
    arabic: boolean;
    stillEligible: () => Promise<boolean>;
  }
): Promise<void> {
  if (!args.triggerMessageId || !(await args.stillEligible())) return;
  const { data, error } = await db.rpc('claim_ai_review_receipt', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_trigger_message_id: args.triggerMessageId,
    p_expected_assignee: args.expectedAssignee,
    p_max_replies: args.maxReplies,
  });
  if (error || data !== true || !(await args.stillEligible())) return;
  const event = {
    accountId: args.accountId,
    conversationId: args.conversationId,
    triggerMessageId: args.triggerMessageId,
  };
  try {
    await engineSendText({
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      userId: args.userId,
      aiGenerated: true,
      text: args.arabic
        ? 'وصلت رسالتك. أحتاج مراجعة من الفريق قبل إعطائك إجابة مؤكدة.'
        : 'I received your message. I need the team to review it before I can give you a confirmed answer.',
    });
    await recordReplyEvent(db, {
      ...event,
      outcome: 'sent',
      reason: 'review_receipt_sent',
    });
  } catch {
    await recordReplyEvent(db, {
      ...event,
      outcome: 'failed',
      reason: 'review_receipt_send_failed',
    });
  }
}
