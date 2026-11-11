// src/lib/quotations/render.ts
//
// Isolated in its own file so pdf.ts's upload/path logic (tested in
// pdf.test.ts, mocked above) never has to actually launch a browser
// in the test suite — only this thin wrapper touches Playwright.
import { chromium } from 'playwright';
import { DOCUMENT_PDF_OPTIONS } from './document-layout';

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
    });
    // The template is self-contained (including fonts). Reject all network
    // requests even if a future field escapes validation/HTML encoding.
    await page.route('**/*', (route) => route.abort());
    // Fonts are self-hosted as embedded base64 data: URIs in the template
    // (final-review fix wave 3) — there is no external network activity to
    // wait for anymore, so 'networkidle' no longer serves a purpose and is
    // a slower, less reliable wait condition than 'load' for a fully
    // self-contained document.
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map(async (image) => {
          await image.decode();
          if (!image.naturalWidth) throw new Error('referenceImageUnavailable');
        })
      );
    });
    return await page.pdf(DOCUMENT_PDF_OPTIONS);
  } finally {
    await browser.close();
  }
}
