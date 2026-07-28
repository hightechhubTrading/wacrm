import type { SupabaseClient } from '@supabase/supabase-js'
import type { CollectFieldPromptItem } from './defaults'

// ============================================================
// AI-collectible fields: lets the autonomous auto-reply bot naturally
// save lead/order details it learns mid-conversation, the same way a
// human agent would jot them down -- no scripted form involved.
//
// Two independent scopes feed the same `[[SET_FIELD:name=value]]`
// sentinel mechanism (see generate.ts's parseGeneration):
//
//   'contact' -- the account's opted-in `custom_fields`
//     (`ai_collectible = true`), upserted onto `contact_custom_values`.
//     Persists across a contact's whole history (e.g. "preferred
//     language") -- correct for data that describes the PERSON.
//
//   'deal'    -- fields belonging to an active custom field GROUP
//     (migration 046) linked to the deal's current pipeline stage,
//     upserted onto `deal_custom_values` keyed to the CONTACT'S CURRENT
//     OPEN DEAL. These describe the ORDER, not the person -- a
//     returning contact's second order must not collide with or
//     overwrite the first order's values, which is exactly what
//     contact-scoped storage would do. Only ever offered to the model
//     when that deal's current stage actually has an active group
//     linked via `stage_required_groups` (never for a brand-new lead
//     still in "New Lead").
//
// Only fields an admin has explicitly opted in, or that the current
// deal's stage calls for, are ever shown to the model or written to --
// unrelated/sensitive account fields are never exposed to the bot.
// ============================================================

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
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
      scope: 'contact' as const,
    }))
  } catch {
    return []
  }
}

export interface CurrentDeal {
  id: string
  stage_id: string
  notes: string | null
}

/**
 * The contact's current order/deal: the most-recently-created OPEN
 * deal. Replaces an earlier conversation_id-based lookup that broke
 * for repeat customers -- `deal-form.tsx` never sets `conversation_id`
 * on a manually-created deal, so a second order's deal was invisible
 * to that query and the FIRST deal kept "winning" forever via its
 * oldest-first ordering.
 *
 * Heuristic note: if a contact somehow has two simultaneously open
 * deals, this picks the newer one -- correct for the normal flow
 * (close the old order via won/lost before/while opening the next),
 * not a guarantee for concurrent open orders.
 */
