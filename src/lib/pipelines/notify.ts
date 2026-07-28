import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/currency'
import { decrypt } from '@/lib/whatsapp/encryption'
import { listCollectedFieldValues } from '@/lib/ai/collect-fields'
import { resolveStageGroupFields } from '@/lib/pipelines/group-values'
import { sendWahaGroupText } from '@/lib/notifications/waha-client'

/**
 * Builds the structured WhatsApp text posted into the internal group
 * (via WAHA, see `waha-client.ts`) when a deal enters a stage flagged
 * `notify_group_on_enter`. WhatsApp groups only render plain text with
 * WhatsApp's own markdown (`*bold*`), so this is the practical ceiling
 * for a "structured message" — same spirit as `buildHandoffSummary`
 * (`src/lib/ai/handoff.ts`).
 */
export function buildStageEnterNotification(args: {
  stageName: string
  dealTitle: string
  dealValue?: number
  dealCurrency?: string
  contactName?: string
  contactPhone?: string
  /** AI/agent-collected custom field values relevant to the visit
   *  (address, preferred date, product, etc). */
  collectedFields?: { name: string; value: string }[]
  /** Values of every field belonging to an active custom field group
   *  linked (via `stage_required_groups`, migration 046) to the stage
   *  the deal just entered — surfaced directly in the group message so
   *  whoever picks up the request sees them without opening the CRM. */
  fieldValues?: { name: string; value: string | null }[]
}): string {
  const {
    stageName,
    dealTitle,
    dealValue,
    dealCurrency,
    contactName,
    contactPhone,
    collectedFields,
    fieldValues,
  } = args

  const lines = [`*${stageName}* — new deal entered this stage`, ``, `*${dealTitle}*`]

  const contactLine = [contactName, contactPhone].filter(Boolean).join(' · ')
  if (contactLine) lines.push(contactLine)

  if (typeof dealValue === 'number' && dealValue > 0) {
    lines.push(formatCurrency(dealValue, dealCurrency))
  }

  const filledFieldValues = (fieldValues ?? []).filter((f) => f.value?.trim())
  if (filledFieldValues.length > 0) {
    lines.push(``)
    for (const f of filledFieldValues) lines.push(`• *${f.name}:* ${f.value}`)
  }

  if (collectedFields && collectedFields.length > 0) {
    lines.push(``)
    for (const f of collectedFields) {
      lines.push(`• *${f.name}:* ${f.value}`)
    }
  }

  return lines.join('\n')
}

/**
 * Fire the WAHA group notification for a deal that just entered a
 * flagged stage. Called from `POST /api/pipelines/deals/[id]/move`
 * *after* the stage update has already succeeded — this must never
 * throw or block that response; a WAHA outage should never fail a
 * deal move. Takes a service-role client since `waha_config` is an
 * account-level setting, not a per-row permission decision (the
 * caller's RLS-scoped move already happened before this runs).
 *
 * Sends from the deal's ASSIGNED agent's own WAHA session (migration
 * 045) — not the account's shared `waha_config.session_name` — so
 * whoever picks up the request in the group knows which agent to
 * report back to. If the deal is unassigned, or the assigned agent
 * has no session configured, the notification is SKIPPED entirely
 * (no fallback to the shared default) so it's never sent under the
 * wrong identity; the skip is logged so it stays debuggable.
 */
export async function dispatchStageEnterNotification(args: {
  db: SupabaseClient
  accountId: string
  /** The deal that just moved — needed to resolve `deal_custom_values`
   *  for any deal-scoped group linked to the target stage. */
  dealId: string
  /** The stage the deal just entered — used to resolve which active
   *  custom field groups (migration 046) are linked via
   *  `stage_required_groups`. */
  stageId: string
  contactId: string | null
  stageName: string
  dealTitle: string
  dealValue?: number
  dealCurrency?: string
  /** `deals.assigned_to` — a FK to `profiles.id` (the PK), NOT
   *  `profiles.user_id`. Must be looked up by `id` below. */
  assignedToProfileId?: string | null
}): Promise<void> {
  const {
    db,
    accountId,
    dealId,
    stageId,
    contactId,
    stageName,
    dealTitle,
    dealValue,
    dealCurrency,
    assignedToProfileId,
  } = args
  try {
    const { data: config, error } = await db
      .from('waha_config')
      .select('base_url, api_key, group_chat_id, is_active')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !config || !config.is_active) return
    if (!config.base_url || !config.api_key || !config.group_chat_id) return

    if (!assignedToProfileId) {
      console.log(
        `[pipelines/notify] deal is unassigned for account ${accountId} — skipping WAHA notification (no per-agent session to send from).`,
      )
      return
    }
    const { data: agentProfile, error: profileErr } = await db
      .from('profiles')
      .select('waha_session_name')
      .eq('id', assignedToProfileId)
      .maybeSingle()
    if (profileErr) {
      console.error('[pipelines/notify] assigned-agent profile lookup failed:', profileErr)
      return
    }
    const session = agentProfile?.waha_session_name?.trim()
    if (!session) {
      console.log(
        `[pipelines/notify] assigned agent ${assignedToProfileId} has no waha_session_name configured — skipping WAHA notification.`,
      )
      return
    }

    let contactName: string | undefined
    let contactPhone: string | undefined
    let collectedFields: { name: string; value: string }[] = []
    if (contactId) {
      const { data: contact } = await db
        .from('contacts')
        .select('name, phone')
        .eq('id', contactId)
        .maybeSingle()
      contactName = contact?.name ?? undefined
      contactPhone = contact?.phone ?? undefined
      collectedFields = await listCollectedFieldValues(db, accountId, contactId)
    }

    const groupFields = await resolveStageGroupFields(db, { stageId, contactId, dealId })
    const fieldValues = groupFields.map((f) => ({ name: f.name, value: f.value }))

    const text = buildStageEnterNotification({
      stageName,
      dealTitle,
      dealValue,
      dealCurrency,
      contactName,
      contactPhone,
      collectedFields,
      fieldValues,
    })

    const apiKey = decrypt(config.api_key)
    const result = await sendWahaGroupText({
      baseUrl: config.base_url,
      apiKey,
      session,
      chatId: config.group_chat_id,
      text,
    })
    if (!result.ok) {
      console.error('[pipelines/notify] WAHA send failed:', result.error)
    }
  } catch (err) {
    console.error('[pipelines/notify] dispatch failed:', err)
  }
}
