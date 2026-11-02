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
    const productId = u.searchParams.get('productId');
    const productIds: string[] = [];
    if (productId) {
      if (!/^[0-9a-f-]{36}$/i.test(productId))
        return NextResponse.json(
          { error: 'Invalid product ID' },
          { status: 400 }
        );
      let id: string | null = productId;
      while (id && !productIds.includes(id) && productIds.length < 20) {
        const response = await ctx.supabase
          .from('ai_products')
          .select('id,parent_id')
          .eq('account_id', ctx.accountId)
          .eq('id', id)
          .maybeSingle();
        const product = response.data as {id:string;parent_id:string|null}|null;
        if (response.error)
          return NextResponse.json(
            { error: 'Product sources unavailable' },
            { status: 503 }
          );
        if (!product) {
          if (!productIds.length)
            return NextResponse.json(
              { error: 'Product not found' },
              { status: 404 }
            );
          break;
        }
        productIds.push(product.id);
        id = product.parent_id;
      }
    }
    let q = ctx.supabase
      .from('quotation_knowledge_records')
      .select(productId ? '*,product_source_links!inner(product_id)' : '*', {
        count: 'exact',
      })
      .eq('account_id', ctx.accountId)
      .eq('batch_id', batchId);
    if (productId) q = q.in('product_source_links.product_id', productIds);
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
