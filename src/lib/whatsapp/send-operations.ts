import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const isOperationId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}
export function sendFingerprint(body: Record<string, unknown>) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex');
}
export interface SendOperation {
  id: string;
  account_id: string;
  user_id: string;
  conversation_id: string;
  request_hash: string;
  state: 'sending' | 'accepted' | 'sent' | 'rejected' | 'unknown';
  message_id: string | null;
  whatsapp_message_id: string | null;
  error_code: string | null;
}
export function operationResponse(operation: SendOperation) {
  const accepted =
    operation.state === 'sent' ||
    operation.state === 'accepted' ||
    !!operation.whatsapp_message_id;
  return {
    success: accepted,
    outcome: accepted
      ? 'accepted'
      : operation.state === 'rejected'
        ? 'rejected'
        : 'unknown',
    operation_id: operation.id,
    message_id: operation.message_id,
    whatsapp_message_id: operation.whatsapp_message_id,
    code: operation.error_code,
  };
}
/** A unique insert, not a read-then-write lock. Duplicates never dispatch again. */
export async function claimSendOperation(
  db: SupabaseClient,
  input: Pick<
    SendOperation,
    'id' | 'account_id' | 'user_id' | 'conversation_id' | 'request_hash'
  >
) {
  const { error } = await db.from('outbound_send_operations').insert(input);
  if (!error) return { claimed: true as const };
  if (error.code !== '23505')
    throw new Error('Send-operation ledger unavailable');
  const { data, error: readError } = await db
    .from('outbound_send_operations')
    .select('*')
    .eq('id', input.id)
    .single();
  if (readError || !data) throw new Error('Send-operation ledger unavailable');
  const row = data as SendOperation;
  // Do not disclose another actor/tenant's operation, even when IDs collide.
  if (
    row.account_id !== input.account_id ||
    row.user_id !== input.user_id ||
    row.conversation_id !== input.conversation_id ||
    row.request_hash !== input.request_hash
  ) {
    return { claimed: false as const, conflict: true as const };
  }
  return { claimed: false as const, conflict: false as const, operation: row };
}
export async function settleSendOperation(
  db: SupabaseClient,
  id: string,
  patch: Partial<SendOperation>
) {
  const { error } = await db
    .from('outbound_send_operations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('Send-operation result could not be saved');
}
