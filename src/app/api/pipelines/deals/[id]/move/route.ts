import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchStageEnterNotification } from '@/lib/pipelines/notify'
import { resolveStageGroupFields } from '@/lib/pipelines/group-values'

/**
 * POST /api/pipelines/deals/[id]/move
 *
 * Body: { stage_id: string }
 *
 * The only server-side path for moving a deal between pipeline stages
 * (previously a bare client-side `supabase.from("deals").update(...)`
 * with no validation — see pipelines/page.tsx). Adds three things that
 * needed a server hook to exist at all:
 *
 *   1. Field-group gating — refuses the move with 422 if any REQUIRED
 *      field in an active custom field group linked (via
 *      `stage_required_groups`, migration 046) to the deal's *current*
 *      stage has no value yet — resolved from `contact_custom_values`
 *      or `deal_custom_values` per the owning group's scope.
 *   2. Contact-identity gating — if the *current* stage is flagged
 *      `requires_contact_identity`, also refuses the move unless the
 *      linked contact's name/phone are filled. Independent of any
 *      group, since name/phone are real `contacts` columns.
 *   3. Notification — if the *target* stage is flagged
 *      `notify_group_on_enter`, fires a best-effort WAHA group message
 *      after the move succeeds, from the deal's ASSIGNED agent's own
 *      WAHA session (migration 045) — never blocks/fails the response.
 *
 * Uses `ctx.supabase` (RLS-scoped to the caller), so authorization is
 * unchanged from today: `deals_update` RLS still restricts an `agent`
 * to deals assigned to them, admin+ to any deal in the account.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id: dealId } = await params

    const body = (await request.json().catch(() => null)) as
      | { stage_id?: unknown }
      | null
    const targetStageId =
      typeof body?.stage_id === 'string' ? body.stage_id.trim() : ''
    if (!targetStageId) {
      return NextResponse.json({ error: 'stage_id is required' }, { status: 400 })
    }

    const { data: deal, error: dealErr } = await ctx.supabase
      .from('deals')
      .select('id, pipeline_id, stage_id, contact_id, title, value, currency, assigned_to')
      .eq('id', dealId)
      .maybeSingle()
    if (dealErr) {
      console.error('[deals/move] deal fetch failed:', dealErr)
      return NextResponse.json({ error: 'Failed to load deal' }, { status: 500 })
    }
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    if (targetStageId === deal.stage_id) {
      return NextResponse.json({ deal })
    }

    // Fetch both the current stage (for gating below) and the target
    // stage (for the pipeline-membership check + notify flag) in one
    // round trip.
    const { data: stageRows, error: stageErr } = await ctx.supabase
      .from('pipeline_stages')
      .select('id, pipeline_id, name, notify_group_on_enter, requires_contact_identity')
      .in('id', [deal.stage_id, targetStageId])
    if (stageErr) {
      console.error('[deals/move] stage fetch failed:', stageErr)
      return NextResponse.json(
        { error: 'Failed to load target stage' },
        { status: 500 },
      )
    }
    const currentStage = stageRows?.find((s) => s.id === deal.stage_id)
    const targetStage = stageRows?.find((s) => s.id === targetStageId)
    if (!targetStage || targetStage.pipeline_id !== deal.pipeline_id) {
      return NextResponse.json(
        { error: "Target stage does not belong to this deal's pipeline" },
        { status: 400 },
      )
    }

    // Gating: required fields in any active custom field group linked
    // to the deal's CURRENT stage.
    const groupFields = await resolveStageGroupFields(ctx.supabase, {
      stageId: deal.stage_id,
      contactId: deal.contact_id,
      dealId: deal.id,
    })
    const missing = groupFields
      .filter((f) => f.required && !f.value?.trim())
      .map((f) => ({ id: f.id, name: f.name }))

    // Contact-identity gating: independent of any group — name/phone
    // must be filled before leaving a stage flagged
    // `requires_contact_identity`.
    if (currentStage?.requires_contact_identity) {
      if (!deal.contact_id) {
        missing.push({ id: 'contact_name', name: 'Client Name' })
        missing.push({ id: 'contact_phone', name: 'Client Phone' })
      } else {
        const { data: contact, error: contactErr } = await ctx.supabase
          .from('contacts')
          .select('name, phone')
          .eq('id', deal.contact_id)
          .maybeSingle()
        if (contactErr) {
          console.error('[deals/move] contact fetch failed:', contactErr)
          return NextResponse.json(
            { error: 'Failed to check stage requirements' },
            { status: 500 },
          )
        }
        if (!contact?.name?.trim()) missing.push({ id: 'contact_name', name: 'Client Name' })
        if (!contact?.phone?.trim()) missing.push({ id: 'contact_phone', name: 'Client Phone' })
      }
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: 'Required fields are missing before this deal can move on.',
          code: 'missing_required_fields',
          fields: missing,
        },
        { status: 422 },
      )
    }

    const { data: updatedDeal, error: updateErr } = await ctx.supabase
      .from('deals')
      .update({ stage_id: targetStageId })
      .eq('id', dealId)
      .select('*')
      .maybeSingle()
    if (updateErr || !updatedDeal) {
      console.error('[deals/move] update failed:', updateErr)
      return NextResponse.json({ error: 'Failed to move deal' }, { status: 500 })
    }

    if (targetStage.notify_group_on_enter) {
      // Best-effort, fire-and-forget — never blocks this response. The
      // deal has already moved at this point; wrapped in try/catch
      // because supabaseAdmin() itself can throw synchronously (e.g. a
      // missing SUPABASE_SERVICE_ROLE_KEY), which — unlike an async
      // rejection inside dispatchStageEnterNotification's own try/catch
      // — would otherwise propagate straight to the outer handler and
      // turn an already-successful move into a reported failure.
      try {
        void dispatchStageEnterNotification({
          db: supabaseAdmin(),
          accountId: ctx.accountId,
          dealId: deal.id,
          stageId: targetStageId,
          contactId: deal.contact_id,
          stageName: targetStage.name,
          dealTitle: deal.title,
          dealValue: deal.value,
          dealCurrency: deal.currency,
          assignedToProfileId: deal.assigned_to ?? null,
        })
      } catch (err) {
        console.error('[deals/move] failed to dispatch group notification:', err)
      }
    }

    return NextResponse.json({ deal: updatedDeal })
  } catch (err) {
    return toErrorResponse(err)
  }
}
