import { NextResponse } from 'next/server';
import { POST as send, GET as reconcile } from '@/app/api/whatsapp/send/route';
import { createRequestClient } from '@/lib/supabase/request';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';
import { isOperationId } from '@/lib/whatsapp/send-operations';
import {
  attachmentType,
  attachmentLimit,
  cleanAttachmentName,
} from '@/lib/inbox/attachment-types';

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
    !['text', 'image', 'document'].includes(body.message_type) ||
    typeof body.content_text !== 'string' ||
    (body.message_type === 'text' && !body.content_text.trim()) ||
    body.content_text.length > (body.message_type === 'text' ? 4096 : 1024) ||
    typeof body.operation_id !== 'string' ||
    typeof body.conversation_id !== 'string' ||
    Object.keys(body).some(
      (key) =>
        !(
          body.message_type === 'text'
            ? [
                'message_type',
                'content_text',
                'operation_id',
                'conversation_id',
              ]
            : [
                'message_type',
                'content_text',
                'operation_id',
                'conversation_id',
                'media_url',
                'filename',
              ]
        ).includes(key)
    )
  ) {
    return response(
      request,
      NextResponse.json(
        {
          error: 'Use a tracked text, photo or document reply',
          outcome: 'rejected',
        },
        { status: 400 }
      )
    );
  }
  if (body.message_type !== 'text') {
    if (
      !isOperationId(body.operation_id) ||
      !isOperationId(body.conversation_id) ||
      typeof body.media_url !== 'string' ||
      typeof body.filename !== 'string' ||
      !body.filename ||
      body.filename !== cleanAttachmentName(body.filename)
    )
      return response(
        request,
        NextResponse.json(
          { error: 'Invalid attachment', outcome: 'rejected' },
          { status: 400 }
        )
      );
    try {
      const db = await createRequestClient(request);
      const {
        data: { user },
        error,
      } = await db.auth.getUser();
      if (error || !user)
        return response(
          request,
          NextResponse.json(
            { error: 'Unauthorized', outcome: 'rejected' },
            { status: 401 }
          )
        );
      const { data: profile } = await db
        .from('profiles')
        .select('account_id,account_role')
        .eq('user_id', user.id)
        .maybeSingle();
      if (
        !profile?.account_id ||
        !isAccountRole(profile.account_role) ||
        !canSendMessages(profile.account_role)
      )
        return response(
          request,
          NextResponse.json(
            { error: 'Sending requires an agent role', outcome: 'rejected' },
            { status: 403 }
          )
        );
      const url = new URL(body.media_url);
      const prefix = `/storage/v1/object/public/chat-media/account-${profile.account_id}/mobile-${body.conversation_id}-`;
      const tail = url.pathname.slice(prefix.length);
      if (
        url.protocol !== 'https:' ||
        url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith(prefix) ||
        !/^[0-9a-f-]{36}\.(jpg|jpeg|png|pdf|txt|doc|docx|xls|xlsx|ppt|pptx)$/.test(
          tail
        )
      )
        return response(
          request,
          NextResponse.json(
            {
              error: 'Attachment does not belong to this conversation',
              outcome: 'rejected',
            },
            { status: 400 }
          )
        );
      const path = url.pathname.slice(
        '/storage/v1/object/public/chat-media/'.length
      );
      const { data: info, error: infoError } = await db.storage
        .from('chat-media')
        .info(path);
      const mime = info?.contentType ?? info?.metadata?.mimetype;
      const type = attachmentType(
        body.filename,
        typeof mime === 'string' ? mime : ''
      );
      const size = Number(info?.size ?? info?.metadata?.size);
      if (
        infoError ||
        !info ||
        !mime ||
        !type ||
        type.kind !== body.message_type ||
        !Number.isFinite(size) ||
        size <= 0 ||
        size > attachmentLimit(type.kind)
      )
        return response(
          request,
          NextResponse.json(
            { error: 'Attachment unavailable or invalid', outcome: 'rejected' },
            { status: 400 }
          )
        );
    } catch {
      return response(
        request,
        NextResponse.json(
          {
            error: 'Could not validate attachment. Nothing was sent.',
            outcome: 'rejected',
          },
          { status: 400 }
        )
      );
    }
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
        mediaReplies:
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
