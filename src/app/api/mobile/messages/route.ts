import { NextResponse } from 'next/server';
import { POST as send, GET as reconcile } from '@/app/api/whatsapp/send/route';
import { createRequestClient } from '@/lib/supabase/request';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';

const origins = new Set(['https://localhost']);
function response(request: Request, result: Response) {
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('Vary', 'Origin');
  const origin = request.headers.get('origin');
  if (origin && origins.has(origin)) {
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set(
      'Access-Control-Allow-Headers',
      'authorization, content-type'
    );
    result.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  return result;
}
function denied(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && !origins.has(origin))
    return NextResponse.json(
      { error: 'Origin not allowed', outcome: 'rejected' },
      { status: 403 }
    );
  if (
    !/^Bearer [A-Za-z0-9._-]+$/.test(request.headers.get('authorization') ?? '')
  )
    return NextResponse.json(
      { error: 'User session required', outcome: 'rejected' },
      { status: 401 }
    );
  return null;
}
export async function OPTIONS(request: Request) {
  if (!origins.has(request.headers.get('origin') ?? ''))
    return new Response(null, { status: 403 });
  return response(request, new Response(null, { status: 204 }));
}
export async function POST(request: Request) {
  const blocked = denied(request);
  if (blocked) return response(request, blocked);
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  if (
    !body ||
    body.message_type !== 'text' ||
    typeof body.content_text !== 'string' ||
    !body.content_text.trim() ||
    body.content_text.length > 4096 ||
    typeof body.operation_id !== 'string' ||
    typeof body.conversation_id !== 'string' ||
    Object.keys(body).some(
      (key) =>
        ![
          'message_type',
          'content_text',
          'operation_id',
          'conversation_id',
        ].includes(key)
    )
  ) {
    return response(
      request,
      NextResponse.json(
        {
          error: 'Only tracked text replies are supported',
          outcome: 'rejected',
        },
        { status: 400 }
      )
    );
  }
  return response(request, await send(request));
}
export async function GET(request: Request) {
  const blocked = denied(request);
  if (blocked) return response(request, blocked);
  if (new URL(request.url).searchParams.has('operation_id'))
    return response(request, await reconcile(request));
  try {
    const db = await createRequestClient(request);
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user)
      return response(
        request,
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      );
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('account_id,account_role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError || !profile?.account_id)
      return response(
        request,
        NextResponse.json({ error: 'Account unavailable' }, { status: 403 })
      );
    return response(
      request,
      NextResponse.json({
        protocol: 1,
        textReplies:
          isAccountRole(profile.account_role) &&
          canSendMessages(profile.account_role),
      })
    );
  } catch {
    return response(
      request,
      NextResponse.json({ error: 'Unavailable' }, { status: 503 })
    );
  }
}
