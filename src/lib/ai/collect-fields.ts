import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// AI-collectible custom fields: lets the autonomous auto-reply bot
// naturally save lead details (product interest, measurements,
// budget, timeline, etc.) it learns mid-conversation onto the
// contact's own custom fields, the same way a human agent would jot
// them down -- no scripted form involved. Only fields an admin has
// explicitly opted in (`custom_fields.ai_collectible = true`) are ever
// shown to the model or written to, so unrelated/sensitive fields on
// the account are never exposed to the bot.
//
// Collected values are also mirrored onto the open deal (pipeline
// card) linked to the conversation, as a running note, so the
// pipeline board gives an at-a-glance overview of what the bot has
// learned about each lead without needing to open the contact
// separately.
// ============================================================

export interface CollectFieldPromptItem {
  id: string
  name: string
}

/**
 * List the account's AI-collectible custom fields for the prompt.
 * Best-effort: any failure degrades to an empty list (no collection
 * capability that turn) rather than throwing into the auto-reply path.
 */
export async function listAiCollectibleFields(
  db: SupabaseClient,
  accountId: string,
): Promise<CollectFieldPromptItem[]> {
  try {
    const { data, error } = await db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', accountId)
      .eq('ai_collectible', true)
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id as string,
      name: row.field_name as string,
    }))
  } catch {
    return []
  }
}

/**
 * Apply the field name/value pairs the model emitted this turn:
 * upsert each onto `contact_custom_values` (matched to the account's
 * AI-collectible fields by name, case-insensitively -- an unmatched
 * name is skipped rather than guessed at), then mirror a short summary
 * line onto the linked deal's notes so the pipeline card reflects it
 * too. Best-effort and swallows its own errors -- never blocks or
 * fails the reply that triggered it.
 */
export async function applyCollectedFields(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  fields: { name: string; value: string }[]
}): Promise<void> {
  const { db, accountId, contactId, conversationId, fields } = args
  if (!fields || fields.length === 0) return

  try {
    const known = await listAiCollectibleFields(db, accountId)
    if (known.length === 0) return

    const applied: { name: string; value: string }[] = []
    for (const f of fields) {
      const match = known.find(
        (k) => k.name.trim().toLowerCase() === f.name.trim().toLowerCase(),
      )
      if (!match) continue
      await db.from('contact_custom_values').upsert(
        { contact_id: contactId, custom_field_id: match.id, value: f.value },
        { onConflict: 'contact_id,custom_field_id' },
      )
      applied.push({ name: match.name, value: f.value })
    }
    if (applied.length === 0) return

    const { data: deal } = await db
      .from('deals')
      .select('id, notes')
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!deal) return

    const existingNotes = (deal.notes as string | null) ?? ''
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const line = `[${stamp}] ${applied.map((a) => `${a.name}: ${a.value}`).join(' -- ')}`
    const nextNotes = existingNotes ? `${existingNotes}\n${line}` : line

    await db.from('deals').update({ notes: nextNotes }).eq('id', deal.id)
  } catch (err) {
    console.error('[ai auto-reply] applyCollectedFields failed:', err)
  }
}
