import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validPack } from '@/lib/quotations/knowledge/validation';
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const raw = await request.text();
    if (raw.length > 12_000_000)
      return NextResponse.json(
        { error: 'Pack exceeds 12 MB.' },
        { status: 413 }
      );
    const pack = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
    if (!validPack(pack))
      return NextResponse.json(
        { error: 'Invalid source pack.' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc(
      'import_quotation_knowledge',
      { p_account_id: ctx.accountId, p_pack: pack }
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ batchId: data }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
