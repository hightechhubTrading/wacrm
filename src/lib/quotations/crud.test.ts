import { describe, expect, it, vi } from 'vitest';
import type { QuotationItemToSave } from './crud';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ rpc, from }),
}));
vi.mock('./reference', () => ({
  getNextQuotationReference: vi.fn().mockResolvedValue('HT-26-PIV-001'),
}));

import { createQuotation, saveQuotationItems } from './crud';
import { mapQuotationRow, mapQuotationItemRow } from './types';

function chain(finalResult: unknown) {
  const builder: Record<string, unknown> = {};
  ['insert', 'update', 'select', 'eq', 'delete'].forEach((m) => {
    builder[m] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(finalResult);
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

describe('mapQuotationRow', () => {
  it('maps every snake_case column to its camelCase field, not just the ones that happen to match', () => {
    const row = {
      id: 'q-1', account_id: 'acc-1', reference: 'HT-26-PIV-001', revision: 0, status: 'draft',
      client_name: 'Ahmed', client_phone: '+97455509200', client_company: 'Al Sulaiti Villas',
      location: 'Al Waab', project_name: 'Private villa', subject: 'Pivot Door', currency: 'QAR',
      contact_id: null, deal_id: null, assigned_to: 'p-1', discount_type: null, discount_value: null,
      subtotal: 3600, discount_amount: 0, total: 3600, valid_until: '2026-03-01', pdf_storage_path: null,
    };
    const result = mapQuotationRow(row);
    expect(result.accountId).toBe('acc-1');
    expect(result.clientName).toBe('Ahmed');
    expect(result.projectName).toBe('Private villa');
    expect(result.assignedTo).toBe('p-1');
  });
});

describe('mapQuotationItemRow', () => {
  it('maps size and description fields, not just the arithmetic ones', () => {
    const row = {
      id: 'i-1', quotation_id: 'q-1', parent_item_id: null, product_id: null, position: 0,
      item_type: 'line', kind: null, item_code: 'D01', description: 'Pivot door', description_ar: null,
      size_w: 1.74, size_h: 3.86, qty: 1, unit_price: 16000, discount_type: null, discount_value: null,
      line_total: 16000,
    };
    const result = mapQuotationItemRow(row);
    expect(result.description).toBe('Pivot door');
    expect(result.sizeW).toBe(1.74);
    expect(result.sizeH).toBe(3.86);
  });
});

describe('createQuotation', () => {
  it('fetches a reference number, inserts, and returns a fully-mapped Quotation', async () => {
    const inserted = {
      id: 'q-1', reference: 'HT-26-PIV-001', account_id: 'acc-1', status: 'draft',
      client_name: 'Ahmed', subtotal: 0, discount_amount: 0, total: 0,
    };
    from.mockReturnValueOnce(chain({ data: inserted, error: null }));

    const result = await createQuotation({ accountId: 'acc-1', productCode: 'PIV', currency: 'QAR' });

    expect(from).toHaveBeenCalledWith('quotations');
    expect(result.reference).toBe('HT-26-PIV-001');
    expect(result.status).toBe('draft');
    expect(result.accountId).toBe('acc-1'); // the field the original bug silently dropped
    expect(result.clientName).toBe('Ahmed');
  });
});

describe('saveQuotationItems', () => {
  it('recomputes totals server-side and saves atomically via one RPC call, with description/size fields intact', async () => {
    rpc.mockResolvedValueOnce({ error: null });

    const items: QuotationItemToSave[] = [{
      id: 'a1111111-1111-1111-1111-111111111111', itemType: 'line', qty: 1, unitPrice: 3600,
      description: 'Electric roll-up door', sizeW: 3.66, sizeH: 2.6,
    }];
    await saveQuotationItems('q-1', 'acc-1', items);

    expect(rpc).toHaveBeenCalledWith('save_quotation_items', expect.objectContaining({
      p_quotation_id: 'q-1',
      p_account_id: 'acc-1',
      p_subtotal: 3600,
      p_discount_amount: 0,
      p_total: 3600,
    }));
    const call = rpc.mock.calls[0][1];
    expect(call.p_items[0].description).toBe('Electric roll-up door');
    expect(call.p_items[0].size_w).toBe(3.66);
  });

  it('throws with the Postgres error message on failure, e.g. the Unauthorized case', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'Unauthorized' } });
    const items: QuotationItemToSave[] = [{ id: 'a1111111-1111-1111-1111-111111111111', itemType: 'line', qty: 1, unitPrice: 100 }];
    await expect(saveQuotationItems('q-1', 'acc-1', items)).rejects.toThrow('Unauthorized');
  });
});
