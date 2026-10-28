import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig } from './types';
import { chunkText } from './chunk';
import { embedTexts, toVectorLiteral } from './embeddings';

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

interface MatchRow {
  id: string;
  content: string;
}

/**
 * Build and atomically replace an approved document’s current chunks.
 * The database rejects stale content and drafts. With an embeddings key,
 * embed each chunk. Runs under whatever client the
 * caller passes (service-role for ingest routes).
 *
 * Throws on embedding failure so the ingest route can report it; the
 * Complete lexical chunks are retained when embedding fails.
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string
): Promise<void> {
  const chunks = chunkText(content);

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically. We record the error and rethrow it
  // AFTER inserting (embedding-less) rows, so the route can warn
  // "semantic indexing failed" — which is now truthful, because lexical
  // search really does still work.
  let embeddings: number[][] | null = null;
  let embedError: unknown = null;
  if (config.embeddingsApiKey && chunks.length) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks);
    } catch (err) {
      embedError = err;
    }
  }

  const rows = chunks.map((content, i) => ({
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }));
  const { data: replaced, error } = await db.rpc(
    'replace_ai_knowledge_chunks',
    {
      p_account_id: accountId,
      p_document_id: documentId,
      p_content: content,
      p_chunks: rows,
    }
  );
  if (error) throw error;
  if (!replaced)
    throw new Error(
      'Document changed or is no longer approved; refresh before indexing again.'
    );

  if (embedError) throw embedError;
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 5
): Promise<string[]> {
  const query = queryText.trim();
  if (!query || k <= 0) return [];

  // Skip everything when the account has no knowledge base — otherwise
  // every draft / auto-reply would pay for a query embedding + two RPCs
  // just to get []. One cheap indexed COUNT (head, no rows) instead of a
  // paid embeddings call on the hot path.
  try {
    const counts = await Promise.all([
      db
        .from('ai_knowledge_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      db
        .from('ai_product_search_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
    ]);
    if (counts.every((r) => r.error || !r.count)) return [];
  } catch {
    return [];
  }

  // Small approved company facts remain available for short follow-ups such as
  // "where?" even when those words do not occur in a contact/address document.
  const companyFacts: string[] = [];
  try {
    const { data: docs, error } = await db
      .from('ai_knowledge_documents')
      .select('id, title, content, source_url')
      .eq('account_id', accountId)
      .eq('status', 'approved')
      .eq('topic', 'company')
      .eq('collection_only', false)
      .is('product_id', null)
      .order('updated_at', { ascending: false })
      .limit(2);
    if (!error)
      for (const doc of docs ?? [])
        companyFacts.push(
          `[source document=${doc.id}] ${doc.title}\nSource: ${doc.source_url ?? 'account knowledge'}\n${doc.content.slice(0, 4000)}`
        );
  } catch {
    /* Unavailable company facts never substitute unreviewed evidence. */
  }

  const picked = new Map<string, string>(); // id → content, preserves order

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [
        query,
      ]);
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        });
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content);
        }
      }
    } catch (err) {
      console.error(
        '[ai knowledge] semantic retrieval failed, falling back to FTS:',
        err
      );
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      });
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break;
          if (!picked.has(row.id)) picked.set(row.id, row.content);
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err);
    }
  }

  return [...companyFacts, ...Array.from(picked.values()).slice(0, k)];
}
