import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadEmbeddingsKey } from '@/lib/ai/config';
import { ingestDocument } from '@/lib/ai/knowledge';
import { indexProductSearch } from '@/lib/ai/product-search';
import { approvedCatalogRows } from '@/lib/ai/catalog';
import { AiError } from '@/lib/ai/types';

/**
 * POST /api/ai/knowledge/reindex  (admin+)
 *
 * Re-chunk and re-embed every document in the account. The main use is
 * after adding an embeddings key: existing documents were stored
 * lexical-only, and this backfills their vectors so semantic search
 * turns on. Also recovers documents whose indexing failed earlier.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-kb-reindex:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: docs, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, content, product_id')
      .eq('account_id', accountId)
      .eq('status', 'approved')
      .eq('collection_only', false);
    if (error) {
      console.error('[ai/knowledge/reindex] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load documents' },
        { status: 500 }
      );
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId
    );
    // The whole point of Reindex is usually to backfill embeddings — so
    // if a key is configured but can't be decrypted, don't quietly do a
    // lexical-only pass and report success. Stop and tell the admin.
    if (corrupt) {
      return NextResponse.json(
        {
          success: false,
          reindexed: 0,
          error:
            'Your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key in Settings → AI Assistant). Nothing was reindexed.',
        },
        { status: 200 }
      );
    }

    const { data: catalog, error: catalogError } = await supabase
      .from('ai_products')
      .select('id,parent_id,status,superseded_by')
      .eq('account_id', accountId);
    if (catalogError) throw catalogError;
    const approved = new Set(
      approvedCatalogRows(catalog ?? []).map((p) => p.id)
    );
    const eligibleDocs = (docs ?? []).filter(
      (d) => !d.product_id || approved.has(d.product_id)
    );
    let reindexed = 0;
    const failures: { id: string; error: string }[] = [];
    for (const doc of eligibleDocs) {
      try {
        await ingestDocument(
          supabase,
          accountId,
          { embeddingsApiKey },
          doc.id,
          doc.content
        );
        reindexed += 1;
      } catch (err) {
        // One bad document (e.g. a mid-run embeddings rate-limit) must
        // not abort the whole batch — record it and continue so the
        // remaining documents still get reindexed.
        const message = err instanceof AiError ? err.message : String(err);
        console.error(`[ai/knowledge/reindex] doc ${doc.id} failed:`, message);
        failures.push({ id: doc.id, error: message });
      }
    }

    let products = { indexed: 0, stale: 0 };
    try {
      products = await indexProductSearch(
        supabase,
        accountId,
        embeddingsApiKey
      );
    } catch (err) {
      failures.push({
        id: 'product-search',
        error: err instanceof Error ? err.message : 'Product indexing failed.',
      });
    }
    return NextResponse.json({
      products,
      mode: embeddingsApiKey ? 'semantic' : 'keyword',
      success: failures.length === 0,
      reindexed,
      total: eligibleDocs.length,
      failed: failures.length,
      failures,
      ...(failures.length > 0
        ? { error: `Reindexed ${reindexed}, ${failures.length} failed.` }
        : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Read-only search readiness; never returns an API key or vector contents. */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data: catalog, error } = await supabase
      .from('ai_products')
      .select('id,parent_id,status,superseded_by')
      .eq('account_id', accountId);
    if (error) throw error;
    const ids = approvedCatalogRows(catalog ?? []).map((p) => p.id);
    const { key, corrupt } = await loadEmbeddingsKey(supabase, accountId);
    const empty = { count: 0, error: null };
    const [chunks, vectors] = ids.length
      ? await Promise.all([
          supabase
            .from('ai_product_search_chunks')
            .select('id', { count: 'exact', head: true })
            .eq('account_id', accountId)
            .in('product_id', ids),
          supabase
            .from('ai_product_search_chunks')
            .select('id', { count: 'exact', head: true })
            .eq('account_id', accountId)
            .in('product_id', ids)
            .not('embedding', 'is', null),
        ])
      : [empty, empty];
    if (chunks.error || vectors.error) throw chunks.error || vectors.error;
    return NextResponse.json({
      semanticConfigured: !!key,
      corrupt,
      productChunks: chunks.count ?? 0,
      productVectors: vectors.count ?? 0,
      pending: (chunks.count ?? 0) - (vectors.count ?? 0),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
