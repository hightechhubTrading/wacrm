import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '@/types';
import { MESSAGE_PAGE_SIZE } from './message-history';

/** Component-owned, never persisted or shared across signed-in workspaces. */
export class ThreadPreviewCache {
  private entries = new Map<string, { at: number; messages: Message[] }>();
  constructor(
    private limit = 10,
    private ttl = 120_000
  ) {}
  get(id: string, now = Date.now()): Message[] | undefined {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (now - entry.at >= this.ttl) return;
    this.entries.set(id, entry);
    return entry.messages;
  }
  set(id: string, messages: Message[], now = Date.now()) {
    this.entries.delete(id);
    this.entries.set(id, {
      at: now,
      messages: messages.slice(-MESSAGE_PAGE_SIZE),
    });
    while (this.entries.size > this.limit)
      this.entries.delete(this.entries.keys().next().value!);
  }
}

export async function fetchRecentMessagePage(db: SupabaseClient, id: string) {
  const result = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE + 1);
  return { data: result.data as Message[] | null, error: result.error };
}
export type RecentMessagePage = Awaited<
  ReturnType<typeof fetchRecentMessagePage>
>;
