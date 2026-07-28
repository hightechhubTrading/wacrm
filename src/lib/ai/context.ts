import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  transcript: string | null
}

/**
 * Fetch the last N text (and transcribed-audio) messages of a
 * conversation and map them to the provider-neutral chat shape.
 * Customer messages become `user`; agent and bot messages become
 * `assistant`. A transcribed voice note (migration 049) is treated
 * like text via its `transcript` column; other non-text messages
 * (media without a transcript, templates, interactive) are excluded —
 * they carry no text to model.
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
    .select('sender_type, content_text, transcript')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'audio'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const result: ChatMessage[] = []
  for (const m of rows) {
    const text = (m.content_text ?? m.transcript)?.trim()
    if (!text) continue
    result.push({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: text,
    })
  }
  return result
}
