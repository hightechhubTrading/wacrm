import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock('./embeddings', () => ({
  embedTexts: h.embed,
  toVectorLiteral: (v: number[]) => JSON.stringify(v),
}));
import { indexProductSearch } from './product-search';
beforeEach(() => {
  h.embed.mockReset();
  h.embed.mockImplementation(async (_key: string, rows: string[]) =>
    rows.map(() => [1, 0])
  );
});
it('uses no paid embedding requests without a configured key', async () => {
  expect(await indexProductSearch({} as SupabaseClient, 'a', null)).toEqual({
    indexed: 0,
    stale: 0,
  });
  expect(h.embed).not.toHaveBeenCalled();
});
it('indexes only approved branches and discards results for replaced chunks', async () => {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => {
      let changing = false;
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        is: () => q,
        order: () => q,
        range: async () => ({
          data: [
            { id: 'current', product_id: 'good', content: 'approved facts' },
            { id: 'old', product_id: 'good', content: 'changed facts' },
            {
              id: 'blocked-chunk',
              product_id: 'blocked',
              content: 'do not embed',
            },
            {
              id: 'archived-chunk',
              product_id: 'archived',
              content: 'duplicate',
            },
          ],
          error: null,
        }),
        update: () => {
          changing = true;
          return q;
        },
        maybeSingle: async () => {
          updates.push({ ...filters });
          return {
            data: filters.id === 'old' ? null : { id: filters.id },
            error: null,
          };
        },
        then: (resolve: (r: unknown) => unknown) =>
          resolve({
            data:
              table === 'ai_products'
                ? [
                    { id: 'good', status: 'approved' },
                    { id: 'parent', status: 'draft' },
                    { id: 'blocked', parent_id: 'parent', status: 'approved' },
                    {
                      id: 'archived',
                      status: 'approved',
                      superseded_by: 'good',
                    },
                  ]
                : [],
            error: null,
          }),
      };
      void changing;
      return q;
    },
  };
  expect(
    await indexProductSearch(db as unknown as SupabaseClient, 'a', 'key')
  ).toEqual({ indexed: 1, stale: 1 });
  expect(h.embed).toHaveBeenCalledWith('key', [
    'approved facts',
    'changed facts',
  ]);
  expect(updates).toEqual([
    { account_id: 'a', id: 'current', content: 'approved facts' },
    { account_id: 'a', id: 'old', content: 'changed facts' },
  ]);
});
