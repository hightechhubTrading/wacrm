/**
 * Client for a self-hosted WAHA (WhatsApp HTTP API) instance.
 *
 * Meta's Cloud API — the only WhatsApp connection this app has
 * everywhere else — cannot send to a WhatsApp GROUP at all
 * (`recipient_type` is always `'individual'`; see
 * `src/lib/whatsapp/meta-api.ts`). WAHA is a separate, self-hosted
 * unofficial connection (its own WhatsApp number, authenticated by the
 * account admin via QR code, joined into the target group) used only
 * for this one internal-notification purpose — deliberately isolated
 * from the customer-facing Cloud API number.
 *
 * API shape (`POST /api/sendText`, `X-Api-Key` header, group `chatId`
 * ending in `@g.us`) per WAHA's docs. Supported across every WAHA
 * engine (WEBJS, WPP, GOWS, NOWEB).
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export interface SendWahaGroupTextArgs {
  baseUrl: string;
  apiKey: string;
  session: string;
  chatId: string;
  text: string;
  timeoutMs?: number;
}

export type SendWahaGroupTextResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Fire-and-forget by design — callers must never let a WAHA failure
 * block or roll back the deal move it's attached to. Never throws.
 */
export async function sendWahaGroupText(
  args: SendWahaGroupTextArgs,
): Promise<SendWahaGroupTextResult> {
  const { baseUrl, apiKey, session, chatId, text, timeoutMs } = args;

  const url = `${baseUrl.replace(/\/+$/, '')}/api/sendText`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ session, chatId, text }),
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown network error';
    return { ok: false, error: `WAHA request failed: ${message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      error: `WAHA returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    };
  }

  return { ok: true };
}

/**
 * Thrown by `sendWahaIndividualText` on any failure. Unlike
 * `sendWahaGroupText` (deliberately fire-and-forget — a best-effort
 * internal notification must never block a deal move), this is the
 * PRIMARY customer channel for a WAHA-routed conversation, so a
 * failure must surface to the caller rather than vanish silently.
 */
export class WahaSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WahaSendError';
  }
}

export interface SendWahaIndividualTextArgs {
  baseUrl: string;
  apiKey: string;
  session: string;
  /** Any phone format; digits are extracted and used as the WhatsApp
   *  individual-chat id (`<digits>@c.us`). */
  toPhone: string;
  text: string;
  timeoutMs?: number;
}

export interface SendWahaIndividualTextResult {
  ok: true;
}

/**
 * Send a plain-text message to an individual WhatsApp chat (as
 * opposed to `sendWahaGroupText`'s group `chatId`), from the given
 * agent's own WAHA `session`. Throws `WahaSendError` on any failure —
 * see the class doc above for why this differs from the group-text
 * helper's never-throws contract.
 */
export async function sendWahaIndividualText(
  args: SendWahaIndividualTextArgs,
): Promise<SendWahaIndividualTextResult> {
  const { baseUrl, apiKey, session, toPhone, text, timeoutMs } = args;

  const digits = toPhone.replace(/\D/g, '');
  const chatId = `${digits}@c.us`;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/sendText`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ session, chatId, text }),
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown network error';
    throw new WahaSendError(`WAHA request failed: ${message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new WahaSendError(
      `WAHA returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    );
  }

  return { ok: true };
}
