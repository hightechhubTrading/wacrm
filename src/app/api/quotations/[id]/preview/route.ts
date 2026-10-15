import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buildQuotationHtml } from '@/lib/quotations/build-html';
import { draftQuotation, validateDraft } from '@/lib/quotations/workspace';
import { mapQuotationRow } from '@/lib/quotations/types';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data } = await ctx.supabase
      .from('quotations')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!data)
      return NextResponse.json(
        { error: 'Quotation not found' },
        { status: 404 }
      );
    const body = await request.json().catch(() => null);
    const error = validateDraft(body?.draft);
    if (error) return NextResponse.json({ error }, { status: 400 });
    const q = draftQuotation(mapQuotationRow(data), body.draft);
    return NextResponse.json(
      { html: buildQuotationHtml(q, q.items) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
