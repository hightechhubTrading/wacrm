import { canSendMessages } from '@/lib/auth/roles';
import {
  mobileConversation,
  mobileResponse,
  mobilePreflight,
} from '@/lib/mobile/conversation';
export const OPTIONS = mobilePreflight;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const fail = (status: number, error: string) =>
    mobileResponse(request, Response.json({ error }, { status }));
  try {
    const access = await mobileConversation(request, (await context.params).id);
    if ('response' in access) return access.response;
    const { db, profile, conversation } = access;
    if (!canSendMessages(profile.account_role))
      return fail(403, 'Read-only account');
    // Bound raw input, including chunked requests, before parsing JSON.
    if (!request.body) return fail(400, 'Read snapshot required');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1024) {
          await reader.cancel();
          return fail(413, 'Read snapshot too large');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (
      !body ||
      Object.keys(body).some(
        (key) => !['unread_count', 'last_message_at'].includes(key)
      ) ||
      !Number.isSafeInteger(body.unread_count) ||
      body.unread_count < 0 ||
      !(
        body.last_message_at === null ||
        (typeof body.last_message_at === 'string' &&
          body.last_message_at.length <= 40 &&
          Number.isFinite(Date.parse(body.last_message_at)))
      )
    )
      return fail(400, 'Invalid read snapshot');
    if (
      body.unread_count !== conversation.unread_count ||
      body.last_message_at !== conversation.last_message_at
    )
      return fail(
        409,
        'Newer messages are available. Refresh before marking read.'
      );
    if (conversation.unread_count === 0)
      return mobileResponse(request, Response.json({ read: true }));
    let update = db
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', conversation.id)
      .eq('account_id', profile.account_id)
      .eq('unread_count', body.unread_count);
    update =
      body.last_message_at === null
        ? update.is('last_message_at', null)
        : update.eq('last_message_at', body.last_message_at);
    const { data, error } = await update.select('id').maybeSingle();
    if (error) return fail(503, 'Read status could not be saved');
    if (!data) return fail(409, 'Conversation changed. Refresh and try again.');
    return mobileResponse(request, Response.json({ read: true }));
  } catch (error) {
    return fail(
      error instanceof SyntaxError ? 400 : 503,
      error instanceof SyntaxError
        ? 'Invalid read snapshot'
        : 'Read status is temporarily unavailable'
    );
  }
}
