import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ rpc }),
}));

import { getNextQuotationReference } from './reference';

describe('getNextQuotationReference', () => {
  it('calls next_quotation_reference with the account and product code', async () => {
    rpc.mockResolvedValueOnce({ data: 'HT-26-PIV-001', error: null });
    const result = await getNextQuotationReference('acc-1', 'PIV');
    expect(rpc).toHaveBeenCalledWith('next_quotation_reference', {
      p_account_id: 'acc-1',
      p_code: 'PIV',
    });
    expect(result).toBe('HT-26-PIV-001');
  });

  it('throws with the Postgres error message on failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(getNextQuotationReference('acc-1', 'PIV')).rejects.toThrow('boom');
  });
});
