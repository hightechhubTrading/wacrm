// src/app/api/waha/webhook/[accountId]/[sessionName]/route.ts
//
// Inbound webhook for an agent's own WAHA session — the counterpart
// to the Meta webhook, but for real 1:1 customer conversations routed
// through a specific agent's number (see docs/superpowers/specs/
// 2026-07-29-agent-waha-channels-design.md).
//
// Deliberately narrow: text messages only, no read receipts, no
// reactions, no status events (those stay Meta-only). And crucially,
// this handler never imports runAutomationsForTrigger,
// dispatchInboundToFlows, or dispatchInboundToAiReply — WAHA-routed
// conversations get zero bot involvement BY CONSTRUCTION, not by a
// conditional flag.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  findOrCreateContact,
  findOrCreateConversation,
} from '@/lib/contacts/find-or-create';

interface WahaWebhookPayload {
  event?: string;
  session?: string;
  payload?: {
    id?: string;
    timestamp?: number;
    from?: string;
    fromMe?: boolean;
    body?: string;
    hasMedia?: boolean;
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string; sessionName: string }> },
) {
  const { accountId, sessionName } = await params;
  const secret = new URL(request.url).searchParams.get('secret');

  if (!secret) {
    return NextResponse.json({ error: 'Missing secret' }, { status: 404 });
  }

  const db = supabaseAdmin();

  const { data: agentProfile, error: profileError } = await db
    .from('profiles')
    .select('user_id, waha_webhook_secret')
    .eq('account_id', accountId)
    .eq('waha_session_name', sessionName)
    .maybeSingle();

  if (profileError || !agentProfile || !agentProfile.waha_webhook_secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let expectedSecret: string;
  try {
    expectedSecret = decrypt(agentProfile.waha_webhook_secret);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as WahaWebhookPayload | null;
  if (!body || body.event !== 'message' || !body.payload) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const { payload } = body;
  if (payload.fromMe) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  // Group chat JIDs look like `120363000000000000@g.us`, vs. an individual
  // chat's `15551234567@c.us`. Group messages are explicitly out of scope
  // for this handler (see header comment) — without this check, the digit
  // strip below would treat the group ID as if it were a phone number and
  // create a garbage contact/conversation for it.
  if ((payload.from ?? '').endsWith('@g.us')) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const fromDigits = (payload.from ?? '').replace(/\D/g, '');
  if (!fromDigits) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }
  const phone = `+${fromDigits}`;

  const contactOutcome = await findOrCreateContact(
    db,
    accountId,
    agentProfile.user_id,
    phone,
    phone,
  );
  if (!contactOutcome) {
    return NextResponse.json({ error: 'Failed to resolve contact' }, { status: 500 });
  }

  const conversationOutcome = await findOrCreateConversation(
    db,
    accountId,
    agentProfile.user_id,
    contactOutcome.contact.id,
  );
  if (!conversationOutcome) {
    return NextResponse.json({ error: 'Failed to resolve conversation' }, { status: 500 });
  }

  const contentText = payload.body ?? (payload.hasMedia ? '[media]' : '');

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversationOutcome.conversation.id,
    sender_type: 'customer',
    content_type: 'text',
    content_text: contentText,
    message_id: payload.id ?? null,
    status: 'delivered',
    channel: 'waha',
    created_at: payload.timestamp
      ? new Date(payload.timestamp * 1000).toISOString()
      : new Date().toISOString(),
  });

  if (msgError) {
    console.error('[waha webhook] error inserting message:', msgError);
    return NextResponse.json({ error: 'Failed to store message' }, { status: 500 });
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      unread_count: (conversationOutcome.conversation.unread_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationOutcome.conversation.id);

  return NextResponse.json({ status: 'received' }, { status: 200 });
}
