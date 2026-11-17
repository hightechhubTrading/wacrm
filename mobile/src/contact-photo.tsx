import { useEffect, useRef, useState } from 'react';
import { backendUrl, db } from './client';
const cache = new Map<
  string,
  { promise: Promise<Blob>; controller: AbortController }
>();
export function clearContactPhotos() {
  for (const e of cache.values()) e.controller.abort();
  cache.clear();
}
async function photo(src: string) {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw new Error('Sign in required');
  const key = `${session.user.id}:${src}`;
  if (cache.has(key)) return cache.get(key)!.promise;
  const controller = new AbortController();
  const promise = (async () => {
    const managed =
      /^\/api\/contacts\/[0-9a-f-]{36}\/photo\?v=[0-9a-f-]{36}$/i.test(src);
    const endpoint = managed
      ? (import.meta.env.VITE_CRM_API_URL ?? '').replace(/\/$/, '') + src
      : src;
    if (!managed) {
      const u = new URL(src);
      if (
        u.protocol !== 'https:' ||
        u.origin !== new URL(backendUrl).origin ||
        !u.pathname.startsWith('/storage/v1/object/public/')
      )
        throw new Error('Unsupported photo source');
    }
    const r = await fetch(endpoint, {
      ...(managed
        ? { headers: { Authorization: `Bearer ${session.access_token}` } }
        : {}),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    if (!r.ok) throw new Error('Photo unavailable');
    const mime = (r.headers.get('content-type') ?? '').split(';')[0];
    if (
      !['image/webp', 'image/jpeg', 'image/png'].includes(mime) ||
      Number(r.headers.get('content-length')) > 131072
    ) {
      await r.body?.cancel();
      throw new Error('Invalid photo');
    }
    const reader = r.body?.getReader();
    if (!reader) throw new Error('Photo unavailable');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        length += p.value.length;
        if (length > 131072) {
          await reader.cancel();
          throw new Error('Photo too large');
        }
        chunks.push(new Uint8Array(p.value));
      }
    } finally {
      reader.releaseLock();
    }
    return new Blob(chunks, { type: mime });
  })().catch((error) => {
    if (cache.get(key)?.controller === controller) cache.delete(key);
    throw error;
  });
  cache.set(key, { promise, controller });
  if (cache.size > 40) {
    const first = cache.keys().next().value!;
    cache.get(first)?.controller.abort();
    cache.delete(first);
  }
  return promise;
}
export function ContactPhoto({ src }: { src: string | null | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ src: string; url: string } | null>(
    null
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { root: el.closest('.inbox-scroll'), rootMargin: '120px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!src || !visible) return;
    let gone = false;
    let url: string | undefined;
    void photo(src)
      .then((blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        setResult({ src, url });
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, visible]);
  return (
    <span className="contact-photo-layer" ref={ref}>
      {src && visible && result?.src === src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.url}
          alt=""
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      )}
    </span>
  );
}
