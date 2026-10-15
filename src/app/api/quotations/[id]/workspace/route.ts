import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  draftFields,
  validateDraft,
  type QuotationDraft,
} from '@/lib/quotations/workspace';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const invalid = validateDraft(body?.draft);
    if (invalid || !Number.isInteger(body?.version) || body.version < 0)
      return NextResponse.json(
        { error: invalid ?? 'invalidDraft' },
        { status: 400 }
      );
    const { error } = await ctx.supabase.rpc('save_quotation_workspace', {
      p_id: id,
      p_version: body.version,
      p_fields: draftFields(body.draft as QuotationDraft),
      p_items: body.draft.items,
      p_revise: body.revise === true,
    });
    if (error)
      return NextResponse.json(
        { error: error.code === '40001' ? 'conflict' : error.message },
        { status: error.code === '40001' ? 409 : 400 }
      );
    const { data, error: readError } = await ctx.supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();
    if (readError)
      return NextResponse.json({ error: readError.message }, { status: 400 });
    return NextResponse.json({
      ...mapQuotationRow(data),
      items: (data.quotation_items ?? []).map(mapQuotationItemRow),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
