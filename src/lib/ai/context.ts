import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessage } from './types';
import { aiContextMessageLimit } from './defaults';

interface DbMessage {
  message_id?: string | null;
  document_text?: string | null;
  document_status?: string | null;
  sender_type: 'customer' | 'agent' | 'bot';
  content_type?: string | null;
  content_text: string | null;
  transcript: string | null;
  image_description: string | null;
}

/**
 * Fetch the last N text (and transcribed-audio / described-photo)
 * messages of a conversation and map them to the provider-neutral chat
 * shape. Customer messages become `user`; agent and bot messages
 * become `assistant`. A transcribed voice note (migration 049) is
 * treated like text via its `transcript` column, and a described photo
 * (migration 054) via `image_description`. Shared locations, files
 * and videos appear as bracketed markers (`[Location shared: ...]`,
 * `[File sent: ...]`, `[Video sent]`) -- they used to be dropped
 * entirely, so the model kept asking for a location the customer had
 * already sent (three times in one real thread) and claimed to have
 * "seen" plans it never received. Templates and interactive messages
 * are still excluded.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit()
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select(
      'message_id, sender_type, content_type, content_text, transcript, image_description, document_text, document_status'
    )
    .eq('conversation_id', conversationId)
    .in('content_type', [
      'text',
      'audio',
      'image',
      'location',
      'document',
      'video',
    ])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = ((data ?? []) as DbMessage[]).reverse();
  const result: ChatMessage[] = [];
  for (const [i, m] of rows.entries()) {
    // WhatsApp's "unsupported" placeholder usually arrives alongside a
    // batch of photos (an album) -- once anything newer from the
    // customer follows it, it carries no information and only led the
    // model to ask them to resend photos it had in fact received.
    if (
      m.sender_type === 'customer' &&
      m.content_text?.startsWith(UNSUPPORTED_PREFIX) &&
      rows.slice(i + 1).some((later) => later.sender_type === 'customer')
    ) {
      continue;
    }
    const marker = mediaMarker(m);
    if (marker) {
      result.push({
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: marker,
        ...(m.message_id ? { sourceMessageId: m.message_id } : {}),
        ...((m.content_type === 'document' || m.content_type === 'audio') &&
        m.sender_type === 'customer'
          ? {
              attachmentState: m.document_text
                ? m.document_status === 'partial'
                  ? ('partial' as const)
                  : ('parsed' as const)
                : ('unavailable' as const),
            }
          : {}),
      });
      continue;
    }

    // A captioned photo carries both a caption (content_text) and a
    // description (image_description) -- combine them so neither is
    // lost, rather than letting the caption shadow the description.
    // The description is always wrapped in `[Image: ...]` -- including
    // when it's the only text (an uncaptioned photo) -- so it's never
    // indistinguishable from the customer's own words. It's always
    // English (see vision.ts's DESCRIBE_PROMPT), and an unwrapped photo
    // description used to read exactly like a customer message in
    // English, which threw off the reply-language match on any photo
    // sent without a caption in a non-English conversation.
    const caption = m.content_text?.trim();
    const description =
      m.image_description?.trim() ||
      (m.content_type === 'image' && m.sender_type === 'customer'
        ? 'no description available'
        : undefined);
    const text =
      caption && description
        ? `${caption}\n[Image: ${description}]`
        : (caption ??
          m.transcript?.trim() ??
          (description ? `[Image: ${description}]` : description));
    if (!text) continue;
    result.push({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: text,
      ...(m.message_id ? { sourceMessageId: m.message_id } : {}),
    });
  }
  return result;
}

const UNSUPPORTED_PREFIX = '[Unsupported message type';

/**
 * The transcript line for a location / file / video message, or for a
 * photo the business itself sent -- `undefined` for every other message
 * (handled as text/voice/customer photo by the caller).
 */
function mediaMarker(m: DbMessage): string | undefined {
  const text = m.content_text?.trim();
  switch (m.content_type) {
    case 'location':
      return text ? `[Location shared: ${text}]` : '[Location shared]';
    case 'document':
      if (m.sender_type === 'customer' && m.document_text)
        return `[File sent: ${text || 'document'}]\n[Extracted document text${m.document_status === 'partial' ? ' (partial)' : ''}: ${m.document_text}]`;
      return text ? `[File sent: ${text}]` : '[File sent]';
    case 'audio':
      return !m.transcript && !text
        ? '[Audio received; not transcribed]'
        : undefined;
    case 'video':
      return text ? `${text}\n[Video sent]` : '[Video sent]';
    case 'image':
      // The business's own outbound photo (catalog attachment, or one a
      // human agent sent) -- recorded so the model knows it already went
      // out instead of promising it again.
      if (m.sender_type !== 'customer')
        return text ? `${text}\n[Photo sent]` : '[Photo sent]';
      return undefined;
    default:
      return undefined;
  }
}
