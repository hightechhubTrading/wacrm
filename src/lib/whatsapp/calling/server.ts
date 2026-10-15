import { createClient } from '@supabase/supabase-js';
import type { AccountContext } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { CallingError } from './meta';

export function callingAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
export async function callingConfig(accountId: string, requireEnabled = true) {
  const { data, error } = await callingAdmin()
    .from('whatsapp_config')
    .select('phone_number_id, access_token, calling_enabled')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error)
    throw new CallingError(
      'Calling setup is incomplete. Ask an administrator to finish activation.',
      503
    );
  if (!data) throw new CallingError('Connect WhatsApp in Settings first.', 409);
  if (requireEnabled && !data.calling_enabled)
    throw new CallingError(
      'Enable CRM calling in WhatsApp settings first.',
      409
    );
  return { ...data, access_token: decrypt(data.access_token) };
}
export async function visibleConversation(ctx: AccountContext, id: string) {
  // Use the caller's RLS client before any service-role mutation.
  const { data, error } = await ctx.supabase
    .from('conversations')
    .select('id, contact_id')
    .eq('account_id', ctx.accountId)
    .eq('id', id)
    .maybeSingle();
  if (error || !data)
    throw new CallingError(
      'Conversation not found or unavailable to you.',
      404
    );
  const { data: contact } = await ctx.supabase
    .from('contacts')
    .select('phone, name, opted_out')
    .eq('account_id', ctx.accountId)
    .eq('id', data.contact_id)
    .single();
  if (!contact) throw new CallingError('Contact not found.', 404);
  return { ...data, contact };
}
export async function readCallingBody(
  request: Request
): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 100_000) throw new CallingError('Request too large.', 413);
  try {
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || typeof body !== 'object')
      throw new Error();
    return body;
  } catch {
    throw new CallingError('Invalid JSON body.', 400);
  }
}
export function requiredString(
  body: Record<string, unknown>,
  name: string,
  max = 200
): string {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new CallingError(`Invalid ${name}.`);
  return value;
}
export function requiredSdp(body: Record<string, unknown>) {
  const sdp = requiredString(body, 'sdp', 90_000);
  if (
    !sdp.startsWith('v=0') ||
    !sdp.includes('m=audio') ||
    sdp.includes('m=video')
  )
    throw new CallingError('A voice-only SDP is required.');
  return sdp;
}
