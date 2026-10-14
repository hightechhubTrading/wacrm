import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  nextStatus,
  needsEvidence,
  workInput,
  type WorkAction,
  type WorkAttachment,
  type GroupWork,
} from '@/lib/jobs/workflow';
type Params = { params: Promise<{ dealId: string }> };
async function context(params: Params['params']) {
  const ctx = await requireRole('agent');
  const { dealId } = await params;
  const { data: deal, error } = await ctx.supabase
    .from('deals')
    .select('id,title,contact_id,contact:contacts(name,phone)')
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) throw new Error('Deal lookup failed');
  return { ...ctx, dealId, deal };
}
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await context(params);
    if (!ctx.deal)
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    const [works, quotes] = await Promise.all([
      ctx.supabase
        .from('group_handoffs')
        .select('*,events:group_handoff_events(*)')
        .eq('account_id', ctx.accountId)
        .eq('deal_id', ctx.dealId)
        .order('created_at', { ascending: false })
        .limit(50),
      ctx.supabase
        .from('quotations')
        .select('id,reference,revision')
        .eq('account_id', ctx.accountId)
        .eq('deal_id', ctx.dealId)
        .eq('status', 'won')
        .order('created_at', { ascending: false }),
    ]);
    if (works.error || quotes.error)
      return NextResponse.json(
        { error: 'Could not load work records' },
        { status: 503 }
      );
    const admin = supabaseAdmin();
    const signed = await Promise.all(
      (works.data ?? []).map(async (work) => ({
        ...work,
        events: await Promise.all(
          (work.events ?? []).map(
            async (event: {
              attachments: WorkAttachment[];
              created_at: string;
            }) => ({
              ...event,
              attachments: await Promise.all(
                event.attachments.map(async (file) => {
                  // Only sign paths inside this authorized deal/handoff; never arbitrary user-supplied paths.
                  if (
                    !file.path.startsWith(
                      `${ctx.accountId}/${ctx.dealId}/${work.id}/`
                    )
                  )
                    return { ...file, url: undefined };
                  const { data } = await admin.storage
                    .from('job-reports')
                    .createSignedUrl(file.path, 600);
                  return { ...file, url: data?.signedUrl };
                })
              ),
            })
          )
        ),
      }))
    );
    return NextResponse.json({
      deal: ctx.deal,
      work: signed,
      quotations: quotes.data ?? [],
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await context(params);
    if (!ctx.deal)
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    const limit = checkRateLimit(`group-work:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const b = await request.json().catch(() => null);
    const input = workInput(b);
    if (!input)
      return NextResponse.json(
        { error: 'Location, details and a valid requested date are required' },
        { status: 400 }
      );
    let snapshot = null;
    let quotationId = null;
    if (input.kind === 'workshop') {
      if (typeof b.quotation_id !== 'string')
        return NextResponse.json(
          { error: 'Select an accepted quotation' },
          { status: 400 }
        );
      const { data: q, error } = await ctx.supabase
        .from('quotations')
        .select(
          'id,reference,revision,quotation_items(description,description_ar,size_w,size_h,qty,item_type,position)'
        )
        .eq('id', b.quotation_id)
        .eq('account_id', ctx.accountId)
        .eq('deal_id', ctx.dealId)
        .eq('status', 'won')
        .maybeSingle();
      if (error) throw new Error('Quotation lookup failed');
      if (!q)
        return NextResponse.json(
          { error: 'Accepted quotation not found for this deal' },
          { status: 400 }
        );
      quotationId = q.id;
      snapshot = {
        reference: q.reference,
        revision: q.revision,
        items: q.quotation_items
          .filter((i) => i.item_type === 'line')
          .sort((a, b) => a.position - b.position)
          .map(({ description, description_ar, size_w, size_h, qty }) => ({
            description,
            description_ar,
            size_w,
            size_h,
            qty,
          })),
      };
      if (!snapshot.items.length)
        return NextResponse.json(
          { error: 'The accepted quotation has no line items' },
          { status: 400 }
        );
    }
    const { data, error } = await supabaseAdmin()
      .from('group_handoffs')
      .insert({
        ...input,
        account_id: ctx.accountId,
        deal_id: ctx.dealId,
        created_by: ctx.userId,
        quotation_id: quotationId,
        quotation_snapshot: snapshot,
      })
      .select('id')
      .single();
    if (error)
      return NextResponse.json(
        {
          error:
            error.code === '23505'
              ? 'There is already active work of this type'
              : 'Could not create work request',
        },
        { status: error.code === '23505' ? 409 : 503 }
      );
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
// Bound multipart bodies before parsing; forwarded photos, documents and voice notes stay private.
async function boundedForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 21 * 1024 * 1024) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  }).formData();
}
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await context(params);
    if (!ctx.deal)
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    const limit = checkRateLimit(
      `group-work:${ctx.userId}`,
      RATE_LIMITS.bulkMediaUpload
    );
    if (!limit.success) return rateLimitResponse(limit);
    const form = await boundedForm(request).catch(() => null);
    if (!form)
      return NextResponse.json(
        { error: 'Invalid report or upload exceeds 20 MiB' },
        { status: 400 }
      );
    const id = form.get('id'),
      action = form.get('action') as WorkAction,
      note = form.get('note'),
      version = Number(form.get('revision'));
    if (
      typeof id !== 'string' ||
      typeof note !== 'string' ||
      note.length > 10000 ||
      !Number.isInteger(version) ||
      version < 0
    )
      return NextResponse.json({ error: 'Invalid update' }, { status: 400 });
    const { data: work, error: readError } = await ctx.supabase
      .from('group_handoffs')
      .select('*')
      .eq('id', id)
      .eq('deal_id', ctx.dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readError) throw new Error('Work lookup failed');
    if (!work)
      return NextResponse.json({ error: 'Work not found' }, { status: 404 });
    const status = nextStatus(work as GroupWork, action);
    if (!status)
      return NextResponse.json(
        { error: 'This action is unavailable at the current stage' },
        { status: 409 }
      );
    const files = form
      .getAll('files')
      .filter((v): v is File => v instanceof File && v.size > 0);
    if (
      files.length > 5 ||
      files.reduce((sum, f) => sum + f.size, 0) > 20 * 1024 * 1024 ||
      files.some(
        (f) =>
          f.size > 10 * 1024 * 1024 ||
          !/^(image\/(jpeg|png|webp)|audio\/(ogg|mpeg|mp4|wav|x-wav|webm)|application\/(pdf|vnd.openxmlformats-officedocument.spreadsheetml.sheet)|text\/(plain|csv))$/.test(
            f.type
          )
      )
    )
      return NextResponse.json(
        {
          error:
            'Use up to 5 photos, PDF/XLSX/text documents or audio files, 10 MiB each, 20 MiB total',
        },
        { status: 400 }
      );
    if (needsEvidence(action) && note.trim().length < 10 && !files.length)
      return NextResponse.json(
        {
          error:
            'Add a report, attachment or explanation of at least 10 characters',
        },
        { status: 400 }
      );
    const admin = supabaseAdmin();
    const attachments: WorkAttachment[] = [];
    try {
      for (const file of files) {
        const path = `${ctx.accountId}/${ctx.dealId}/${id}/${crypto.randomUUID()}`;
        const { error } = await admin.storage
          .from('job-reports')
          .upload(path, await file.arrayBuffer(), {
            contentType: file.type,
            upsert: false,
          });
        if (error) throw new Error('Report upload failed');
        attachments.push({
          path,
          name: file.name.slice(0, 200),
          size: file.size,
        });
      }
      const { data, error } = await admin.rpc('record_group_handoff_event', {
        p_account: ctx.accountId,
        p_deal: ctx.dealId,
        p_id: id,
        p_revision: version,
        p_actor: ctx.userId,
        p_action: action,
        p_status: status,
        p_note: note.trim(),
        p_attachments: attachments,
      });
      if (error) throw new Error('Could not save update');
      if (!data) {
        if (attachments.length)
          await admin.storage
            .from('job-reports')
            .remove(attachments.map((f) => f.path));
        return NextResponse.json(
          { error: 'Work changed since you opened it. Reload and try again.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      if (attachments.length)
        await admin.storage
          .from('job-reports')
          .remove(attachments.map((f) => f.path));
      throw e;
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
