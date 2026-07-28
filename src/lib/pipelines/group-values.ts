import type { SupabaseClient } from '@supabase/supabase-js'

export interface GroupFieldWithValue {
  id: string
  name: string
  scope: 'contact' | 'deal'
  required: boolean
  value: string | null
}

/**
 * Every field belonging to an ACTIVE custom field group linked to
 * `stageId` (via `stage_required_groups`, migration 046), with its
 * current value resolved from the right table — `contact_custom_values`
 * for a `scope: 'contact'` group, `deal_custom_values` for
 * `scope: 'deal'` — based on the owning group's scope. Used both for
 * gating (does every `required` field have a value?) and for the
 * stage-enter group notification (show whatever's known, required or
 * not). Returns `[]` (never throws) if the stage has no linked active
 * groups, or if the fetch fails for any reason.
 */
export async function resolveStageGroupFields(
  db: SupabaseClient,
  args: { stageId: string; contactId: string | null; dealId: string },
): Promise<GroupFieldWithValue[]> {
  const { stageId, contactId, dealId } = args
  try {
    const { data: links, error: linksErr } = await db
      .from('stage_required_groups')
      .select('group_id, custom_field_groups(id, scope, is_active)')
      .eq('stage_id', stageId)
    if (linksErr || !links) return []

    type LinkRow = { group_id: string; custom_field_groups: { scope: 'contact' | 'deal'; is_active: boolean } | null }
    const activeGroups = (links as unknown as LinkRow[]).filter((l) => l.custom_field_groups?.is_active)
    if (activeGroups.length === 0) return []

    const groupScopeById = new Map(
      activeGroups.map((l) => [l.group_id, l.custom_field_groups!.scope]),
    )
    const groupIds = activeGroups.map((l) => l.group_id)

    const { data: fields, error: fieldsErr } = await db
      .from('custom_fields')
      .select('id, field_name, group_id, required')
      .in('group_id', groupIds)
    if (fieldsErr || !fields || fields.length === 0) return []

    type FieldRow = { id: string; field_name: string; group_id: string; required: boolean }
    const rows = fields as FieldRow[]

    const contactFieldIds = rows.filter((f) => groupScopeById.get(f.group_id) === 'contact').map((f) => f.id)
    const dealFieldIds = rows.filter((f) => groupScopeById.get(f.group_id) === 'deal').map((f) => f.id)

    const [contactValuesRes, dealValuesRes] = await Promise.all([
      contactId && contactFieldIds.length > 0
        ? db.from('contact_custom_values').select('custom_field_id, value').eq('contact_id', contactId).in('custom_field_id', contactFieldIds)
        : Promise.resolve({ data: [] as { custom_field_id: string; value: string | null }[] }),
      dealFieldIds.length > 0
        ? db.from('deal_custom_values').select('custom_field_id, value').eq('deal_id', dealId).in('custom_field_id', dealFieldIds)
        : Promise.resolve({ data: [] as { custom_field_id: string; value: string | null }[] }),
    ])

    const valueByFieldId = new Map<string, string | null>()
    for (const row of contactValuesRes.data ?? []) valueByFieldId.set(row.custom_field_id as string, row.value as string | null)
    for (const row of dealValuesRes.data ?? []) valueByFieldId.set(row.custom_field_id as string, row.value as string | null)

    return rows.map((f) => ({
      id: f.id,
      name: f.field_name,
      scope: groupScopeById.get(f.group_id)!,
      required: f.required,
      value: valueByFieldId.get(f.id) ?? null,
    }))
  } catch {
    return []
  }
}

/** Cheap existence check — does this stage have at least one ACTIVE
 *  group linked? Used for the client-side "open the nudge popup on
 *  stage entry" decision, where the full value resolution above would
 *  be unnecessary work. */
export async function stageHasActiveRequiredGroup(
  db: SupabaseClient,
  stageId: string,
): Promise<boolean> {
  try {
    const { data } = await db
      .from('stage_required_groups')
      .select('group_id, custom_field_groups(is_active)')
      .eq('stage_id', stageId)
    type Row = { custom_field_groups: { is_active: boolean } | null }
    return ((data as unknown as Row[]) ?? []).some((r) => r.custom_field_groups?.is_active)
  } catch {
    return false
  }
}
