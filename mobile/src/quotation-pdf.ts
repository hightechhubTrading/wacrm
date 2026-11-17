import { db } from './client';
export async function quotationPdf(path: string, signal?: AbortSignal) {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw Error('Please sign in again.');
  const r = await fetch(
    (import.meta.env.VITE_CRM_API_URL ?? '').replace(/\/$/, '') + path,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    }
  );
  if (!r.ok)
    throw Error(
      r.status === 409
        ? 'Quotation changed. Refresh before viewing or sharing.'
        : 'PDF could not be loaded. Check your access and retry.'
    );
  if (
    r.headers.get('content-type')?.split(';')[0] !== 'application/pdf' ||
    Number(r.headers.get('content-length')) > 16 * 1024 * 1024
  ) {
    await r.body?.cancel();
    throw Error('PDF format or size is not supported.');
  }
  const reader = r.body?.getReader();
  if (!reader) throw Error('PDF unavailable');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 16 * 1024 * 1024) {
        await reader.cancel();
        throw Error('PDF is too large.');
      }
      parts.push(new Uint8Array(p.value));
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(parts, { type: 'application/pdf' });
  if (
    new TextDecoder().decode(
      new Uint8Array(await blob.slice(0, 5).arrayBuffer())
    ) !== '%PDF-'
  )
    throw Error('PDF could not be read.');
  return blob;
}