export async function resolveCurrentOpenDeal(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<CurrentDeal | null> {
  try {
    const { data, error } = await db
      .from('deals')
      .select('id, stage_id, notes')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data as CurrentDeal
  } catch {
    return null
  }
}

/**
 * Every field (required or optional) belonging to an ACTIVE custom
 * field group linked to `stageId` via `stage_required_groups`
 * (migration 046) -- so the bot is only ever asked to collect group
 * fields once a deal has actually reached a stage that calls for them,
 * not for a brand-new lead. Optional fields (e.g. a free-text "Note")
 * stay collectible, matching the old behaviour.
 */
export async function listGroupFieldsForStage(
  db: SupabaseClient,
  stageId: string,
): Promise<CollectFieldPromptItem[]> {
  try {
    const { data: links, error: linksErr } = await db
      .from('stage_required_groups')
      .select('group_id, custom_field_groups(scope, is_active)')
      .eq('stage_id', stageId)
    if (linksErr || !links) return []

    type LinkRow = { group_id: string; custom_field_groups: { scope: 'contact' | 'deal'; is_active: boolean } | null }
    const activeGroups = (links as unknown as LinkRow[]).filter((l) => l.custom_field_groups?.is_active)
    if (activeGroups.length === 0) return []

    const scopeByGroupId = new Map(activeGroups.map((l) => [l.group_id, l.custom_field_groups!.scope]))
    const groupIds = activeGroups.map((l) => l.group_id)

    const { data: fields, error: fieldsErr } = await db
      .from('custom_fields')
      .select('id, field_name, group_id')
      .in('group_id', groupIds)
    if (fieldsErr || !fields) return []

    type FieldRow = { id: string; field_name: string; group_id: string }
    return (fields as FieldRow[]).map((f) => ({
      id: f.id,
      name: f.field_name,
      scope: scopeByGroupId.get(f.group_id) ?? 'deal',
    }))
  } catch {
    return []
  }
}

/**
 * Apply the field name/value pairs the model emitted this turn,
 * routing each by scope: contact-scoped fields upsert onto
 * `contact_custom_values` (matched by name, case-insensitively); group
 * fields upsert onto `contact_custom_values` or `deal_custom_values`
 * (per the matched field's scope) keyed to the contact's current open
 * deal (see `resolveCurrentOpenDeal`). An unmatched name is skipped
 * rather than guessed at. Every applied value is also mirrored as a
 * short summary line onto the deal's `notes`, so the pipeline card
 * reflects it too. Best-effort and swallows its own errors -- never
 * blocks or fails the reply that triggered it.
 */
export async function applyCollectedFields(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  fields: { name: string; value: string }[]
}): Promise<void> {
  const { db, accountId, contactId, fields } = args
  if (!fields || fields.length === 0) return

  try {
    const deal = await resolveCurrentOpenDeal(db, accountId, contactId)
    const contactKnown = await listAiCollectibleFields(db, accountId)
    const groupKnown = deal ? await listGroupFieldsForStage(db, deal.stage_id) : []

    const applied: { name: string; value: string }[] = []

    for (const f of fields) {
      const cMatch = contactKnown.find((k) => sameName(k.name, f.name))
      if (cMatch) {
        await db.from('contact_custom_values').upsert(
          { contact_id: contactId, custom_field_id: cMatch.id, value: f.value },
          { onConflict: 'contact_id,custom_field_id' },
        )
        applied.push({ name: cMatch.name, value: f.value })
        continue
      }
      const gMatch = groupKnown.find((k) => sameName(k.name, f.name))
      if (gMatch && deal) {
        if (gMatch.scope === 'deal') {
          await db.from('deal_custom_values').upsert(
            { deal_id: deal.id, custom_field_id: gMatch.id, value: f.value },
            { onConflict: 'deal_id,custom_field_id' },
          )
        } else {
          await db.from('contact_custom_values').upsert(
            { contact_id: contactId, custom_field_id: gMatch.id, value: f.value },
            { onConflict: 'contact_id,custom_field_id' },
          )
        }
        applied.push({ name: gMatch.name, value: f.value })
      }
      // else: unmatched name -- skipped, same as before.
    }

    if (applied.length === 0 || !deal) return

    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const line = `[${stamp}] ${applied.map((a) => `${a.name}: ${a.value}`).join(' -- ')}`
    const nextNotes = deal.notes ? `${deal.notes}\n${line}` : line
    await db.from('deals').update({ notes: nextNotes }).eq('id', deal.id)
  } catch (err) {
    console.error('[ai auto-reply] applyCollectedFields failed:', err)
  }
}

/**
 * Fetch every AI-collectible custom field currently stored for a
 * contact (across this and any earlier turns), for use in the handoff
 * summary -- so the internal note reads as a real recap of the lead
 * details gathered so far rather than just a reply tally. Contact-
 * scoped only (group fields belong to a specific deal, not the recap
 * of "this contact" as a person). Best-effort: any failure degrades to
 * an empty list.
 */
export async function listCollectedFieldValues(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<{ name: string; value: string }[]> {
  try {
    const known = await listAiCollectibleFields(db, accountId)
    if (known.length === 0) return []

    const { data, error } = await db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId)
      .in(
        'custom_field_id',
        known.map((k) => k.id),
      )
    if (error || !data) return []

    const nameById = new Map(known.map((k) => [k.id, k.name]))
    return data
      .map((row) => ({
        name: nameById.get(row.custom_field_id as string) ?? '',
        value: row.value as string,
      }))
      .filter((f) => f.name && f.value)
  } catch {
    return []
  }
}
