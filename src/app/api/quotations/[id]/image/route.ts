import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
import { REFERENCE_IMAGE_MAX_BYTES } from '@/lib/quotations/reference-image';
import {
  loadReferenceImage,
  normalizeReferenceImage,
  ReferenceImageError,
  REFERENCE_IMAGE_BUCKET,
} from '@/lib/quotations/reference-image-server';

type Params = { params: Promise<{ id: string }> };
async function quotationContext(id: string) {
  const ctx = await requireRole('agent');
  const { data, error } = await ctx.supabase
    .from('quotations')
    .select('id,status,assigned_to')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) throw new ReferenceImageError();
  if (!data) throw new ReferenceImageError('Quotation not found', 404);
  // Match the workspace RPC's assignment check for writes (see POST).
  return { ctx, quotation: data };
}

/** Raw file body keeps the request bounded before buffering; no multipart overhead. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, quotation } = await quotationContext(id);
    if (quotation.status !== 'draft')
      throw new ReferenceImageError('referenceImageLocked', 409);
    if (ctx.role === 'agent') {
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('id')
        .eq('user_id', ctx.userId)
        .maybeSingle();
      if (!profile || profile.id !== quotation.assigned_to)
        throw new ReferenceImageError('Forbidden', 403);
    }
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(
        request.headers.get('content-type') ?? ''
      )
    )
      throw new ReferenceImageError('referenceImageInvalid', 400);
    if (
      Number(request.headers.get('content-length')) > REFERENCE_IMAGE_MAX_BYTES
    )
      throw new ReferenceImageError('referenceImageSize', 400);
    if (!request.body)
      throw new ReferenceImageError('referenceImageInvalid', 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > REFERENCE_IMAGE_MAX_BYTES) {
          await reader.cancel();
          throw new ReferenceImageError('referenceImageSize', 400);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const { data: bytes, ...metadata } = await normalizeReferenceImage(
      Buffer.concat(chunks)
    );
    const storagePath = `${id}/${crypto.randomUUID()}.jpg`;
    const image = { storagePath, ...metadata };
    const db = supabaseAdmin();
    // Register before upload so every object has a cleanup record even on a lost response.
    const { error: registered } = await db.from('quotation_images').insert({
      storage_path: storagePath,
      quotation_id: id,
      account_id: ctx.accountId,
      image,
    });
    if (registered) throw new ReferenceImageError();
    const { error: uploaded } = await db.storage
      .from(REFERENCE_IMAGE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '0',
      });
    if (uploaded) throw new ReferenceImageError();
    const { error: activated } = await db
      .from('quotation_images')
      .update({ ready: true })
      .eq('storage_path', storagePath);
    if (activated) throw new ReferenceImageError();
    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Authenticated same-origin thumbnail; never exposes a public or signed storage URL. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx } = await quotationContext(id);
    const path = new URL(request.url).searchParams.get('path');
    const { data, error } = await ctx.supabase
      .from('quotation_images')
      .select('image')
      .eq('quotation_id', id)
      .eq('account_id', ctx.accountId)
      .eq('storage_path', path ?? '')
      .eq('ready', true)
      .eq('deleting', false)
      .maybeSingle();
    if (error) throw new ReferenceImageError();
    if (!data) throw new ReferenceImageError('referenceImageInvalid', 404);
    const bytes = await loadReferenceImage(id, ctx.accountId, data.image);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
