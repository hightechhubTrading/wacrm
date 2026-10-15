// src/lib/quotations/render.ts
//
// Isolated in its own file so pdf.ts's upload/path logic (tested in
// pdf.test.ts, mocked above) never has to actually launch a browser
// in the test suite — only this thin wrapper touches Playwright.
import { chromium } from 'playwright';

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Fonts are self-hosted as embedded base64 data: URIs in the template
    // (final-review fix wave 3) — there is no external network activity to
    // wait for anymore, so 'networkidle' no longer serves a purpose and is
    // a slower, less reliable wait condition than 'load' for a fully
    // self-contained document.
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-family:Arial,sans-serif;font-size:9px;color:#5c7085;width:100%;text-align:right;padding:0 16mm;box-sizing:border-box">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
}
