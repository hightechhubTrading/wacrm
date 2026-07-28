import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// AI provider key health tracking.
//
// Mirrors whatsapp_config's registered_at/last_registration_error
// pattern: set on a real auth failure (AiError.code === 'invalid_key'),
// cleared on the next successful call or a successful "Test key".
// Callers decide whether a failure/recovery is "fresh" (config already
// in hand from loadAiConfig) so this module never needs an extra read.
// ------------------------------------------------------------

export async function recordKeyError(
  db: SupabaseClient,
  accountId: string,
  message: string,
): Promise<void> {
  await db
    .from('ai_configs')
    .update({ last_key_error: message, last_key_error_at: new Date().toISOString() })
    .eq('account_id', accountId)
}

export async function clearKeyError(db: SupabaseClient, accountId: string): Promise<void> {
  await db
    .from('ai_configs')
    .update({ last_key_error: null, last_key_error_at: null })
    .eq('account_id', accountId)
}

/**
 * Notify every admin+ member of the account once per failure episode —
 * called only when a config's last_key_error transitions from null to
 * set, never on a repeat failure while it stays broken.
 */
export async function notifyAdminsOfKeyError(
  db: SupabaseClient,
  accountId: string,
  message: string,
): Promise<void> {
  const { data: admins, error } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .in('account_role', ['owner', 'admin'])
  if (error || !admins || admins.length === 0) return

  const rows = admins.map((a: { user_id: string }) => ({
    account_id: accountId,
    user_id: a.user_id,
    type: 'ai_key_invalid' as const,
    title: 'AI assistant key stopped working',
    body: message,
  }))
  await db.from('notifications').insert(rows)
}
