import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data: quote, error } = await ctx.supabase
      .from('quotations')
      .select('client_phone,conversation_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) return toErrorResponse(error);
    if (!quote)
      return NextResponse.json(
        { error: 'Quotation not found' },
        { status: 404 }
      );

    const { data: sent, error: sentError } = await ctx.supabase
      .from('quotation_documents')
      .select('conversation_id')
      .eq('quotation_id', id)
      .eq('account_id', ctx.accountId)
      .not('sent_at', 'is', null)
      .not('conversation_id', 'is', null);
    if (sentError) return toErrorResponse(sentError);
    const sentIds = new Set<string>(
      (sent ?? []).map((row) => row.conversation_id)
    );
    const linkedIds = [...sentIds];
    if (quote.conversation_id) linkedIds.push(quote.conversation_id);

    const phone = normalizePhone(quote.client_phone);
    const conversations = () =>
      ctx.supabase
        .from('conversations')
        .select(
          'id,last_message_at,created_at,contact:contacts!inner(phone,phone_normalized)'
        )
        .eq('account_id', ctx.accountId)
        .eq('contact.account_id', ctx.accountId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('id');
    const [linked, matching] = await Promise.all([
      linkedIds.length
        ? conversations().in('id', [...new Set(linkedIds)])
        : null,
      phone ? conversations().eq('contact.phone_normalized', phone) : null,
    ]);
    if (linked?.error || matching?.error)
      return toErrorResponse(linked?.error ?? matching?.error);
    const rows = [
      ...new Map(
        [...(linked?.data ?? []), ...(matching?.data ?? [])].map((row) => [
          row.id,
          row,
        ])
      ).values(),
    ];
    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        phone: (Array.isArray(row.contact) ? row.contact[0] : row.contact)
          ?.phone,
        activityAt: row.last_message_at ?? row.created_at,
        kind: sentIds.has(row.id)
          ? 'sent'
          : row.id === quote.conversation_id
            ? 'origin'
            : 'match',
      }))
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
