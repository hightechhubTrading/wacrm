import type { SupabaseClient } from '@supabase/supabase-js';
import { approvedCatalogRows } from '@/lib/ai/catalog';
import type { CatalogueProduct } from './catalogue';
import type { KnowledgeRecord } from './knowledge/types';

/** RLS-scoped catalogue for staff quotation work, including documented internal materials. */
export async function loadQuotationCatalogue(
  db: SupabaseClient,
  accountId: string
): Promise<CatalogueProduct[]> {
  const [{ data: products, error: pe }, { data: links, error: le }] =
    await Promise.all([
      db
        .from('ai_products')
        .select(
          'id,name,name_ar,description,specifications,parent_id,kind,status,superseded_by,inventory_type,sku,unit_of_measure,price_min,price_max,price_unit,customer_visible,aliases'
        )
        .eq('account_id', accountId)
        .order('name')
        .limit(1000),
      db
        .from('product_source_links')
        .select('product_id,source:quotation_knowledge_records!inner(*)')
        .eq('account_id', accountId)
        .in('source.kind', ['product', 'price'])
        .eq('source.review_status', 'approved')
        .limit(1000),
    ]);
  if (pe || le) throw Error('Could not load the shared quotation catalogue.');
  const rows = approvedCatalogRows(products ?? [], { includeInternal: true });
  const sourceByProduct = new Map<string, KnowledgeRecord[]>();
  for (const link of (links ?? []) as unknown as {
    product_id: string;
    source: KnowledgeRecord;
  }[]) {
    const list = sourceByProduct.get(link.product_id) ?? [];
    if (!list.some((r) => r.id === link.source.id)) list.push(link.source);
    sourceByProduct.set(link.product_id, list);
  }
  const productSourcesByCode = new Map<string, KnowledgeRecord>();
  for (const refs of sourceByProduct.values())
    for (const r of refs)
      if (r.kind === 'product' && r.data.code)
        productSourcesByCode.set(r.data.code, r);
  const byId = new Map(rows.map((p) => [p.id, p]));
  const codes = new Map<string, string>();
  for (const p of rows) {
    const refs = sourceByProduct.get(p.id) ?? [];
    const product = refs.find((r) => r.kind === 'product');
    const code = product?.data.code ?? [
      ...new Set(refs.map((r) => r.data.family).filter(Boolean)),
    ];
    if (typeof code === 'string') codes.set(p.id, code);
    else if (code.length === 1) codes.set(p.id, code[0]);
  }
  // A unique documented family code can describe its grouped variants; technical facts/prices are not inherited.
  for (const p of rows.filter((p) => p.kind === 'family' && !codes.has(p.id))) {
    const children = rows.filter((c) => c.parent_id === p.id);
    const found = new Set(
      children
        .flatMap((c) => [
          codes.get(c.id),
          ...rows
            .filter((v) => v.parent_id === c.id)
            .map((v) => codes.get(v.id)),
        ])
        .filter(Boolean)
    );
    if (found.size === 1) codes.set(p.id, [...found][0]!);
  }
  return rows.map((p) => {
    const chain = [p];
    let parent = p.parent_id ? byId.get(p.parent_id) : undefined;
    while (parent) {
      chain.push(parent);
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
    }
    const direct = sourceByProduct.get(p.id) ?? [],
      sources = [...direct];
    const parentTerms = chain
      .slice(1)
      .flatMap((a) => sourceByProduct.get(a.id) ?? [])
      .filter((r) => r.kind === 'product');
    const code = chain.map((a) => codes.get(a.id)).find(Boolean);
    const termsSource =
      parentTerms[0] ?? (code ? productSourcesByCode.get(code) : undefined);
    if (!sources.some((r) => r.kind === 'product') && termsSource)
      sources.push(termsSource);
    if (
      p.inventory_type === 'product' &&
      !direct.some((r) => r.kind === 'price')
    ) {
      const priceParent = chain
        .slice(1)
        .find((a) =>
          (sourceByProduct.get(a.id) ?? []).some((r) => r.kind === 'price')
        );
      for (const r of priceParent
        ? (sourceByProduct.get(priceParent.id) ?? [])
        : [])
        if (r.kind === 'price') sources.push(r);
    }
    return {
      ...p,
      productCode: chain.map((a) => codes.get(a.id)).find(Boolean),
      familyName: chain.at(-1)?.name,
      sources,
    } as CatalogueProduct;
  });
}
