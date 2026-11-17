import {
  mobileQuotation,
  currentQuotationDocument,
} from '@/lib/mobile/quotations';
import { mobileResponse, mobilePreflight } from '@/lib/mobile/conversation';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
export const OPTIONS = mobilePreflight;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const fail = (status: number, error: string) =>
    mobileResponse(request, Response.json({ error }, { status }));
  try {
    const access = await mobileQuotation(request, (await params).id);
    if ('response' in access) return access.response;
    const document = await currentQuotationDocument(access),
      u = new URL(request.url);
    if (
      !document ||
      u.searchParams.get('version') !== String(document.workspace_version) ||
      u.searchParams.get('document') !== (document.id ?? 'legacy')
    )
      return fail(
        409,
        'Quotation changed. Refresh and prepare the latest PDF in the CRM.'
      );
    const { data, error } = await supabaseAdmin()
      .storage.from('quotation-pdfs')
      .download(document.storage_path);
    if (error || !data) return fail(404, 'Quotation PDF unavailable');
    if (data.size > 16 * 1024 * 1024)
      return fail(413, 'PDF exceeds the viewing limit');
    if (data.size < 5) return fail(422, 'This document is not a valid PDF');
    const bytes = await data.arrayBuffer();
    if (Buffer.from(bytes, 0, 5).toString() !== '%PDF-')
      return fail(422, 'This document is not a valid PDF');
    return mobileResponse(
      request,
      new Response(bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="quotation.pdf"',
        },
      })
    );
  } catch {
    return fail(503, 'Quotation PDF is temporarily unavailable');
  }
}
