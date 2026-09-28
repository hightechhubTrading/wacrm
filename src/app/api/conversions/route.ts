import { NextResponse, after } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { kickConversionSender } from '@/lib/conversions/poller'
import { isConversionStage } from '@/lib/conversions/stages'

/**
 * POST /api/conversions
 *
 * Body: { conversation_id, stage: 'qualified' | 'site_visit' | 'won', value? }
 *
 * Tags a conversation's lead-quality stage (CTWA conversions, migration
 * 065). Visibility is checked with the caller's RLS-scoped client, so an
 * agent can only tag conversations assigned to them. The outbox row is
 * written by enqueue_conversion() (service role); Meta is only called
 * after the response, by the sender.
 *
 * Won marks the conversation's latest deal won with the value in QAR --
 * the deals trigger enqueues Purchase too, and the explicit enqueue here
 * is idempotent (event_id is unique), so an already-won deal still ends
 * up tagged exactly once.
 *
 * The deal is read/written with the service role, keyed by the
 * conversation the caller was just shown to be allowed to see: the lead
 * deal auto-created by migration 041 has no assigned_to, so an agent's
 * RLS client usually can't see it even on their own conversation.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const body = (await request.json().catch(() => null)) as
      | { conversation_id?: unknown; stage?: unknown; value?: unknown }
      | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const stage = body?.stage
    if (!conversationId || !isConversionStage(stage)) {
      return NextResponse.json({ error: 'conversation_id and a valid stage are required' }, { status: 400 })
    }

    let value: number | null = null
    if (stage === 'won') {
      value = typeof body?.value === 'number' ? body.value : typeof body?.value === 'string' && body.value.trim() ? Number(body.value) : NaN
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json({ error: 'value must be a number greater than 0' }, { status: 400 })
      }
    }

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    let dealId: string | null = null
    if (stage === 'won') {
      const { data: deal } = await supabaseAdmin()
        .from('deals')
        .select('id, status')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!deal) {
        return NextResponse.json(
          { error: 'No deal is linked to this conversation. Create one in Pipelines first.' },
          { status: 409 },
        )
      }
      const { data: updated, error: updateError } = await supabaseAdmin()
        .from('deals')
        .update({ value, currency: 'QAR', status: 'won' })
        .eq('id', deal.id)
        .select('id')
      if (updateError || !updated || updated.length === 0) {
        return NextResponse.json({ error: 'Could not update the deal' }, { status: 500 })
      }
      dealId = deal.id
    }

    const { error: enqueueError } = await supabaseAdmin().rpc('enqueue_conversion', {
      p_conversation_id: conversationId,
      p_stage: stage,
      p_value: value,
      p_currency: stage === 'won' ? 'QAR' : null,
      p_deal_id: dealId,
      p_user_id: ctx.userId,
    })
    if (enqueueError) {
      console.error('[conversions] enqueue failed:', enqueueError.message)
      return NextResponse.json({ error: 'Could not save the tag' }, { status: 500 })
    }

    after(() => kickConversionSender())
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
