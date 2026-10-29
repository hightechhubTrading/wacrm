import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveNotificationRecipients } from './notification-recipients';

/** Internal review does not claim a transfer or change conversation ownership. */
export async function notifyReplyReview(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    contactId: string;
    ownerId: string | null;
    reason: string;
    kind?: 'reply' | 'media';
  }
) {
  try {
    const recipients = await resolveNotificationRecipients(
      db,
      args.accountId,
      args.ownerId
    );
    if (!recipients.length) return;
    const { error } = await db.from('notifications').insert(
      recipients.map((userId) => ({
        account_id: args.accountId,
        user_id: userId,
        conversation_id: args.conversationId,
        contact_id: args.contactId,
        type: 'ai_handoff',
        title:
          args.kind === 'media'
            ? 'Requested attachment needs review'
            : 'AI reply needs review',
        body:
          (args.kind === 'media'
            ? 'An attachment was not sent or its delivery is uncertain. Check the conversation before resending. Reason: '
            : 'A reply could not be verified. Review the latest customer request. The AI has not transferred or paused this conversation. Reason: ') +
          args.reason,
      }))
    );
    if (error) console.warn('[ai reply] review notification unavailable');
  } catch {
    console.warn('[ai reply] review notification unavailable');
  }
}
