'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { SalesContext } from '@/lib/inbox/sales-context';
// Signature includes message timestamps so incoming/outgoing messages refresh read receipts independently.
export function useSalesContext(signature: string) {
  const canRead = useCan('send-messages');
  const { accountId, user } = useAuth();
  const cacheKey = `${accountId}:${user?.id}:${signature}`;
  const [state, setState] = useState<{
    signature: string;
    data: Record<string, SalesContext>;
    error: boolean;
  }>({ signature: '', data: {}, error: false });
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    const ids = signature
      .split(',')
      .filter(Boolean)
      .map((s) => s.split('|')[0]);
    let sequence = 0;
    async function load() {
      const seq = ++sequence;
      try {
        const batches = [];
        for (let i = 0; i < ids.length; i += 500)
          batches.push(ids.slice(i, i + 500));
        const result = await Promise.all(
          batches.map(async (batch) => {
            const res = await fetch('/api/inbox/sales-context', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: batch }),
              signal: controller.signal,
            });
            if (!res.ok) throw new Error('load');
            return (await res.json()) as SalesContext[];
          })
        );
        if (!controller.signal.aborted && seq === sequence)
          setState({
            signature: cacheKey,
            data: Object.fromEntries(
              result.flat().map((r) => [r.conversation_id, r])
            ),
            error: false,
          });
      } catch {
        if (!controller.signal.aborted && seq === sequence)
          setState({ signature: cacheKey, data: {}, error: true });
      }
    }
    void load();
    const refresh = () => void load();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('group-work-updated', refresh);
    window.addEventListener('sales-followups-updated', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('group-work-updated', refresh);
      window.removeEventListener('sales-followups-updated', refresh);
    };
  }, [signature, canRead, cacheKey]);
  return {
    data: state.signature === cacheKey ? state.data : {},
    error: state.signature === cacheKey && state.error,
    loading: canRead && state.signature !== cacheKey,
    available: canRead,
  };
}
