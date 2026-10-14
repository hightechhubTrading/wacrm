import type { CallPermissions } from './types';

export class CallingError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

// Calling has its own version so messaging is not silently upgraded.
const VERSION = process.env.WHATSAPP_CALLING_API_VERSION || 'v23.0';
export async function callingRequest<T>(
  config: { phone_number_id: string; access_token: string },
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(
    `https://graph.facebook.com/${VERSION}/${encodeURIComponent(config.phone_number_id)}/${path}`,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }
  );
  const result = await response.json();
  if (!response.ok || result.error) {
    const error = result.error;
    throw new CallingError(
      error?.error_data?.details ||
        error?.error_user_msg ||
        error?.message ||
        'WhatsApp calling request failed',
      502
    );
  }
  return result as T;
}
export function getCallPermissions(
  config: { phone_number_id: string; access_token: string },
  phone: string
) {
  return callingRequest<CallPermissions>(
    config,
    `call_permissions?user_wa_id=${encodeURIComponent(phone)}`
  );
}
export function callAction(
  config: { phone_number_id: string; access_token: string },
  body: Record<string, unknown>
) {
  return callingRequest<{ success?: boolean; calls?: Array<{ id: string }> }>(
    config,
    'calls',
    { messaging_product: 'whatsapp', ...body }
  );
}
