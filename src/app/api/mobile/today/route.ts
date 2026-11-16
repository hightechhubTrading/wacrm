import {
  mobileAccount,
  mobileConversation,
  mobileResponse,
  mobilePreflight,
} from '@/lib/mobile/conversation';
import { agendaDayEnd } from '@/lib/dashboard/agenda';
import { followupPatch } from '@/lib/ai/followups';
import { canSendMessages } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isOperationId } from '@/lib/whatsapp/send-operations';
export const OPTIONS = mobilePreflight;
const reply = (request: Request, status: number, body: unknown) =>
  mobileResponse(request, Response.json(body, { status }));
export async function GET(request: Request) {
  try {
    const access = await mobileAccount(request);
    if ('response' in access) return access.response;
    const { db, profile, user } = access;
    const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
      return reply(request, 400, { error: 'Invalid page' });
    const { data, error, count } = await db
      .from('ai_followups')
      .select(
        'id,kind,status,owner_id,due_at,updated_at,conversation_id,conversation:conversations!inner(status,contact:contacts(name,phone))',
        { count: 'exact' }
      )
      .eq('account_id', profile.account_id)
      .in('status', ['open', 'acknowledged', 'deferred'])
      .in('conversation.status', ['open', 'pending'])
      .or(`owner_id.eq.${user.id},owner_id.is.null`)
      .lt('due_at', agendaDayEnd())
      .order('due_at')
      .order('id')
      .range(offset, offset + 24);
    if (error)
      return reply(request, 503, { error: 'Follow-ups could not be loaded' });
    return reply(request, 200, {
      tasks: data ?? [],
      total: count ?? 0,
      nextOffset: offset + 25 < (count ?? 0) ? offset + 25 : null,
      timeZone: 'Asia/Qatar',
      canEdit: canSendMessages(profile.account_role),
    });
  } catch {
    return reply(request, 503, {
      error: 'Follow-ups are temporarily unavailable',
    });
  }
}
export async function POST(request: Request) {
  try {
    // Authenticate before parsing. All eventual service writes have an RLS gate.
    const access = await mobileAccount(request);
    if ('response' in access) return access.response;
    if (!canSendMessages(access.profile.account_role))
      return reply(request, 403, { error: 'Read-only account' });
    if (Number(request.headers.get('content-length')) > 4096)
      return reply(request, 413, { error: 'Update is too large' });
    if (
      !checkRateLimit(`mobile-task:${access.user.id}`, RATE_LIMITS.send).success
    )
      return reply(request, 429, {
        error: 'Too many updates. Please wait a moment.',
      });
    const reader = request.body?.getReader();
    if (!reader) return reply(request, 400, { error: 'Task update required' });
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 4096) {
          await reader.cancel();
          return reply(request, 413, { error: 'Update is too large' });
        }
        parts.push(p.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(parts).toString());
    if (
      !body ||
      !isOperationId(body.id) ||
      !isOperationId(body.conversation_id) ||
      typeof body.expected_updated_at !== 'string' ||
      !Number.isFinite(Date.parse(body.expected_updated_at)) ||
      !['acknowledged', 'deferred', 'completed'].includes(body.status) ||
      Object.keys(body).some(
        (k) =>
          ![
            'id',
            'conversation_id',
            'expected_updated_at',
            'status',
            'completion_evidence',
            'due_at',
          ].includes(k)
      )
    )
      return reply(request, 400, { error: 'Invalid task update' });
    const patch = followupPatch(body, access.user.id);
    if (!patch)
      return reply(request, 400, {
        error: 'Add completion details or a valid future date',
      });
    const scope = await mobileConversation(request, body.conversation_id);
    if ('response' in scope) return scope.response;
    if (
      scope.profile.account_id !== access.profile.account_id ||
      !canSendMessages(scope.profile.account_role)
    )
      return reply(request, 403, { error: 'Account access changed' });
    const { data: task, error } = await access.db
      .from('ai_followups')
      .select('id,owner_id,updated_at,status')
      .eq('id', body.id)
      .eq('conversation_id', body.conversation_id)
      .eq('account_id', access.profile.account_id)
      .maybeSingle();
    if (error || !task)
      return reply(request, 404, { error: 'Task unavailable' });
    if (task.owner_id && task.owner_id !== access.user.id)
      return reply(request, 409, {
        error: 'Another teammate owns this task. Refresh to see current work.',
      });
    if (task.updated_at !== body.expected_updated_at)
      return reply(request, 409, {
        error: 'Task changed. Refresh and try again.',
      });
    let update = supabaseAdmin()
      .from('ai_followups')
      .update(patch)
      .eq('id', body.id)
      .eq('account_id', access.profile.account_id)
      .eq('conversation_id', body.conversation_id)
      .eq('updated_at', task.updated_at)
      .in('status', ['open', 'acknowledged', 'deferred']);
    update = task.owner_id
      ? update.eq('owner_id', task.owner_id)
      : update.is('owner_id', null);
    const changed = await update.select('id').maybeSingle();
    if (changed.error)
      return reply(request, 503, { error: 'Task could not be saved' });
    if (!changed.data)
      return reply(request, 409, {
        error: 'Task changed. Refresh and try again.',
      });
    return reply(request, 200, { success: true });
  } catch (e) {
    return reply(request, e instanceof SyntaxError ? 400 : 503, {
      error:
        e instanceof SyntaxError
          ? 'Invalid task update'
          : 'Task could not be saved',
    });
  }
}
