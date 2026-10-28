import type { SupabaseClient } from '@supabase/supabase-js';
import { approvedCatalogRows } from './catalog';
import { embedTexts, toVectorLiteral } from './embeddings';

/** Vectors are derived, never the source of product facts. Replaced chunks have new IDs. */
export async function indexProductSearch(
  db: SupabaseClient,
  accountId: string,
  embeddingsApiKey: string | null
) {
  if (!embeddingsApiKey) return { indexed: 0, stale: 0 };
  const { data: catalog, error: catalogError } = await db
    .from('ai_products')
    .select('id,parent_id,status,superseded_by')
    .eq('account_id', accountId);
  if (catalogError) throw catalogError;
  const approved = new Set(approvedCatalogRows(catalog ?? []).map((p) => p.id));
  let offset = 0;
  const candidates: { id: string; content: string; product_id: string }[] = [];
  // Page through blocked branches too, rather than allowing them to starve approved products.
  while (candidates.length < 96) {
    const { data, error } = await db
      .from('ai_product_search_chunks')
      .select('id,content,product_id')
      .eq('account_id', accountId)
      .is('embedding', null)
      .order('id')
      .range(offset, offset + 95);
    if (error) throw error;
    for (const row of data ?? [])
      if (approved.has(row.product_id) && candidates.length < 96)
        candidates.push(row);
    if (!data || data.length < 96) break;
    offset += 96;
  }
  const vectors = await embedTexts(
    embeddingsApiKey,
    candidates.map((r) => r.content)
  );
  let indexed = 0,
    stale = 0;
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const { data, error } = await db
      .from('ai_product_search_chunks')
      .update({ embedding: toVectorLiteral(vectors[i]) })
      .eq('account_id', accountId)
      .eq('id', row.id)
      .eq('content', row.content)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data) indexed++;
    else stale++;
  }
  return { indexed, stale };
}
