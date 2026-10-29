import type { SupabaseClient } from '@supabase/supabase-js';
import { getProductMediaItem, listProductsForPrompt } from './media-library';
import { engineSendMedia } from '@/lib/flows/meta-send';
export interface MediaActionArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  triggerMessageId: string;
  fileId: string;
}
/** A durable unique action and atomic claim prevent duplicate webhook attempts sending twice.
 * A transport exception can follow provider acceptance, so it is uncertain and never retried automatically. */
export async function sendTrackedMedia(
  db: SupabaseClient,
  args: MediaActionArgs
): Promise<'accepted' | 'skipped' | 'failed' | 'uncertain'> {
  let transportStarted = false;
  try {
    const { data: created, error } = await db
      .from('ai_media_actions')
      .upsert(
        {
          account_id: args.accountId,
          conversation_id: args.conversationId,
          trigger_message_id: args.triggerMessageId,
          file_id: args.fileId,
          file_snapshot_id: args.fileId,
        },
        {
          onConflict:
            'account_id,conversation_id,trigger_message_id,file_snapshot_id',
          ignoreDuplicates: true,
        }
      )
      .select('id');
    if (error) return 'failed';
    let id = created?.[0]?.id as string | undefined;
    if (!id) {
      const { data } = await db
        .from('ai_media_actions')
        .select('id')
        .eq('account_id', args.accountId)
        .eq('conversation_id', args.conversationId)
        .eq('trigger_message_id', args.triggerMessageId)
        .eq('file_snapshot_id', args.fileId)
        .maybeSingle();
      id = data?.id;
    }
    if (!id) return 'failed';
    const { data: claim, error: claimError } = await db
      .from('ai_media_actions')
      .update({ status: 'sending', attempts: 1 })
      .eq('id', id)
      .eq('account_id', args.accountId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimError || !claim) return 'skipped';
    const finish = async (
      status: string,
      failure_code: string | null,
      provider_message_id: string | null = null
    ) => {
      const { error } = await db
        .from('ai_media_actions')
        .update({ status, failure_code, provider_message_id })
        .eq('id', id)
        .eq('account_id', args.accountId)
        .eq('status', 'sending');
      if (error) console.warn('[ai media] action result storage unavailable');
    };
    // Only metadata lookups can be retried before a transport call, with no risk of duplicate delivery.
    let item = await getProductMediaItem(db, args.accountId, args.fileId);
    if (!item)
      item = await getProductMediaItem(db, args.accountId, args.fileId);
    const products = await listProductsForPrompt(db, args.accountId);
    if (
      !item ||
      !products.some(
        (p) =>
          p.id === item.productId && p.files.some((f) => f.id === args.fileId)
      )
    ) {
      await finish('failed', 'asset_unavailable');
      return 'failed';
    }
    try {
      const {
        data: { publicUrl },
      } = db.storage.from('ai-media').getPublicUrl(item.storagePath);
      transportStarted = true;
      const result = await engineSendMedia({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        kind: item.mediaKind,
        link: publicUrl,
        filename:
          item.mediaKind === 'document'
            ? item.label || item.productName
            : undefined,
      });
      await finish('accepted', null, result.whatsapp_message_id);
      return 'accepted';
    } catch {
      await finish('uncertain', 'transport_result_unknown');
      return 'uncertain';
    }
  } catch {
    return transportStarted ? 'uncertain' : 'failed';
  }
}
