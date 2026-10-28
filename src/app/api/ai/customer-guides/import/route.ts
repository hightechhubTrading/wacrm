import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { customerGuideDrafts } from '@/lib/ai/customer-guide-templates';
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `customer-guide-import:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data: products, error } = await supabase
      .from('ai_products')
      .select('id,name,parent_id,kind,aliases,superseded_by')
      .eq('account_id', accountId);
    if (error) throw error;
    const entries = customerGuideDrafts(products ?? []);
    const { data, error: importError } = await supabase.rpc(
      'import_ai_customer_guides',
      { p_account_id: accountId, p_entries: entries }
    );
    if (importError) throw importError;
    return NextResponse.json({
      success: true,
      added: data,
      matched: entries.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
