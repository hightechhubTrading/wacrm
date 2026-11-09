import type { AccountContext } from '@/lib/auth/account';
import { NextResponse } from 'next/server';
import { customerLocation } from './customer-location';
import type { JobPerson } from './appointments';

export async function jobPeople(ctx: AccountContext) {
  const { data, error } = await ctx.supabase
    .from('profiles')
    .select('id,user_id,full_name')
    .eq('account_id', ctx.accountId)
    .in('account_role', ['owner', 'admin', 'agent'])
    .order('full_name');
  if (error) throw new Error('Could not load responsible members');
  const people = (data ?? []) as JobPerson[];
  return {
    people,
    defaultResponsibleId:
      people.find((p) => p.user_id === ctx.userId)?.id ?? null,
  };
}

export async function jobLocation(
  ctx: AccountContext,
  contactId: string | null
) {
  if (!contactId) return null;
  const { data, error } = await ctx.supabase
    .from('messages')
    .select(
      'id,sender_type,content_type,content_text,created_at,conversations!inner(contact_id,account_id)'
    )
    .eq('conversations.account_id', ctx.accountId)
    .eq('conversations.contact_id', contactId)
    .eq('sender_type', 'customer')
    .in('content_type', ['location', 'text'])
    .or('content_type.eq.location,content_text.ilike.%maps%')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);
  if (error) throw new Error('Could not load the customer location');
  for (const row of data ?? []) {
    const value = customerLocation(row);
    if (value) return { value, messageId: row.id, receivedAt: row.created_at };
  }
  return null;
}

/** Never return database internals or details of a different agent's customer. */
export function bookingError(error: { code?: string } | null) {
  if (error?.code === '23P01')
    return NextResponse.json(
      {
        error:
          'This time is already reserved in the company calendar. Choose another slot.',
        code: 'slot_unavailable',
      },
      { status: 409 }
    );
  if (error?.code === '23505')
    return NextResponse.json(
      {
        error:
          'There is already active work of this type. Open the existing request.',
        code: 'active_request',
      },
      { status: 409 }
    );
  if (error?.code === '42501')
    return NextResponse.json(
      { error: 'Job unavailable', code: 'forbidden' },
      { status: 403 }
    );
  if (error?.code === '22023' || error?.code === '23514')
    return NextResponse.json(
      {
        error:
          'Check the member, future start/end times and accepted quotation for this job.',
        code: 'invalid_booking',
      },
      { status: 400 }
    );
  console.error('[job booking] persistence failed', error?.code);
  return NextResponse.json(
    {
      error: 'Could not save this booking. Try again.',
      code: 'booking_failed',
    },
    { status: 503 }
  );
}
