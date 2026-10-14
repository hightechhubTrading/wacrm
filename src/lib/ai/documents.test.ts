import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { extractDocument, supportedDocument } from './documents';
describe('document evidence extraction', () => {
  it('retains bounded text and marks partial evidence explicitly', async () => {
    const result = await extractDocument(
      Buffer.from('a'.repeat(20000)),
      'text/plain'
    );
    expect(result.status).toBe('partial');
    expect(result.text).toHaveLength(16000);
  });
  it('routes DWG and scanned/invalid documents to human review instead of inventing contents', async () => {
    expect(supportedDocument('application/acad')).toBe(false);
    expect(
      (await extractDocument(Buffer.from('drawing'), 'application/acad')).status
    ).toBe('unsupported');
    expect(
      (await extractDocument(Buffer.from('not a PDF'), 'application/pdf'))
        .status
    ).toBe('failed');
    expect(
      (
        await extractDocument(
          Buffer.from('not a ZIP'),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
      ).status
    ).toBe('failed');
  });
  it('extracts actual spreadsheet cells and never evaluates formulas', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Openings');
    sheet.addRow(['Opening', 'Width', 'Height']);
    sheet.addRow(['Window 5', 120, 180]);
    sheet.getCell('D2').value = { formula: '2+2', result: 4 };
    const result = await extractDocument(
      Buffer.from(await book.xlsx.writeBuffer()),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(result.status).toBe('parsed');
    expect(result.text).toContain('A2: Window 5');
    expect(result.text).toContain('B2: 120');
  });
  it('rejects oversized or corrupt UTF-8 input', async () => {
    expect(
      (await extractDocument(Buffer.alloc(5 * 1024 * 1024 + 1), 'text/plain'))
        .status
    ).toBe('failed');
    expect(
      (await extractDocument(Buffer.from([0xff]), 'text/plain')).status
    ).toBe('failed');
  });
});
it('extracts actual PDF text without claiming drawing/image understanding', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 48 >>\nstream\nBT /F1 12 Tf 20 200 Td (Window five 120x180) Tj ET\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
    .join(
      '\n'
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result = await extractDocument(Buffer.from(pdf), 'application/pdf');
  expect(result.status).toBe('parsed');
  expect(result.text).toContain('Window five 120x180');
});
