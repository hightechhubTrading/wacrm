import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { salesAssistanceMode } from '@/lib/ai/typesafe/client';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const [config, tags] = await Promise.all([
      ctx.supabase
        .from('ai_configs')
        .select('sales_assistance_enabled,is_active')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('tags')
        .select('id,name,color,ai_rule')
        .eq('account_id', ctx.accountId)
        .order('name'),
    ]);
    if (config.error || tags.error)
      return NextResponse.json(
        {
          error: 'Sales assistance needs migration 072.',
          code: 'assistance_unavailable',
        },
        { status: 503 }
      );
    return NextResponse.json({
      enabled: config.data?.sales_assistance_enabled ?? false,
      aiActive: config.data?.is_active ?? false,
      mode: salesAssistanceMode(),
      verifierReady:
        !!process.env.TYPESAFE_API_KEY?.trim() && salesAssistanceMode() !== 'off',
      tags: tags.data ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
const edit = z.union([
  z.object({ enabled: z.boolean() }).strict(),
  z
    .object({ tag_id: z.string().uuid(), rule: z.string().trim().max(1000) })
    .strict(),
]);
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const parsed = edit.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Invalid assistance settings.' },
        { status: 400 }
      );
    if ('enabled' in parsed.data) {
      if (parsed.data.enabled) {
        const { data, error } = await ctx.supabase
          .from('ai_configs')
          .select('is_active')
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (
          error ||
          !data?.is_active ||
          salesAssistanceMode() === 'off' ||
          !process.env.TYPESAFE_API_KEY?.trim()
        )
          return NextResponse.json(
            {
              error:
                'Enable AI and configure the server-side TypeSafe check first.',
            },
            { status: 409 }
          );
      }
      const { data, error } = await ctx.supabase
        .from('ai_configs')
        .update({ sales_assistance_enabled: parsed.data.enabled })
        .eq('account_id', ctx.accountId)
        .select('account_id')
        .maybeSingle();
      if (error || !data)
        return NextResponse.json(
          { error: 'Could not update sales assistance.' },
          { status: 503 }
        );
    } else {
      const { data, error } = await ctx.supabase
        .from('tags')
        .update({ ai_rule: parsed.data.rule || null })
        .eq('id', parsed.data.tag_id)
        .eq('account_id', ctx.accountId)
        .select('id')
        .maybeSingle();
      if (error || !data)
        return NextResponse.json(
          { error: 'Could not update this account tag.' },
          { status: error ? 503 : 404 }
        );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
