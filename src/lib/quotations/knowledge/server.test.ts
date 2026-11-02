import { describe, it, expect, vi } from 'vitest';
import { verifyKnowledgeSnapshots } from './server';
import { calculatePrice, snapshot } from './calculations';
import { record, item } from './test-fixtures';
import type { QuotationDraft } from '../workspace';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KnowledgeRecord } from './types';
const mock = (data: KnowledgeRecord | null, approved = true) => {
  const eq = vi.fn();
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => {
        eq(...args);
        return chain;
      },
      in: () => chain,
      or: () => chain,
      then: (yes: (value: unknown) => unknown, no: (err: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === 'quotation_knowledge_reviews' && data
              ? [
                  {
                    record_id: data.id,
                    version: 1,
                    status: approved ? 'approved' : 'rejected',
                    configuration: record.configuration,
                    created_at: record.reviewed_at,
                  },
                ]
              : data
                ? [data]
                : [],
          error: null,
        }).then(yes, no),
    };
    return chain;
  });
  return { db: { from } as unknown as SupabaseClient, eq, from };
};
const draft = () => {
  const result = calculatePrice(record, item);
  return {
    items: [{ ...item, unitPrice: result.unitPrice }],
    documentDetails: {
      knowledge: { prices: { [item.id]: result.snapshot }, references: [] },
    },
  } as Pick<QuotationDraft, 'items' | 'documentDetails'>;
};
describe('source verification before saving or exporting', () => {
  it('accepts current evidence, rejects forged labels and foreign/missing records', async () => {
    const d = draft();
    const { db, eq } = mock(record);
    expect(await verifyKnowledgeSnapshots(db, 'account', d)).toBeNull();
    expect(eq).toHaveBeenCalledWith('account_id', 'account');
    d.documentDetails.knowledge!.prices[item.id].label = 'Forged';
    expect(await verifyKnowledgeSnapshots(db, 'account', d)).toContain(
      'changed'
    );
    expect(
      await verifyKnowledgeSnapshots(mock(null).db, 'account', d)
    ).toContain('not found');
  });
  it('preserves historical approvals after later price changes and rejections', async () => {
    const d = draft();
    const r = {
      ...record,
      review_status: 'rejected' as const,
      review_version: 2,
    };
    const { db, from } = mock(r);
    expect(
      await verifyKnowledgeSnapshots(
        db,
        'account',
        d,
        structuredClone(d.documentDetails.knowledge)
      )
    ).toBeNull();
    expect(from).toHaveBeenCalledWith('quotation_knowledge_reviews');
    expect(
      await verifyKnowledgeSnapshots(db, 'account', d, undefined, true)
    ).toBeNull();
  });
  it('rejects forged approval metadata saved through a direct RPC', async () => {
    const d = draft();
    expect(
      await verifyKnowledgeSnapshots(
        mock(record, false).db,
        'account',
        d,
        undefined,
        true
      )
    ).toContain('approval not found');
    d.documentDetails.knowledge!.prices[item.id].configuration.pricing!.rate =
      1;
    expect(
      await verifyKnowledgeSnapshots(
        mock(record).db,
        'account',
        d,
        undefined,
        true
      )
    ).toContain('changed');
  });
  it('rejects new evidence after approval changes, while retaining a reasoned manual override of an earlier approval', async () => {
    const d = draft();
    expect(
      await verifyKnowledgeSnapshots(
        mock({ ...record, review_status: 'pending' }).db,
        'account',
        d
      )
    ).toContain('changed');
    const k = d.documentDetails.knowledge!;
    const s = k.prices[item.id];
    const manual = {
      prices: {},
      references: [],
      manualOverrides: [
        {
          itemId: item.id,
          previous: s,
          reason: 'Manager confirmed special price',
          unitPrice: 350,
          unit: 'm2',
          at: new Date().toISOString(),
        },
      ],
    };
    expect(
      await verifyKnowledgeSnapshots(
        mock({ ...record, review_status: 'rejected' }).db,
        'account',
        { ...d, documentDetails: { knowledge: manual } },
        k
      )
    ).toBeNull();
  });
  it('verifies saved supplier cost snapshots against their approval rather than trusting a client-side cost', async () => {
    const r: KnowledgeRecord = {
      ...record,
      kind: 'supplier',
      configuration: {
        supplierCost: {
          itemId: 'HT-WSC-002',
          currency: 'USD',
          price: 6,
          unit: 'm',
          metresPerPricedUnit: 6,
          fxToQar: 3.65,
          freightQarPerUnit: 0,
          dutyQarPerUnit: 0,
          clearingQarPerUnit: 0,
          effectiveDate: '2026-11-02',
        },
      },
    };
    const s = snapshot(r);
    const d = {
      items: [item],
      documentDetails: {
        knowledge: {
          prices: {},
          references: [],
          costEstimates: {
            [item.id]: {
              ruleVersion: '55mm-order-rules-v1' as const,
              width: 138,
              height: 165,
              measurementUnit: 'cm',
              qty: 2,
              automatic: true,
              offers: { 'HT-WSC-002': s },
              quantities: {},
              extras: {
                labour: null,
                installation: null,
                delivery: null,
                other: null,
              },
            },
          },
        },
      },
    };
    expect(await verifyKnowledgeSnapshots(mock(r).db, 'account', d)).toBeNull();
    d.documentDetails.knowledge.costEstimates[item.id].offers[
      'HT-WSC-002'
    ].configuration.supplierCost!.price = 1;
    expect(await verifyKnowledgeSnapshots(mock(r).db, 'account', d)).toContain(
      'changed'
    );
  });
});
