import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validConfiguration } from '@/lib/quotations/knowledge/validation';
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const b = await request.json().catch(() => null);
    if (
      !b ||
      !['approved', 'pending', 'rejected'].includes(b.status) ||
      !Number.isInteger(b.version) ||
      b.version < 0 ||
      typeof b.notes !== 'string' ||
      !b.notes.trim() ||
      b.notes.length > 10000 ||
      !validConfiguration(b.configuration)
    )
      return NextResponse.json(
        { error: 'Enter review notes and a valid configuration.' },
        { status: 400 }
      );
    const { data: r } = await ctx.supabase
      .from('quotation_knowledge_records')
      .select('id,kind,data')
      .eq('id', b.id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!r)
      return NextResponse.json(
        { error: 'Source record not found.' },
        { status: 404 }
      );
    // Accepting documented evidence is separate from preparing a calculation.
    // Missing pricing/cost rules remain non-applicable in calculation validators.
    const pricing = b.configuration.pricing;
    if (
      pricing?.column &&
      pricing.column !== 'confirmed' &&
      (!r.data?.[`col_${pricing.column}`] ||
        Number(r.data[`col_${pricing.column}`]) !== pricing.rate)
    )
      return NextResponse.json(
        {
          error:
            'The rate differs from the selected source column. Choose a directly confirmed rate for an override.',
        },
        { status: 400 }
      );
    const { error } = await ctx.supabase.rpc('review_quotation_knowledge', {
      p_id: b.id,
      p_version: b.version,
      p_status: b.status,
      p_notes: b.notes.trim(),
      p_configuration: b.configuration,
    });
    if (error)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === '40001' ? 409 : 400 }
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
