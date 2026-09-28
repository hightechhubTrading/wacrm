import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * DELETE /api/conversions/[id] -- undo a stage tag in the app.
 *
 * Only sets undone_at: an event already sent to Meta is NOT retracted
 * (the UI says so). A still-unsent row is skipped by the sender while
 * undone. Visibility is checked via the caller's RLS-scoped client
 * (conversion_events_select requires seeing the conversation).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    const { data: row } = await ctx.supabase.from('conversion_events').select('id').eq('id', id).maybeSingle()
    if (!row) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    const { error } = await supabaseAdmin()
      .from('conversion_events')
      .update({ undone_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: 'Could not undo the tag' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
