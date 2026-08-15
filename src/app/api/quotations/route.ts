import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createQuotation } from '@/lib/quotations/crud';

/**
 * POST /api/quotations
 *
 * accountId always comes from the authenticated caller's own
 * membership (`ctx.accountId`), never from the request body -- the
 * body is untrusted input, and trusting an accountId there would let
 * any agent create quotations under a different tenant's account.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();
    if (!body.productCode) {
      return NextResponse.json({ error: 'productCode is required' }, { status: 400 });
    }
    const quotation = await createQuotation({ ...body, accountId: ctx.accountId });
    return NextResponse.json(quotation, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
