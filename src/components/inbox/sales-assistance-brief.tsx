'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Tag, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { SalesAssistanceAnalysis } from '@/lib/ai/sales-assistance-types';
import { SALES_ACTIONS } from '@/lib/ai/sales-assistance-types';
import { useCan } from '@/hooks/use-can';
// Keep runtime server-only dependencies out of the client: action values are validated locally.
export function SalesAssistanceBrief({
  conversationId,
  refreshToken = 0,
  onPrepareReply,
  sessionExpired = false,
}: {
  conversationId: string;
  refreshToken?: number;
  onPrepareReply?: () => void;
  sessionExpired?: boolean;
}) {
  const t = useTranslations('SalesAssistance');
  const can = useCan('send-messages');
  const [brief, setBrief] = useState<{
    id: string;
    analysis: SalesAssistanceAnalysis;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const db = createClient();
    const read = async () => {
      const current = ++sequence;
      const { data } = await db
        .from('ai_sales_assistance')
        .select('analysis,status')
        .eq('conversation_id', conversationId)
        .maybeSingle();
      if (!alive || current !== sequence) return;
      const a = data?.analysis as SalesAssistanceAnalysis | undefined;
      if (
        alive &&
        data?.status === 'ready' &&
        a &&
        typeof a.summary === 'string' &&
        SALES_ACTIONS.includes(a.action)
      ) {
        setBrief({ id: conversationId, analysis: a });
      } else if (alive) setBrief(null);
    };
    void read();
    const channel = db
      .channel(`sales-assistance:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_sales_assistance',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void read();
          window.dispatchEvent(
            new CustomEvent('sales-assistance-updated', {
              detail: { conversationId },
            })
          );
        }
      )
      .subscribe();
    const timer = setInterval(() => void read(), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
      void db.removeChannel(channel);
    };
  }, [conversationId, refreshToken]);
  const a = brief?.id === conversationId ? brief.analysis : null;
  if (!a) return null;
  return (
    <section className="crm-sales-assistance">
      <p className="crm-sales-assistance-label">
        {t(a.preview ? 'previewBrief' : 'prepared')}
      </p>
      <p dir="auto" className="crm-sales-assistance-summary">
        {a.summary}
      </p>
      <div className="crm-sales-assistance-facts">
        {a.tags?.map((tag) => (
          <span key={tag.id}>
            <Tag size={12} aria-hidden />
            {tag.name}
          </span>
        ))}
        {a.fields?.map((field) => (
          <span key={field.id} title={t('sourceHint')}>
            <Check size={12} aria-hidden />
            {field.name}: <bdi>{field.value}</bdi>
          </span>
        ))}
      </div>
      <p className="crm-sales-assistance-next">{t(`actions.${a.action}`)}</p>
      {a.action !== 'wait' && (
        <button
          type="button"
          disabled={!can}
          onClick={() => onPrepareReply?.()}
        >
          {t(sessionExpired ? 'openTemplates' : 'prepareReply')}
          <ArrowUpRight size={15} aria-hidden />
        </button>
      )}
    </section>
  );
}
