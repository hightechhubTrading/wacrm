import { db } from './client';
export class MobileApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public reason?: string
  ) {
    super(message);
  }
}
export async function mobileApi<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw new MobileApiError(401, 'Please sign in again.');
  const r = await fetch(
    (import.meta.env.VITE_CRM_API_URL ?? '').replace(/\/$/, '') + path,
    {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    }
  );
  const data = await r.json().catch(() => null);
  if (!r.ok)
    throw new MobileApiError(
      r.status,
      r.status === 401
        ? 'Please sign in again.'
        : r.status === 403 || r.status === 404
          ? 'Access is unavailable. Refresh or sign in again.'
          : 'Could not update. Check your connection and retry.',
      typeof data?.code === 'string' ? data.code : undefined,
      typeof data?.error === 'string' ? data.error.slice(0, 500) : undefined
    );
  return data as T;
}
