import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  transcript: string | null
  image_description: string | null
}

/**
 * Fetch the last N text (and transcribed-audio / described-photo)
 * messages of a conversation and map them to the provider-neutral chat
 * shape. Customer messages become `user`; agent and bot messages
 * become `assistant`. A transcribed voice note (migration 049) is
 * treated like text via its `transcript` column, and a described photo
 * (migration 054) via `image_description`; other non-text messages
 * (media without either, templates, interactive) are excluded — they
 * carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, transcript, image_description')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'audio', 'image'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const result: ChatMessage[] = []
  for (const m of rows) {
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
    const caption = m.content_text?.trim()
    const description = m.image_description?.trim()
    const text =
      caption && description
        ? `${caption}\n[Image: ${description}]`
        : (caption ?? m.transcript?.trim() ?? (description ? `[Image: ${description}]` : description))
    if (!text) continue
    result.push({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: text,
    })
  }
  return result
}
