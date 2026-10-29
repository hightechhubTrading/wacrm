import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
export const KNOWLEDGE_GAP_QUESTIONS = {
  price:
    'Confirm the approved price range, unit, minimum billing, inclusions and exclusions for this product.',
  service:
    'Confirm whether this service is offered and what site/system details staff need before accepting the work.',
  technical:
    'Confirm the requested technical options, supported applications, limitations and required evidence.',
  warranty_timing:
    'Confirm the written warranty and expected installation timing for this exact configuration.',
  inspection:
    'Confirm inspection availability, charges and the details needed to request a visit. Appointment slots remain human-confirmed.',
  contact:
    'Confirm the requested business contact or branch details; do not infer a branch or specialist email.',
  media:
    'Provide an approved, correctly labelled product example or brochure for this request.',
} as const;
export type KnowledgeGapKind = keyof typeof KNOWLEDGE_GAP_QUESTIONS;
/** Repeat requests create one internal open research record, without overwriting staff answers. */
export async function recordKnowledgeGap(
  db: SupabaseClient,
  args: {
    accountId: string;
    createdBy: string;
    productId: string | null;
    kind: KnowledgeGapKind;
  }
) {
  try {
    const question = KNOWLEDGE_GAP_QUESTIONS[args.kind];
    if (!question) return;
    const gap_key = createHash('sha256')
      .update((args.productId ?? 'shared') + ':' + args.kind)
      .digest('hex');
    const { error } = await db.from('ai_catalog_questions').upsert(
      {
        account_id: args.accountId,
        created_by: args.createdBy,
        product_id: args.productId,
        question,
        gap_key,
        status: 'open',
      },
      { onConflict: 'account_id,gap_key', ignoreDuplicates: true }
    );
    if (error) console.warn('[ai knowledge] research question unavailable');
  } catch {
    console.warn('[ai knowledge] research question unavailable');
  }
}
