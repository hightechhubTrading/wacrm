import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadQuotationCatalogue } from '@/lib/quotations/catalogue-server';
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    return NextResponse.json({
      items: await loadQuotationCatalogue(ctx.supabase, ctx.accountId),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
