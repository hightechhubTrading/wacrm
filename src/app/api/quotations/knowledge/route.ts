import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { KNOWLEDGE_KINDS } from '@/lib/quotations/knowledge/types';
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const u = new URL(request.url);
    const { data: batches, error: bError } = await ctx.supabase
      .from('quotation_knowledge_batches')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (bError)
      return NextResponse.json(
        { error: 'Source library unavailable. Apply migration 090.' },
        { status: 503 }
      );
    const batchId = u.searchParams.get('batch') || batches?.[0]?.id;
    if (!batchId)
      return NextResponse.json({
        batches: [],
        records: [],
        count: 0,
        canReview: ['admin', 'owner'].includes(ctx.role),
      });
    const kind = u.searchParams.get('kind');
    const state = u.searchParams.get('status');
    let q = ctx.supabase
      .from('quotation_knowledge_records')
      .select('*', { count: 'exact' })
      .eq('account_id', ctx.accountId)
      .eq('batch_id', batchId);
    if (kind && KNOWLEDGE_KINDS.includes(kind as never)) q = q.eq('kind', kind);
    if (state && ['approved', 'pending', 'rejected'].includes(state))
      q = q.eq('review_status', state);
    const search = (u.searchParams.get('q') ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 150)
      .replace(/[%_\\]/g, '');
    if (search) q = q.ilike('search_text', `%${search}%`);
    const page = Math.max(
      0,
      Math.min(1000, Number(u.searchParams.get('page')) || 0)
    );
    const { data, error, count } = await q
      .order('source')
      .order('source_row')
      .range(page * 50, page * 50 + 49);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      batches,
      records: data,
      count,
      canReview: ['admin', 'owner'].includes(ctx.role),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
