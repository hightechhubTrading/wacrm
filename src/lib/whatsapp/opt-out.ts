// ============================================================
// WhatsApp opt-out / STOP-keyword compliance.
//
// A contact who sends one of OPT_OUT_KEYWORDS is treated as opted out of
// AUTOMATED sends — broadcasts, automation actions, and flow actions (see
// the per-call-site gates in broadcast-core.ts, the dashboard broadcast
// route, automations/meta-send.ts, and flows/meta-send.ts). Manual 1:1
// replies from the inbox are deliberately never gated by this — WhatsApp
// opt-out policy is about unsolicited automated messaging, not a live
// support conversation the contact is actively in.
//
// Matching is exact (case-insensitive, trimmed) on the WHOLE message body,
// not "contains" — so "please cancel my order" does not false-positive.
// The list is fixed, not per-account configurable, to keep this narrow.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'cancel', 'end', 'quit'];
export const OPT_IN_KEYWORDS = ['start', 'unstop'];

function matchesKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return keywords.includes(normalized);
}

export function isOptOutKeyword(text: string): boolean {
  return matchesKeyword(text, OPT_OUT_KEYWORDS);
}

export function isOptInKeyword(text: string): boolean {
  return matchesKeyword(text, OPT_IN_KEYWORDS);
}

export type OptOutSource = 'keyword' | 'manual';

/**
 * Shared write path for opted_out state — used by both the inbound
 * webhook (source: 'keyword') and the manual admin toggle in the contact
 * panel (source: 'manual'), so the update logic isn't duplicated.
 */
export async function recordOptOutState(
  db: SupabaseClient,
  contactId: string,
  optedOut: boolean,
  source: OptOutSource,
): Promise<{ error: unknown }> {
  const { error } = await db
    .from('contacts')
    .update({
      opted_out: optedOut,
      opted_out_at: optedOut ? new Date().toISOString() : null,
      opted_out_source: optedOut ? source : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);
  return { error };
}
