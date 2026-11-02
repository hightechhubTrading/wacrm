import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const clientId = new URL(request.url).searchParams.get('client');
    const { data: client } = await ctx.supabase
      .from('quotation_knowledge_records')
      .select('id')
      .eq('id', clientId)
      .eq('account_id', ctx.accountId)
      .eq('kind', 'client')
      .maybeSingle();
    if (!client)
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    const { data, error } = await ctx.supabase.rpc(
      'quotation_archive_history',
      { p_client_id: client.id }
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch (e) {
    return toErrorResponse(e);
  }
}
