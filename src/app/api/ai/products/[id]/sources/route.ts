import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const { data: p } = await ctx.supabase
      .from('ai_products')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!p)
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const { data, error } = await ctx.supabase
      .from('product_source_links')
      .select('relationship,notes,source:quotation_knowledge_records(*)')
      .eq('account_id', ctx.accountId)
      .eq('product_id', id)
      .order('created_at');
    if (error)
      return NextResponse.json(
        { error: 'Product source links unavailable. Apply migration 091.' },
        { status: 503 }
      );
    return NextResponse.json({ links: data ?? [] });
  } catch (e) {
    return toErrorResponse(e);
  }
}
