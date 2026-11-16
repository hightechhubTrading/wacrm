import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createRequestClient } from '@/lib/supabase/request';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { isAccountRole, canSendMessages } from '@/lib/auth/roles';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  photoIdValid,
  contactPhotoUrl,
  contactPhotoPath,
  contactPhotoVersion,
} from '@/lib/contacts/photo';
const bucketName = 'contact-photos';
const maxInput = 5 * 1024 * 1024;
type Context = { params: Promise<{ id: string }> };
function allowed(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  return (
    origin === 'https://localhost' ||
    origin === new URL(request.url).origin ||
    (!!site && origin === new URL(site).origin)
  );
}
function respond(request: Request, response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Vary', 'Origin');
  if (allowed(request) && request.headers.has('origin')) {
    response.headers.set(
      'Access-Control-Allow-Origin',
      request.headers.get('origin')!
    );
    response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, DELETE, OPTIONS'
    );
    response.headers.set(
      'Access-Control-Allow-Headers',
      'authorization, content-type, if-match'
    );
  }
  return response;
}
export async function OPTIONS(request: Request) {
  return respond(
    request,
    new Response(null, { status: allowed(request) ? 204 : 403 })
  );
}
async function handle(request: Request, context: Context) {
  const fail = (status: number, error: string) =>
    respond(request, Response.json({ error }, { status }));
  if (!allowed(request)) return fail(403, 'Origin not allowed');
  const authorization = request.headers.get('authorization');
  if (authorization && !/^Bearer [A-Za-z0-9._-]+$/.test(authorization))
    return fail(401, 'Sign in required');
  const { id } = await context.params;
  if (!photoIdValid(id)) return fail(400, 'Invalid contact');
  try {
    const db = await createRequestClient(request);
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError || !user) return fail(401, 'Sign in required');
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('account_id,account_role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError || !profile?.account_id)
      return fail(403, 'Account unavailable');
    if (
      request.method !== 'GET' &&
      (!isAccountRole(profile.account_role) ||
        !canSendMessages(profile.account_role))
    )
      return fail(403, 'Editing contact photos requires an agent role');
    const { data: contact, error: contactError } = await db
      .from('contacts')
      .select('id,account_id,avatar_url')
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .maybeSingle();
    if (contactError || !contact) return fail(404, 'Contact unavailable');
    const previous = contactPhotoVersion(contact.avatar_url, id);
    if (request.method === 'GET') {
      const version = new URL(request.url).searchParams.get('v') ?? '';
      if (
        !photoIdValid(version) ||
        contact.avatar_url !== contactPhotoUrl(id, version)
      )
        return fail(404, 'Photo unavailable');
      const { data, error } = await supabaseAdmin()
        .storage.from(bucketName)
        .download(contactPhotoPath(profile.account_id, id, version));
      if (error || !data || data.size > 65536)
        return fail(404, 'Photo unavailable');
      return respond(
        request,
        new Response(await data.arrayBuffer(), {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Disposition': 'inline; filename="contact-photo.webp"',
          },
        })
      );
    }
    if (request.headers.get('if-match') !== JSON.stringify(previous))
      return fail(409, 'The contact photo changed. Refresh and try again.');
    if (
      !checkRateLimit(`contact-photo:${user.id}`, {
        limit: 10,
        windowMs: 60000,
      }).success
    )
      return fail(429, 'Too many photo changes. Please wait a moment.');
    let uploaded: string | null = null;
    let nextUrl: string | null = null;
    const bucket = supabaseAdmin().storage.from(bucketName);
    if (request.method === 'POST') {
      const mime = request.headers.get('content-type')?.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime ?? ''))
        return fail(415, 'Choose a JPG, PNG or WebP photo');
      if (Number(request.headers.get('content-length')) > maxInput)
        return fail(413, 'Choose a photo smaller than 5 MB');
      const reader = request.body?.getReader();
      if (!reader) return fail(400, 'Choose a photo');
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > maxInput) {
            await reader.cancel();
            return fail(413, 'Choose a photo smaller than 5 MB');
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!size) return fail(400, 'Choose a photo');
      const input = Buffer.concat(chunks);
      const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
      const png = input
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const webp =
        input.subarray(0, 4).toString() === 'RIFF' &&
        input.subarray(8, 12).toString() === 'WEBP';
      if (!jpeg && !png && !webp)
        return fail(400, 'Choose a valid JPG, PNG or WebP photo');
      let converted: Buffer;
      try {
        const source = sharp(input, {
          limitInputPixels: 25000000,
          animated: false,
        });
        const metadata = await source.metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
          return fail(415, 'Choose a JPG, PNG or WebP photo');
        converted = await source
          .rotate()
          .resize(256, 256, { fit: 'cover' })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        return fail(400, 'This photo could not be read. Choose another image.');
      }
      if (converted.length > 65536)
        return fail(
          413,
          'This photo is too complex. Choose a simpler or smaller image.'
        );
      const version = randomUUID();
      uploaded = contactPhotoPath(profile.account_id, id, version);
      const { error } = await bucket.upload(uploaded, converted, {
        contentType: 'image/webp',
        cacheControl: '0',
        upsert: false,
      });
      if (error)
        return fail(503, 'Photo could not be uploaded. Please try again.');
      nextUrl = contactPhotoUrl(id, version);
    }
    let update = db
      .from('contacts')
      .update({ avatar_url: nextUrl })
      .eq('id', id)
      .eq('account_id', profile.account_id);
    update =
      contact.avatar_url == null
        ? update.is('avatar_url', null)
        : update.eq('avatar_url', contact.avatar_url);
    const { data: updated, error: updateError } = await update
      .select('id')
      .maybeSingle();
    if (updateError || !updated) {
      if (uploaded) await bucket.remove([uploaded]).catch(() => {});
      return fail(
        409,
        'Contact access or photo changed. Refresh and try again.'
      );
    }
    if (photoIdValid(previous))
      await bucket
        .remove([contactPhotoPath(profile.account_id, id, previous)])
        .catch(() => {});
    return respond(request, Response.json({ avatar_url: nextUrl }));
  } catch {
    return fail(503, 'Contact photo is temporarily unavailable');
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
