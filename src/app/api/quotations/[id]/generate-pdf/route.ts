import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { generateQuotationPdf } from '@/lib/quotations/pdf';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/quotations/[id]/generate-pdf
 *
 * Same RLS-backed visibility check as GET/PATCH on this quotation
 * (Task 6): ctx.supabase, not the admin client, and a 404 (not 403)
 * when the row isn't visible to the caller.
 *
 * The row comes back from Supabase snake_case; generateQuotationPdf
 * (Task 9) and buildQuotationHtml underneath it read the camelCase
 * `Quotation`/`QuotationItem` shape. Every quotation row MUST go
 * through mapQuotationRow/mapQuotationItemRow before reaching either —
 * this is the exact bug Task 5's review caught (a bare cast let
 * `reference`/`status` pass silently while every other field went
 * `undefined`); it doesn't get to happen again here.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: row, error } = await ctx.supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!row) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { quotation_items, ...quotationRow } = row as Record<string, any>;
    const quotation = mapQuotationRow(quotationRow);
    const items = (quotation_items ?? []).map(mapQuotationItemRow);

    // A quotation that's already been sent gets a bumped revision on
    // every re-generate, so a re-sent PDF is visibly distinct from the
    // one the client already has; a still-draft quotation keeps its
    // current revision.
    const revision = quotation.status === 'sent' ? quotation.revision + 1 : quotation.revision;

    const { storagePath, publicUrl } = await generateQuotationPdf(
      { ...quotation, revision },
      items,
    );

    const { error: updateErr } = await ctx.supabase
      .from('quotations')
      .update({ pdf_storage_path: storagePath, revision })
      .eq('id', id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

    return NextResponse.json({ storagePath, publicUrl, revision });
  } catch (err) {
    return toErrorResponse(err);
  }
}
