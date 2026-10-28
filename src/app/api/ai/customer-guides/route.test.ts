import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  current: vi.fn(),
  limit: vi.fn(),
  ingest: vi.fn(),
  key: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.current,
  requireRole: h.role,
  toErrorResponse: (e: unknown) =>
    new Response(JSON.stringify({ error: String(e) }), { status: 403 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.limit,
  rateLimitResponse: () => new Response('{}', { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/ai/knowledge', () => ({ ingestDocument: h.ingest }));
vi.mock('@/lib/ai/config', () => ({ loadEmbeddingsKey: h.key }));
import { GET, POST, PATCH } from './route';
import { renderGuideContent } from '@/lib/ai/customer-guides';
const family = '10000000-0000-4000-8000-000000000001',
  product = '10000000-0000-4000-8000-000000000002',
  guideId = '10000000-0000-4000-8000-000000000003';
const sections = {
  explanation: 'Definition',
  options: 'Choices',
  selection: 'Preference',
  next_question: 'Which matters?',
  faq: 'Answers',
};
let tables: Record<string, Record<string, unknown>[]>;
let writes: Record<string, unknown>[];
let stale: boolean;
const req = (body: unknown) =>
  new Request('https://local.invalid/api/ai/customer-guides', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  stale = false;
  h.limit.mockReturnValue({ success: true });
  h.key.mockResolvedValue({ key: null, corrupt: false });
  tables = {
    ai_products: [
      {
        id: family,
        account_id: 'account',
        parent_id: null,
        kind: 'family',
        name: 'Pivot',
        superseded_by: null,
      },
      {
        id: product,
        account_id: 'account',
        parent_id: family,
        kind: 'product',
        name: 'Entrance',
        superseded_by: null,
      },
    ],
    ai_knowledge_documents: [
      {
        id: guideId,
        account_id: 'account',
        product_id: family,
        title: 'Shared guide',
        document_type: 'customer_guide',
        status: 'draft',
        guide_sections: sections,
        updated_at: '2026-10-28T12:00:00Z',
      },
    ],
  };
  const db = {
    from: (table: string) => {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let write: Record<string, unknown> | null = null;
      const rows = () =>
        tables[table].filter((row) => filters.every((f) => f(row)));
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((row) => row[k] === v);
          return q;
        },
        in: (k: string, vs: unknown[]) => {
          filters.push((row) => vs.includes(row[k]));
          return q;
        },
        insert: (v: Record<string, unknown>) => {
          write = v;
          writes.push(v);
          return q;
        },
        update: (v: Record<string, unknown>) => {
          write = v;
          writes.push(v);
          return q;
        },
        maybeSingle: async () => ({
          data: stale
            ? null
            : write
              ? { id: guideId, ...write, updated_at: '2026-10-28T13:00:00Z' }
              : (rows()[0] ?? null),
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows(), error: null }),
      };
      return q;
    },
  };
  const ctx = { supabase: db, accountId: 'account', userId: 'user' };
  h.role.mockResolvedValue(ctx);
  h.current.mockResolvedValue(ctx);
});
it('returns the same nearest family guide from a product', async () => {
  const r = await GET(
    new Request(
      `https://local.invalid/api/ai/customer-guides?product_id=${product}`
    )
  );
  const d = await r.json();
  expect(r.status).toBe(200);
  expect(d.guide.id).toBe(guideId);
  expect(d.owner.id).toBe(family);
  expect(d.inherited).toBe(true);
});
it('never resolves another account or historical product', async () => {
  tables.ai_products[0].account_id = 'foreign';
  expect(
    (await GET(new Request(`https://local.invalid/?product_id=${product}`)))
      .status
  ).toBe(404);
});
it('requires admin before writing', async () => {
  h.role.mockRejectedValue(new Error('Forbidden'));
  expect(
    (await POST(req({ product_id: product, guide_sections: sections }))).status
  ).toBe(403);
  expect(writes).toEqual([]);
});
it('creates a draft in the current account with derived content', async () => {
  const r = await POST(
    req({
      product_id: product,
      guide_sections: sections,
      content: 'FAKE BUSINESS WARRANTY',
      account_id: 'foreign',
      created_by: 'other',
    })
  );
  expect(r.status).toBe(200);
  expect(writes[0]).toMatchObject({
    account_id: 'account',
    created_by: 'user',
    status: 'draft',
    document_type: 'customer_guide',
    content: renderGuideContent(sections),
  });
  expect(writes[0].content).not.toContain('FAKE');
  expect(h.ingest).not.toHaveBeenCalled();
});
it('does not approve incomplete guidance', async () => {
  expect(
    (
      await POST(
        req({
          product_id: product,
          status: 'approved',
          guide_sections: { ...sections, faq: '' },
        })
      )
    ).status
  ).toBe(400);
  expect(writes).toEqual([]);
});
it('indexes an approved guide using saved canonical content', async () => {
  const r = await POST(
    req({ product_id: product, status: 'approved', guide_sections: sections })
  );
  expect(r.status).toBe(200);
  expect(h.ingest).toHaveBeenCalledWith(
    expect.anything(),
    'account',
    { embeddingsApiKey: null },
    guideId,
    renderGuideContent(sections)
  );
});
it('rejects stale shared edits without indexing', async () => {
  stale = true;
  expect(
    (
      await PATCH(
        req({
          id: guideId,
          product_id: family,
          status: 'approved',
          guide_sections: sections,
          updated_at: '2026-10-28T12:00:00Z',
        })
      )
    ).status
  ).toBe(409);
  expect(h.ingest).not.toHaveBeenCalled();
});
it('keeps a saved approved guide with a truthful warning when indexing fails', async () => {
  h.ingest.mockRejectedValueOnce(new Error('index unavailable'));
  const r = await POST(
    req({ product_id: product, status: 'approved', guide_sections: sections })
  );
  expect(r.status).toBe(200);
  expect((await r.json()).warning).toContain('indexing needs attention');
});
