import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { HTH_RESEARCH, HTH_RESEARCH_SOURCE } from '@/lib/ai/hth-research';

export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `catalog-research:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const entries = HTH_RESEARCH.flatMap((f) => [
      {
        key: f.key,
        name: f.name,
        description: f.description,
        kind: 'family',
        aliases: f.aliases,
        source_url: f.source,
        source_notes: HTH_RESEARCH_SOURCE,
      },
      ...f.products.flatMap((p, i) => [
        {
          key: `${f.key}-${i}`,
          parent_key: f.key,
          name: p.name,
          description: p.description,
          aliases: p.aliases,
          kind: 'product',
          source_url: f.source,
          source_notes: HTH_RESEARCH_SOURCE,
        },
        ...(p.variants ?? []).map((v, j) => ({
          key: `${f.key}-${i}-${j}`,
          parent_key: `${f.key}-${i}`,
          ...v,
          kind: 'variant',
          source_url: f.source,
          source_notes: HTH_RESEARCH_SOURCE,
        })),
      ]),
    ]);
    const { data, error } = await supabase.rpc('import_ai_catalog_drafts', {
      p_account_id: accountId,
      p_entries: entries,
    });
    if (error)
      return NextResponse.json(
        {
          error:
            'Could not import the researched catalog. Check that migration 077 is applied, then retry.',
        },
        { status: 500 }
      );
    return NextResponse.json({ success: true, added: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
