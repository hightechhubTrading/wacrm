import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { dispatchQuotation } from '@/lib/quotations/dispatch';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    return await dispatchQuotation(
      ctx,
      (await params).id,
      await request.json().catch(() => null)
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
