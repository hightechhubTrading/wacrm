import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { db } from './client';

type Media = { blob: Blob; type: string; url: string; cached: boolean };
type Entry = {
  controller: AbortController;
  promise: Promise<Blob>;
  blob?: Blob;
  refs: number;
};
const limit = 16 * 1024 * 1024;
let playing: HTMLAudioElement | null = null;
export function activateVoice(player: HTMLAudioElement) {
  if (playing && playing !== player) playing.pause();
  playing = player;
}
export function stopVoice() {
  playing?.pause();
  playing = null;
}
export function releaseVoice(player: HTMLAudioElement) {
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (playing === player) playing = null;
}
async function fetchBlob(id: string, signal: AbortSignal) {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw new Error('Sign in again to load this attachment.');
  const api = (import.meta.env.VITE_CRM_API_URL ?? '').replace(/\/$/, '');
  const response = await fetch(
    `${api}/api/mobile/media/${encodeURIComponent(id)}`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    }
  );
  if (!response.ok)
    throw new Error(
      response.status === 413
        ? 'This attachment exceeds the 16 MB limit.'
        : [401, 403].includes(response.status)
          ? 'Your access has changed. Refresh this chat.'
          : 'Attachment unavailable. It may have expired.'
    );
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('This attachment exceeds the 16 MB limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Attachment unavailable.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('This attachment exceeds the 16 MB limit.');
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error('The attachment is empty.');
  let type = (response.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type === 'application/ogg') type = 'audio/ogg';
  return new Blob(chunks, { type });
}
/** Per-conversation, memory-only cache; URLs are owned by each visible consumer. */
class MediaPool {
  entries = new Map<string, Entry>();
  acquire(id: string) {
    let entry = this.entries.get(id);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, refs: 0, promise: Promise.resolve(new Blob()) };
      const own = entry;
      entry.promise = fetchBlob(id, controller.signal)
        .then((blob) => {
          if (this.entries.get(id) === own) {
            own.blob = blob;
            this.prune();
          }
          return blob;
        })
        .catch((error) => {
          if (this.entries.get(id) === own) this.entries.delete(id);
          throw error;
        });
      this.entries.set(id, entry);
    } else {
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
    entry.refs++;
    const own = entry;
    return {
      promise: entry.promise,
      cached: !!entry.blob,
      release: () => {
        own.refs--;
        if (own.refs === 0 && !own.blob) {
          own.controller.abort();
          if (this.entries.get(id) === own) this.entries.delete(id);
        }
      },
    };
  }
  prune() {
    let size = [...this.entries.values()].reduce(
      (n, e) => n + (e.blob?.size ?? 0),
      0
    );
    for (const [id, entry] of this.entries) {
      if (size <= 24 * 1024 * 1024) break;
      if (entry.blob) {
        size -= entry.blob.size;
        this.entries.delete(id);
      }
    }
  }
  clear() {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }
}
const MediaContext = createContext<MediaPool | null>(null);
export function ChatMediaProvider({ children }: { children: ReactNode }) {
  const pool = useMemo(() => new MediaPool(), []);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) stopVoice();
    };
    document.addEventListener('visibilitychange', pause);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) stopVoice();
        })
      : null;
    return () => {
      stopVoice();
      pool.clear();
      document.removeEventListener('visibilitychange', pause);
      void listener?.then((h) => h.remove());
    };
  }, [pool]);
  return <MediaContext.Provider value={pool}>{children}</MediaContext.Provider>;
}
export function useChatMedia(
  id: string,
  kind: string,
  enabled: boolean,
  attempt = 0
) {
  const pool = useContext(MediaContext);
  if (!pool) throw new Error('Chat media requires a conversation provider');
  const key = `${id}:${attempt}`;
  const [state, setState] = useState<{
    key: string;
    resource?: Media;
    error?: string;
  }>({ key: '' });
  useEffect(() => {
    if (!enabled) {
      const frame = requestAnimationFrame(() => setState({ key: '' }));
      return () => cancelAnimationFrame(frame);
    }
    let disposed = false;
    let url: string | undefined;
    const handle = pool.acquire(id);
    void handle.promise
      .then((blob) => {
        if (disposed) return;
        if (
          kind === 'image' &&
          !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
            blob.type
          )
        )
          throw new Error('This image format cannot be previewed.');
        if (
          kind === 'audio' &&
          ![
            'audio/ogg',
            'audio/opus',
            'audio/mpeg',
            'audio/mp4',
            'audio/aac',
            'audio/amr',
            'audio/wav',
            'audio/webm',
          ].includes(blob.type)
        )
          throw new Error('This recording cannot be played on this device.');
        url = URL.createObjectURL(blob);
        setState({
          key,
          resource: { blob, type: blob.type, url, cached: handle.cached },
        });
      })
      .catch((error) => {
        if (!disposed)
          setState({
            key,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load attachment.',
          });
      });
    return () => {
      disposed = true;
      handle.release();
      if (url) URL.revokeObjectURL(url);
    };
  }, [pool, id, kind, enabled, attempt, key]);
  const current = enabled && state.key === key ? state : null;
  return {
    loaded: current?.resource ?? null,
    error: current?.error ?? '',
    loading: enabled && !current?.resource && !current?.error,
  };
}
