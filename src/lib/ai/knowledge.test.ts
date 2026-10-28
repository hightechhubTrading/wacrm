import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }));
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

import { retrieveKnowledge, ingestDocument } from './knowledge';

interface FakeState {
  semantic: { id: string; content: string }[];
  fts: { id: string; content: string }[];
  chunkCount: number;
  rpcCalls: string[];
  inserted: Record<string, unknown>[] | null;
  deletedFor: string | null;
  sourceContent: string | null;
  replaceAccepted: boolean;
  productChunkCount: number;
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    inserted: null,
    deletedFor: null,
    sourceContent: null,
    replaceAccepted: true,
    productChunkCount: 0,
  };
  const db = {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (name === 'replace_ai_knowledge_chunks') {
        state.deletedFor = args!.p_document_id as string;
        state.sourceContent = args!.p_content as string;
        state.inserted = args!.p_chunks as Record<string, unknown>[];
        return Promise.resolve({ data: state.replaceAccepted, error: null });
      }
      state.rpcCalls.push(name);
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null });
      if (name === 'match_ai_knowledge_fts')
        return Promise.resolve({ data: state.fts, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => ({
      // retrieveKnowledge's empty-KB count guard.
      select: () => ({
        eq: () =>
          Promise.resolve({
            count:
              table === 'ai_product_search_chunks'
                ? state.productChunkCount
                : state.chunkCount,
            error: null,
          }),
      }),
      delete: () => ({
        eq: (_col: string, val: string) => {
          state.deletedFor = val;
          return Promise.resolve({ error: null });
        },
      }),
      insert: (rows: Record<string, unknown>[]) => {
        state.inserted = rows;
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { db: db as unknown as SupabaseClient, state };
}

beforeEach(() => {
  h.embedTexts.mockReset();
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i])
  );
});

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb();
    expect(
      await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')
    ).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
  });

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb();
    state.chunkCount = 0;
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'q'
    );
    expect(out).toEqual([]);
    expect(h.embedTexts).not.toHaveBeenCalled();
    expect(state.rpcCalls).toEqual([]);
  });

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb();
    state.fts = [{ id: 'f1', content: 'F1' }];
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'q'
    );
    expect(out).toEqual(['F1']);
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts']);
    expect(h.embedTexts).not.toHaveBeenCalled();
  });

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb();
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ];
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'q',
      3
    );
    expect(out).toEqual(['S1', 'S2', 'S3']);
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic']);
  });

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb();
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ];
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ];
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'q',
      3
    );
    expect(out).toEqual(['S1', 'S2', 'F1']);
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ]);
  });
});

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb();
    await ingestDocument(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'doc-1',
      'hello world'
    );
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    expect(state.deletedFor).toBe('doc-1');
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted![0].embedding).toBe('[0,0]'); // literal from mocked embed
    expect(state.sourceContent).toBe('hello world');
  });

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb();
    await ingestDocument(
      db,
      'acct',
      { embeddingsApiKey: null },
      'doc-1',
      'hello world'
    );
    expect(h.embedTexts).not.toHaveBeenCalled();
    expect(state.inserted![0].embedding).toBeNull();
  });

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb();
    await ingestDocument(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'doc-1',
      '   '
    );
    expect(state.deletedFor).toBe('doc-1');
    expect(state.inserted).toEqual([]);
    expect(h.embedTexts).not.toHaveBeenCalled();
  });

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb();
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'));
    await expect(
      ingestDocument(
        db,
        'acct',
        { embeddingsApiKey: 'sk-x' },
        'doc-1',
        'hello world'
      )
    ).rejects.toThrow('rate limited');
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted![0].embedding).toBeNull();
  });
});

it('retrieves product evidence even without knowledge documents', async () => {
  const { db, state } = makeDb();
  state.chunkCount = 0;
  state.productChunkCount = 2;
  state.fts = [
    { id: 'product-chunk', content: '[source product=p] window shutter' },
  ];
  expect(
    await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'window')
  ).toEqual([state.fts[0].content]);
});
it('rejects a stale or unapproved document index rather than reporting success', async () => {
  const { db, state } = makeDb();
  state.replaceAccepted = false;
  await expect(
    ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc', 'old facts')
  ).rejects.toThrow('no longer approved');
});
