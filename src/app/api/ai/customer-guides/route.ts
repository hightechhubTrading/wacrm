import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  guideProductChain,
  nearestCustomerGuide,
  parseGuideSections,
  renderGuideContent,
  type CustomerGuide,
} from '@/lib/ai/customer-guides';
import { validSourceUrl } from '@/lib/ai/catalog';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadEmbeddingsKey } from '@/lib/ai/config';
import { ingestDocument } from '@/lib/ai/knowledge';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields =
  'id,product_id,title,status,document_type,guide_sections,source_url,source_notes,updated_at,content';
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const id = new URL(request.url).searchParams.get('product_id');
    if (!id || !uuid.test(id))
      return NextResponse.json({ error: 'Choose a product.' }, { status: 400 });
    const { data: products, error } = await supabase
      .from('ai_products')
      .select('id,name,parent_id,kind,superseded_by')
      .eq('account_id', accountId);
    if (error) throw error;
    const chain = guideProductChain(products ?? [], id);
    if (!chain.length)
      return NextResponse.json(
        { error: 'Product not found.' },
        { status: 404 }
      );
    const { data: guides, error: guideError } = await supabase
      .from('ai_knowledge_documents')
      .select(fields)
      .eq('account_id', accountId)
      .eq('document_type', 'customer_guide')
      .in(
        'product_id',
        chain.map((p) => p.id)
      );
    if (guideError) throw guideError;
    const guide = nearestCustomerGuide(
      products ?? [],
      id,
      (guides ?? []) as CustomerGuide[]
    );
    return NextResponse.json({
      guide,
      owner: guide ? chain.find((p) => p.id === guide.product_id) : null,
      inherited: !!guide && guide.product_id !== id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
async function save(request: Request, create: boolean) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `customer-guide:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.product_id !== 'string' ||
      !uuid.test(body.product_id)
    )
      return NextResponse.json({ error: 'Choose a product.' }, { status: 400 });
    if (
      !create &&
      (typeof body.id !== 'string' ||
        !uuid.test(body.id) ||
        typeof body.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(body.updated_at)))
    )
      return NextResponse.json(
        { error: 'Reload the guide before saving.' },
        { status: 400 }
      );
    const status = body.status ?? 'draft';
    if (!['draft', 'approved'].includes(status))
      return NextResponse.json(
        { error: 'Choose draft or approved.' },
        { status: 400 }
      );
    let sections;
    try {
      sections = parseGuideSections(body.guide_sections, status === 'approved');
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    if (
      !validSourceUrl(body.source_url ?? null) ||
      typeof (body.source_notes ?? '') !== 'string' ||
      (body.source_notes ?? '').length > 12000
    )
      return NextResponse.json(
        { error: 'Check the guide source and review notes.' },
        { status: 400 }
      );
    const { data: products, error: readError } = await supabase
      .from('ai_products')
      .select('id,name,parent_id,kind,superseded_by')
      .eq('account_id', accountId);
    if (readError) throw readError;
    const chain = guideProductChain(products ?? [], body.product_id);
    if (!chain.length)
      return NextResponse.json(
        { error: 'Product not found.' },
        { status: 404 }
      );
    const row = {
      title: `Customer guide · ${chain[0].name}`,
      content: renderGuideContent(sections),
      status,
      topic: 'product',
      product_id: body.product_id,
      document_type: 'customer_guide',
      guide_sections: sections,
      source_url:
        typeof body.source_url === 'string'
          ? body.source_url.trim() || null
          : null,
      source_notes: (body.source_notes ?? '').trim(),
    };
    const query = create
      ? supabase
          .from('ai_knowledge_documents')
          .insert({ ...row, account_id: accountId, created_by: userId })
      : supabase
          .from('ai_knowledge_documents')
          .update(row)
          .eq('account_id', accountId)
          .eq('id', body.id)
          .eq('product_id', body.product_id)
          .eq('document_type', 'customer_guide')
          .eq('updated_at', body.updated_at);
    const { data: saved, error } = await query.select(fields).maybeSingle();
    if (error)
      return NextResponse.json(
        {
          error:
            error.code === '23505'
              ? 'This product already has a guide. Reload to edit it.'
              : 'Could not save the guide.',
        },
        { status: error.code === '23505' || error.code === '23514' ? 409 : 500 }
      );
    if (!saved)
      return NextResponse.json(
        {
          error: 'The guide changed since you opened it. Reload before saving.',
        },
        { status: 409 }
      );
    let warning: string | undefined;
    if (saved.status === 'approved') {
      const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
        supabase,
        accountId
      );
      try {
        await ingestDocument(
          supabase,
          accountId,
          { embeddingsApiKey },
          saved.id,
          saved.content
        );
        if (corrupt)
          warning =
            'Saved with keyword search only. Check your embeddings key.';
      } catch {
        warning =
          'Guide saved, but search indexing needs attention. Refresh search to retry.';
      }
    }
    return NextResponse.json({
      success: true,
      guide: saved,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
export async function POST(request: Request) {
  return save(request, true);
}
export async function PATCH(request: Request) {
  return save(request, false);
}
