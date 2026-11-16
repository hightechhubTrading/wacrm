import { validVoiceOgg } from '@/lib/inbox/voice-format';
import { randomUUID } from 'node:crypto';
import { createRequestClient } from '@/lib/supabase/request';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';
import { isOperationId } from '@/lib/whatsapp/send-operations';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  attachmentType,
  attachmentLimit,
  cleanAttachmentName,
} from '@/lib/inbox/attachment-types';

function response(request: Request, status: number, body?: unknown) {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (request.headers.get('origin') === 'https://localhost')
    Object.assign(headers, {
      'Access-Control-Allow-Origin': 'https://localhost',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  return status === 204
    ? new Response(null, { status, headers })
    : Response.json(body, { status, headers });
}
export async function OPTIONS(request: Request) {
  return response(
    request,
    request.headers.get('origin') === 'https://localhost' ? 204 : 403,
    { error: 'Origin not allowed' }
  );
}
function signatureMatches(bytes: Uint8Array, ext: string) {
  const prefix = (...values: number[]) =>
    values.every((n, i) => bytes[i] === n);
  if (ext === 'ogg') return validVoiceOgg(bytes);
  if (['jpg', 'jpeg'].includes(ext)) return prefix(255, 216, 255);
  if (ext === 'png') return prefix(137, 80, 78, 71, 13, 10, 26, 10);
  if (ext === 'pdf') return prefix(37, 80, 68, 70, 45);
  if (['docx', 'xlsx', 'pptx'].includes(ext)) return prefix(80, 75, 3, 4);
  if (['doc', 'xls', 'ppt'].includes(ext))
    return prefix(208, 207, 17, 224, 161, 177, 26, 225);
  try {
    return (
      !bytes.includes(0) &&
      !!new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    );
  } catch {
    return false;
  }
}
export async function POST(request: Request) {
  const fail = (status: number, error: string) =>
    response(request, status, { error });
  if (
    request.headers.has('origin') &&
    request.headers.get('origin') !== 'https://localhost'
  )
    return fail(403, 'Origin not allowed');
  if (
    !/^Bearer [A-Za-z0-9._-]+$/.test(request.headers.get('authorization') ?? '')
  )
    return fail(401, 'User session required');
  try {
    const db = await createRequestClient(request);
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user) return fail(401, 'Unauthorized');
    const rate = checkRateLimit(`mobile-upload:${user.id}`, RATE_LIMITS.send);
    if (!rate.success) return fail(429, 'Too many uploads. Try again shortly.');
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('account_id,account_role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (
      profileError ||
      !profile?.account_id ||
      !isAccountRole(profile.account_role) ||
      !canSendMessages(profile.account_role)
    )
      return fail(403, 'Sending requires an agent role');
    if (
      !request.headers.get('content-type')?.startsWith('multipart/form-data;')
    )
      return fail(400, 'Choose one photo or document');
    const maxBody = attachmentLimit('document') + 65536;
    if (Number(request.headers.get('content-length')) > maxBody)
      return fail(413, 'File exceeds the 16 MB upload limit');
    const reader = request.body?.getReader();
    if (!reader) return fail(400, 'Missing upload');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > maxBody) {
          await reader.cancel();
          return fail(413, 'File exceeds the 16 MB upload limit');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const form = await new Response(new Uint8Array(Buffer.concat(chunks)), {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
    const file = form.get('file');
    const conversationId = form.get('conversation_id');
    if (
      !(file instanceof File) ||
      !isOperationId(conversationId) ||
      form.getAll('file').length !== 1 ||
      [...form.keys()].some((key) => !['file', 'conversation_id'].includes(key))
    )
      return fail(400, 'Choose one file and conversation');
    const type = attachmentType(file.name, file.type);
    if (!type || file.size === 0)
      return fail(
        400,
        'Use a JPG/PNG photo, PDF, Office document or text file'
      );
    if (file.size > attachmentLimit(type.kind))
      return fail(
        413,
        type.kind === 'image'
          ? 'Photos must be 5 MB or smaller'
          : 'Documents must be 16 MB or smaller'
      );
    const { data: conversation, error: conversationError } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', profile.account_id)
      .eq('id', conversationId)
      .maybeSingle();
    if (conversationError || !conversation)
      return fail(404, 'Conversation unavailable');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!signatureMatches(bytes, type.ext))
      return fail(400, 'File contents do not match its format');
    const path = `account-${profile.account_id}/mobile-${conversationId}-${randomUUID()}.${type.ext}`;
    const bucket = db.storage.from('chat-media');
    const { error: uploadError } = await bucket.upload(path, bytes, {
      contentType: type.mime,
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError)
      return fail(502, 'Upload did not finish. No message was sent.');
    return response(request, 201, {
      mediaUrl: bucket.getPublicUrl(path).data.publicUrl,
      filename: cleanAttachmentName(file.name),
      kind: type.kind,
    });
  } catch {
    return fail(502, 'Upload did not finish. No message was sent.');
  }
}
