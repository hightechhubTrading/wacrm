import { recordReliability } from './reliability';
export type SendOutcome =
  | { state: 'accepted'; messageId?: string; whatsappMessageId?: string }
  | { state: 'rejected'; code?: string }
  | { state: 'unknown'; code?: string };

export interface SendDraftSnapshot {
  text?: string;
  path?: string;
  replyId?: string;
  interactive?: string;
  template?: string;
}
export interface SendRecovery {
  id: string;
  kind: 'text' | 'media' | 'interactive' | 'template';
  state: 'sending' | 'rejected' | 'unknown';
  code?: string;
  original?: SendDraftSnapshot;
}

/** HTTP failure is not proof that Meta rejected a message. Ask the ledger. */
async function reconcileSendRequest(operationId: string): Promise<SendOutcome> {
  try {
    const response = await fetch(
      `/api/whatsapp/send?operation_id=${encodeURIComponent(operationId)}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await response.json();
    if (!response.ok) return { state: 'unknown' };
    if (data.outcome === 'accepted')
      return {
        state: 'accepted',
        messageId: data.message_id,
        whatsappMessageId: data.whatsapp_message_id,
      };
    if (data.outcome === 'rejected')
      return { state: 'rejected', code: data.code };
    // A missing operation can race a POST still in transit. Never infer rejection.
    return { state: 'unknown', code: data.code };
  } catch {
    return { state: 'unknown' };
  }
}

async function sendTrackedMessageRequest(
  body: Record<string, unknown>,
  operationId: string
): Promise<SendOutcome> {
  try {
    const response = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, operation_id: operationId }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success)
      return {
        state: 'accepted',
        messageId: data.message_id,
        whatsappMessageId: data.whatsapp_message_id,
      };
    if (data.outcome === 'rejected')
      return { state: 'rejected', code: data.code };
    // A conflicting request is not the operation returned by an ID-only lookup.
    // Keep this draft intact instead of mistaking an older acceptance for this send.
    if (response.status === 409)
      return { state: 'unknown', code: 'operation_conflict' };
    // Authorization/validation/rate-limit failures happen before transport.
    if (
      [400, 401, 403, 404, 429].includes(response.status) &&
      data.outcome !== 'unknown'
    )
      return { state: 'rejected', code: data.code };
  } catch {
    /* Network loss may occur after provider acceptance. */
  }
  return reconcileSend(operationId);
}

export async function reconcileSend(operationId: string): Promise<SendOutcome> {
  const started = performance.now();
  const result = await reconcileSendRequest(operationId);
  recordReliability(`reconcile.${result.state}`, performance.now() - started);
  return result;
}
export async function sendTrackedMessage(
  body: Record<string, unknown>,
  operationId: string
): Promise<SendOutcome> {
  const started = performance.now();
  const result = await sendTrackedMessageRequest(body, operationId);
  recordReliability(`send.${result.state}`, performance.now() - started);
  return result;
}
