import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { parseCatalogQuestion } from '@/lib/ai/catalog-collection';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('ai_catalog_questions')
      .select(
        'id,product_id,question,answer,evidence,confirmed_by,confirmed_on,status'
      )
      .eq('account_id', accountId)
      .order('created_at');
    if (error)
      return NextResponse.json(
        {
          error:
            'Could not load collection questions. Check that migration 078 is applied.',
        },
        { status: 500 }
      );
    return NextResponse.json({ questions: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
async function save(request: Request, create: boolean) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-catalog-questions:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    let update;
    try {
      update = parseCatalogQuestion(body);
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    if (create && !update.question)
      return NextResponse.json({ error: 'Enter a question.' }, { status: 400 });
    if (
      !create &&
      (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id))
    )
      return NextResponse.json(
        { error: 'Choose a question.' },
        { status: 400 }
      );
    if (Object.keys(update).length === 0)
      return NextResponse.json(
        { error: 'Nothing to update.' },
        { status: 400 }
      );
    if (update.status === 'answered' && !update.answer?.trim()) {
      // Require the answer in the same save so a status change cannot imply nonexistent evidence.
      return NextResponse.json(
        { error: 'Record an answer before marking answered.' },
        { status: 400 }
      );
    }
    const query = create
      ? supabase
          .from('ai_catalog_questions')
          .insert({ ...update, account_id: accountId, created_by: userId })
      : supabase
          .from('ai_catalog_questions')
          .update(update)
          .eq('account_id', accountId)
          .eq('id', body.id);
    const { data, error } = await query.select('id').maybeSingle();
    if (error)
      return NextResponse.json(
        {
          error:
            error.code === '23505'
              ? 'This question already exists.'
              : 'Could not save question. Check the linked product.',
        },
        { status: error.code === '23505' || error.code === '23503' ? 409 : 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Question not found.' },
        { status: 404 }
      );
    return NextResponse.json({ success: true, id: data.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
export async function POST(request: Request) {
  return save(request, true);
}
export async function PATCH(request: Request) {
  return save(request, false);
}
