import { createRequestClient } from '@/lib/supabase/request';
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';

const limit = 16 * 1024 * 1024;
const origin = 'https://localhost';
function reply(request: Request, result: Response) {
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('Vary', 'Origin');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  if (request.headers.get('origin') === origin) {
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set('Access-Control-Allow-Headers', 'authorization');
    result.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  return result;
}
export async function OPTIONS(request: Request) {
  return reply(
    request,
    new Response(null, {
      status: request.headers.get('origin') === origin ? 204 : 403,
    })
  );
}
export async function GET(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const fail = (error: string, status: number) =>
    reply(request, Response.json({ error }, { status }));
  if (request.headers.has('origin') && request.headers.get('origin') !== origin)
    return fail('Origin not allowed', 403);
  if (
    !/^Bearer [A-Za-z0-9._-]+$/.test(request.headers.get('authorization') ?? '')
  )
    return fail('User session required', 401);
  const { messageId } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      messageId
    )
  )
    return fail('Invalid message ID', 400);
  try {
    const db = await createRequestClient(request);
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user) return fail('Unauthorized', 401);
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError || !profile?.account_id)
      return fail('Account unavailable', 403);
    // A retained message ID never bypasses current conversation RLS.
    const { data: message, error: messageError } = await db
      .from('messages')
      .select('media_url,content_type')
      .eq('id', messageId)
      .maybeSingle();
    if (
      messageError ||
      !message?.media_url ||
      !['image', 'document', 'audio'].includes(message.content_type)
    )
      return fail('Attachment unavailable', 404);
    let buffer: Buffer;
    let contentType: string;
    const meta = /^\/api\/whatsapp\/media\/(\d{1,128})$/.exec(
      message.media_url
    );
    if (meta) {
      const { data: config, error: configError } = await db
        .from('whatsapp_config')
        .select('access_token')
        .eq('account_id', profile.account_id)
        .single();
      if (configError || !config) return fail('Attachment unavailable', 404);
      const accessToken = decrypt(config.access_token);
      const media = await getMediaUrl({ mediaId: meta[1], accessToken });
      ({ buffer, contentType } = await downloadMedia({
        downloadUrl: media.url,
        accessToken,
        maxBytes: limit,
        timeoutMs: 20000,
      }));
    } else {
      // Only our known public storage paths are eligible. Never proxy arbitrary
      // message URLs, redirects or user-supplied URLs; never forward a bearer.
      const url = new URL(message.media_url);
      if (
        url.protocol !== 'https:' ||
        url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin ||
        url.username ||
        url.password ||
        !/^\/storage\/v1\/object\/public\/(chat-media|flow-media|ai-media|quotation-pdfs)\/.+/.test(
          url.pathname
        )
      )
        return fail('This attachment source is not supported', 422);
      const remote = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      });
      if (!remote.ok) return fail('Attachment unavailable', 404);
      if (Number(remote.headers.get('content-length')) > limit) {
        await remote.body?.cancel();
        return fail('Attachment exceeds the 16 MB viewing limit', 413);
      }
      const reader = remote.body?.getReader();
      if (!reader) return fail('Attachment unavailable', 502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > limit) {
            await reader.cancel();
            return fail('Attachment exceeds the 16 MB viewing limit', 413);
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      buffer = Buffer.concat(chunks);
      contentType =
        remote.headers.get('content-type') ?? 'application/octet-stream';
    }
    return reply(
      request,
      new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': 'attachment',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      })
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Media exceeds limit')
      return fail('Attachment exceeds the 16 MB viewing limit', 413);
    return fail('Could not load attachment. Please retry.', 502);
  }
}
