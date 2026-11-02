import { isDeepStrictEqual } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QuotationDraft } from '../workspace';
import { calculatePrice, snapshot } from './calculations';
import type {
  KnowledgeRecord,
  QuotationKnowledge,
  KnowledgeSnapshot,
} from './types';
interface Review {
  record_id: string;
  version: number;
  status: string;
  configuration: KnowledgeRecord['configuration'];
  created_at: string;
}
// Sources cannot be edited and reviews cannot be rewritten. Verify persisted evidence
// against its historical approval as well, including saves made through direct RPCs.
export async function verifyKnowledgeSnapshots(
  db: SupabaseClient,
  accountId: string,
  draft: Pick<QuotationDraft, 'items' | 'documentDetails'>,
  previous?: QuotationKnowledge,
  historical = false
) {
  const k = draft.documentDetails.knowledge;
  if (!k) return null;
  const entries = [
    ...Object.entries(k.prices).map(([itemId, s]) => ({ itemId, s })),
    ...k.references.map((s) => ({ itemId: null, s })),
    ...Object.values(k.costEstimates ?? {})
      .flatMap((c) => Object.values(c.offers))
      .map((s) => ({ itemId: null, s })),
    ...(k.manualOverrides ?? []).map((o) => ({ itemId: null, s: o.previous })),
  ];
  if (!entries.length) return null;
  if (entries.length > 1000) return 'Too many source references.';
  const oldSnapshots = [
    ...Object.values(previous?.prices ?? {}),
    ...(previous?.references ?? []),
    ...(previous?.manualOverrides ?? []).map((o) => o.previous),
    ...Object.values(previous?.costEstimates ?? {}).flatMap((c) =>
      Object.values(c.offers)
    ),
  ];
  const isHistorical = (s: KnowledgeSnapshot) =>
    historical || oldSnapshots.some((o) => isDeepStrictEqual(o, s));
  const ids = [...new Set(entries.map((e) => e.s.recordId))];
  const records = new Map<string, KnowledgeRecord>();
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await db
      .from('quotation_knowledge_records')
      .select('*')
      .eq('account_id', accountId)
      .in('id', ids.slice(index, index + 100));
    if (error) return 'Source library unavailable.';
    for (const r of data ?? []) records.set(r.id, r);
  }
  const needed = [
    ...new Map(
      entries
        .filter((e) => isHistorical(e.s))
        .map((e) => [`${e.s.recordId}:${e.s.reviewVersion}`, e.s])
    ).values(),
  ];
  const reviews = new Map<string, Review>();
  for (let index = 0; index < needed.length; index += 50) {
    const filters = needed
      .slice(index, index + 50)
      .map(
        (s) => `and(record_id.eq.${s.recordId},version.eq.${s.reviewVersion})`
      )
      .join(',');
    const { data, error } = await db
      .from('quotation_knowledge_reviews')
      .select('record_id,version,status,configuration,created_at')
      .eq('account_id', accountId)
      .or(filters);
    if (error) return 'Source approval history unavailable.';
    for (const r of data ?? []) reviews.set(`${r.record_id}:${r.version}`, r);
  }
  for (const { itemId, s } of entries) {
    const r = records.get(s.recordId);
    if (!r) return 'Source record not found.';
    let approved = r;
    if (isHistorical(s)) {
      const review = reviews.get(`${s.recordId}:${s.reviewVersion}`);
      if (!review || review.status !== 'approved')
        return 'Source approval not found.';
      approved = {
        ...r,
        review_status: 'approved',
        review_version: review.version,
        reviewed_at: review.created_at,
        configuration: review.configuration,
      };
    }
    try {
      const expected = snapshot(approved);
      if (s.input) {
        const item = {
          id: r.id,
          itemType: 'line' as const,
          productId: approved.configuration.catalogItemId,
          sizeW: s.input.width,
          sizeH: s.input.height,
          measurementUnit: s.input.measurementUnit,
          qty: s.input.qty,
        };
        const computed = calculatePrice(approved, item, {
          fifthSheet: s.input.fifthSheet,
          manual: s.input.manual,
        });
        Object.assign(expected, computed.snapshot);
      }
      if (itemId) {
        const item = draft.items.find((i) => i.id === itemId);
        if (!item || !s.input) return 'Quotation item not found.';
        // Stale saved dimensions can remain in drafts, but export validation requires
        // reapplication or a recorded manual override before a PDF can be issued.
        if (!isHistorical(s)) {
          const computed = calculatePrice(approved, item, {
            fifthSheet: s.input.fifthSheet,
            manual: s.input.manual,
          });
          if (
            item.unit !== computed.unit ||
            item.unitPrice !== computed.unitPrice
          )
            return 'Price differs from its approved source.';
        }
      }
      if (!isDeepStrictEqual({ ...expected, capturedAt: s.capturedAt }, s))
        return 'Source review changed. Select the source again.';
    } catch {
      return 'Source review changed. Select the source again.';
    }
  }
  return null;
}
