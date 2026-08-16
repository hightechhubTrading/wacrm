// src/lib/quotations/pdf.ts
import { supabaseAdmin } from './admin-client';
import { buildQuotationHtml } from './build-html';
import { renderHtmlToPdf } from './render';
import type { Quotation, QuotationItem } from './types';

export async function generateQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
): Promise<{ storagePath: string; publicUrl: string }> {
  const html = buildQuotationHtml(quotation, items);
  const pdfBuffer = await renderHtmlToPdf(html);

  const storagePath = `${quotation.id}/rev-${quotation.revision}.pdf`;
  const bucket = supabaseAdmin().storage.from('quotation-pdfs');

  // cacheControl: '0' -- storagePath is fixed per revision, and revision
  // doesn't currently change on a regenerate (known limitation), so an
  // upsert overwrites the SAME path every time. Supabase defaults to a
  // 1-hour cache when this isn't set, which means a rep who already
  // opened this URL once could keep seeing the pre-regenerate PDF for up
  // to an hour even though the underlying object was correctly replaced.
  const { error } = await bucket.upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
    cacheControl: '0',
  });
  if (error) throw new Error(error.message);

  const { data } = bucket.getPublicUrl(storagePath);
  // Belt-and-suspenders alongside cacheControl: '0' above -- a query-
  // string cache-buster forces a fresh fetch even through an
  // intermediate proxy/CDN or a browser that ignores/caches past the
  // Cache-Control header for some reason. This value only needs to be
  // unique per generation, not meaningful on its own.
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
  return { storagePath, publicUrl };
}
