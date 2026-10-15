import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { generateQuotationPdf } from '@/lib/quotations/pdf';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';
import { draftFromQuotation, validateDraft } from '@/lib/quotations/workspace';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('quotation_documents')
      .select(
        'id,revision,workspace_version,storage_path,created_at,sent_at,message_id,snapshot'
      )
      .eq('quotation_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(
      (data ?? []).map(({ snapshot, ...document }) => ({
        ...document,
        legacy: snapshot?.legacy === true,
      }))
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const { data: row } = await ctx.supabase
      .from('quotations')
      .select('*,quotation_items(*)')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!row)
      return NextResponse.json(
        { error: 'Quotation not found' },
        { status: 404 }
      );
    const q = {
      ...mapQuotationRow(row),
      items: (row.quotation_items ?? []).map(mapQuotationItemRow),
    };
    if (body?.version !== q.workspaceVersion)
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    const invalid = validateDraft(draftFromQuotation(q), true, q.currency);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const { data: existing } = await ctx.supabase
      .from('quotation_documents')
      .select('id,storage_path,revision')
      .eq('quotation_id', id)
      .eq('workspace_version', q.workspaceVersion)
      .neq('send_state', 'legacy')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing)
      return NextResponse.json({
        documentId: existing.id,
        storagePath: existing.storage_path,
        revision: existing.revision,
        publicUrl: ctx.supabase.storage
          .from('quotation-pdfs')
          .getPublicUrl(existing.storage_path).data.publicUrl,
      });
    const documentId = crypto.randomUUID();
    const generated = await generateQuotationPdf(
      q,
      q.items,
      `${id}/rev-${q.revision}-${documentId}.pdf`
    );
    const { error } = await ctx.supabase.rpc('publish_quotation_document', {
      p_id: id,
      p_version: q.workspaceVersion,
      p_document_id: documentId,
      p_path: generated.storagePath,
      p_snapshot: q,
    });
    if (error) {
      await supabaseAdmin()
        .storage.from('quotation-pdfs')
        .remove([generated.storagePath]);
      return NextResponse.json(
        { error: error.code === '40001' ? 'conflict' : error.message },
        { status: error.code === '40001' ? 409 : 400 }
      );
    }
    return NextResponse.json({
      ...generated,
      documentId,
      revision: q.revision,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
