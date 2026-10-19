import { NextResponse, after } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
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
 * written atomically by record_conversation_conversion(); Meta is only called
 * after the response, by the sender.
 *
 * Won marks the conversation's latest deal won with the value in QAR --
 * the deals trigger enqueues Purchase too, and the RPC's explicit enqueue
 * is idempotent (event_id is unique), so an already-won deal still ends
 * up tagged exactly once.
 *
 * An authenticated RPC authorizes the conversation and deal under row locks.
 * Unassigned auto-created leads remain writable by their conversation's
 * assignee; a deal assigned to another agent requires administrator access.
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

    const { error: conversionError } = await ctx.supabase.rpc('record_conversation_conversion', {
      p_conversation_id: conversationId,
      p_stage: stage,
      p_value: value,
    })
    if (conversionError) {
      const status = conversionError.code === '42501' ? 403 : conversionError.code === 'P0002' ? (stage === 'won' ? 409 : 404) : 500
      return NextResponse.json({ error: status === 403 ? 'Conversation or deal is not assigned to you' : 'Could not record conversion' }, { status })
    }

    after(() => kickConversionSender())
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
