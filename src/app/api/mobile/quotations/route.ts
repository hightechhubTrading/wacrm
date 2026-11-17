import type { MobileQuotationList } from '@/lib/quotations/mobile-types';
import { mapQuotationRow } from '@/lib/quotations/types';
import {
  mobileAccount,
  mobileResponse,
  mobilePreflight,
} from '@/lib/mobile/conversation';
export const OPTIONS = mobilePreflight;
export async function GET(request: Request) {
  const fail = (status: number, error: string) =>
    mobileResponse(request, Response.json({ error }, { status }));
  try {
    const access = await mobileAccount(request);
    if ('response' in access) return access.response;
    const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
      return fail(400, 'Invalid page');
    const u = new URL(request.url);
    const search = u.searchParams.get('search') ?? '';
    const field = u.searchParams.get('field') ?? 'client_name';
    if (search.length > 100 || !['client_name', 'reference'].includes(field))
      return fail(400, 'Invalid search');
    let query = access.db
      .from('quotations')
      .select(
        'id,reference,revision,status,client_name,project_name,currency,total,updated_at',
        { count: 'exact' }
      )
      .eq('account_id', access.profile.account_id)
      .order('updated_at', { ascending: false })
      .order('id')
      .range(offset, offset + 24);
    if (search)
      query = query.ilike(field, '%' + search.replace(/[\\%_]/g, '\\$&') + '%');
    const result = await query;
    if (result.error) return fail(503, 'Quotations could not be loaded');
    return mobileResponse(
      request,
      Response.json({
        quotations: (result.data ?? []).map((row) => {
          const q = mapQuotationRow(row);
          return {
            id: q.id,
            reference: q.reference,
            revision: q.revision,
            status: q.status,
            clientName: q.clientName,
            projectName: q.projectName,
            currency: q.currency,
            total: q.total,
            updatedAt: q.updatedAt,
          };
        }),
        total: result.count ?? 0,
        nextOffset: offset + 25 < (result.count ?? 0) ? offset + 25 : null,
      } satisfies MobileQuotationList)
    );
  } catch {
    return fail(503, 'Quotations are temporarily unavailable');
  }
}
