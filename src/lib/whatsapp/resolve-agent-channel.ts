//
// Decides whether a conversation's messages should route through its
// assigned agent's own WAHA session instead of the account's shared
// Meta number. Both send-message.ts (outbound) and the WAHA inbound
// webhook (Task 6) use this to agree on the same resolution rule.

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface AgentWahaChannel {
  baseUrl: string;
  apiKey: string;
  session: string;
  agentPhone: string;
}

/**
 * Resolves to the agent's WAHA channel only when EVERY piece is in
 * place: an assigned agent, that agent's `waha_session_name` AND
 * `phone` both set, and the account's `waha_config` active with a
 * base_url/api_key. Any gap falls back to `null` — callers then use
 * the account's normal Meta path, unchanged.
 */
export async function resolveAgentWahaChannel(
  db: SupabaseClient,
  accountId: string,
  assignedAgentUserId: string | null,
): Promise<AgentWahaChannel | null> {
  if (!assignedAgentUserId) return null;

  const { data: profile } = await db
    .from('profiles')
    .select('waha_session_name, phone')
    .eq('account_id', accountId)
    .eq('user_id', assignedAgentUserId)
    .maybeSingle();

  const session = profile?.waha_session_name?.trim();
  const agentPhone = profile?.phone?.trim();
  if (!session || !agentPhone) return null;

  const { data: config } = await db
    .from('waha_config')
    .select('base_url, api_key, is_active')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!config || !config.is_active || !config.base_url || !config.api_key) {
    return null;
  }

  return {
    baseUrl: config.base_url,
    apiKey: decrypt(config.api_key),
    session,
    agentPhone,
  };
}
