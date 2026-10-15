'use client';

import './workspace.css';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import type { Message } from '@/types';
import { createClient } from '@/lib/supabase/client';
interface Attachment {
  pdfUrl: string;
  filename: string;
  reference: string;
  revision: number;
  alreadySent: boolean;
  conversationId: string;
}
export function QuotationAttachment({
  quotationId,
  documentId,
  conversationId,
  sessionExpired,
  onSent,
}: {
  quotationId: string;
  documentId: string;
  conversationId: string;
  sessionExpired: boolean;
  onSent: (message: Message) => void;
}) {
  const t = useTranslations('QuotationWorkspace');
  const locale = useLocale();
  const canSend = useCan('send-messages');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  function close() {
    setClosed(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('quotation');
    url.searchParams.delete('document');
    window.history.replaceState(null, '', url);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quotations/${quotationId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: Attachment) => {
        if (data.conversationId !== conversationId) throw new Error();
        setAttachment(data);
        setCaption(
          locale === 'ar'
            ? `عرض السعر ${data.reference} مرفق للمراجعة.`
            : `Please find quotation ${data.reference} attached for your review.`
        );
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(t('attachmentError'));
      });
    return () => controller.abort();
  }, [quotationId, documentId, conversationId, locale, t]);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotations/${quotationId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, conversationId, caption }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          t(data.code === 'sendUncertain' ? 'sendUncertain' : 'sendFailed')
        );
        return;
      }
      if (data.message_id) {
        const { data: message } = await createClient()
          .from('messages')
          .select('*')
          .eq('id', data.message_id)
          .eq('conversation_id', conversationId)
          .maybeSingle();
        if (message) onSent(message as Message);
      }
      close();
    } catch {
      setError(t('sendUncertain'));
    } finally {
      setBusy(false);
    }
  }
  if (closed) return null;
  return (
    <div className="qw-attachment">
      <div className="flex items-center gap-2">
        <FileText size={18} />
        <strong>{t('quotationAttachment')}</strong>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ms-auto"
          disabled={busy}
          aria-label={t('remove')}
          onClick={close}
        >
          <X size={15} />
        </Button>
      </div>
      {attachment && (
        <>
          <a href={attachment.pdfUrl} target="_blank" rel="noopener">
            {attachment.filename}
          </a>
          <p>{t('attachmentHint')}</p>
          <textarea
            aria-label={t('attachmentHint')}
            dir="auto"
            value={caption}
            maxLength={1024}
            disabled={busy || attachment.alreadySent}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={
              !canSend || busy || sessionExpired || attachment.alreadySent
            }
            onClick={send}
          >
            <Send size={15} />
            {attachment.alreadySent ? t('sent') : t('sendQuotation')}
          </Button>
        </>
      )}
      {!attachment && !error && <p>{t('loading')}</p>}
      {error && (
        <p role="alert" className="qw-error">
          {error}
        </p>
      )}
      {sessionExpired && <p>{t('sessionExpired')}</p>}
    </div>
  );
}
