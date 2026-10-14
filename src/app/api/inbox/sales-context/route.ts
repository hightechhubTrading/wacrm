import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (
      !Array.isArray(body?.ids) ||
      body.ids.length > 500 ||
      body.ids.some(
        (id: unknown) =>
          typeof id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id
          )
      )
    )
      return NextResponse.json(
        { error: 'Invalid conversation IDs' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc('inbox_sales_context', {
      p_account: ctx.accountId,
      p_ids: [...new Set(body.ids)],
    });
    if (error)
      return NextResponse.json(
        { error: 'Sales workspace unavailable' },
        { status: 503 }
      );
    return NextResponse.json(data ?? []);
  } catch (e) {
    return toErrorResponse(e);
  }
}
