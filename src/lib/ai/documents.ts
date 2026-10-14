export type DocumentResult = {
  status: 'parsed' | 'partial' | 'unsupported' | 'failed';
  text: string | null;
};
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 16000;
export function supportedDocument(mime: string): boolean {
  return [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ].includes(mime.split(';')[0]);
}
/** Reject oversized expanded XLSX archives before allocating workbook objects. */
function boundedZip(buffer: Buffer): boolean {
  let expanded = 0,
    entries = 0;
  for (
    let i = Math.max(0, buffer.length - 65557);
    i <= buffer.length - 22;
    i++
  ) {
    if (buffer.readUInt32LE(i) !== 0x06054b50) continue;
    const count = buffer.readUInt16LE(i + 10);
    let cursor = buffer.readUInt32LE(i + 16);
    if (count > 500 || cursor >= buffer.length) return false;
    for (let n = 0; n < count; n++) {
      if (
        cursor + 46 > buffer.length ||
        buffer.readUInt32LE(cursor) !== 0x02014b50
      )
        return false;
      expanded += buffer.readUInt32LE(cursor + 24);
      entries++;
      if (expanded > 20 * 1024 * 1024) return false;
      cursor +=
        46 +
        buffer.readUInt16LE(cursor + 28) +
        buffer.readUInt16LE(cursor + 30) +
        buffer.readUInt16LE(cursor + 32);
    }
    return entries > 0;
  }
  return false;
}
export async function extractDocument(
  buffer: Buffer,
  mime: string
): Promise<DocumentResult> {
  if (!supportedDocument(mime)) return { status: 'unsupported', text: null };
  if (!buffer.length || buffer.length > MAX_BYTES)
    return { status: 'failed', text: null };
  try {
    let text = '',
      partial = false;
    if (mime.startsWith('text/'))
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    else if (mime === 'application/pdf') {
      if (buffer.subarray(0, 5).toString() !== '%PDF-')
        return { status: 'failed', text: null };
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
      });
      try {
        const result = await parser.getText({ first: 10 });
        text = result.text;
        partial = result.total > 10;
      } finally {
        await parser.destroy();
      }
    } else {
      if (!boundedZip(buffer)) return { status: 'failed', text: null };
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(new Uint8Array(buffer).buffer);
      const lines: string[] = [];
      let cells = 0;
      for (const sheet of workbook.worksheets.slice(0, 10)) {
        lines.push(`[Sheet: ${sheet.name}]`);
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber > 500 || cells >= 5000) {
            partial = true;
            return;
          }
          const values: string[] = [];
          row.eachCell((cell, column) => {
            if (column > 50 || cells >= 5000) {
              partial = true;
              return;
            }
            cells++;
            values.push(`${cell.address}: ${cell.text.slice(0, 500)}`);
          });
          lines.push(values.join(' | '));
        });
      }
      partial ||= workbook.worksheets.length > 10;
      text = lines.join('\n');
    }
    text = text.replace(/\u0000/g, '').trim();
    if (!text || (mime.includes('spreadsheetml') && !/\w\d+:/.test(text)))
      return { status: 'failed', text: null };
    partial ||= text.length > MAX_TEXT;
    return {
      status: partial ? 'partial' : 'parsed',
      text: text.slice(0, MAX_TEXT),
    };
  } catch {
    return { status: 'failed', text: null };
  }
}
