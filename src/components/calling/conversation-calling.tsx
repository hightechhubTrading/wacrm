'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import { callingFetch, useCalling } from './calling-provider';
import {
  canPerformCallAction,
  type CallPermissions,
  type CallRecord,
} from '@/lib/whatsapp/calling/types';

export function ConversationCalling({
  conversationId,
  name,
}: {
  conversationId: string;
  name: string;
}) {
  const t = useTranslations('Calling');
  const locale = useLocale();
  const calling = useCalling();
  const { canSendMessages } = useAuth();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [permissions, setPermissions] = useState<CallPermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissions(null);
    try {
      const history = await callingFetch<{ calls: CallRecord[] }>(
        `?conversation_id=${conversationId}`
      );
      setHistory(history.calls);
      if (calling?.enabled) {
        const result = await callingFetch<{ permissions: CallPermissions }>(
          `/permissions?conversation_id=${conversationId}`
        );
        setPermissions(result.permissions);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t('connectionFailed'));
    } finally {
      setLoading(false);
    }
  }, [conversationId, calling?.enabled, t]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  if (!canSendMessages || !calling) return null;
  const canCall =
    permissions && canPerformCallAction(permissions, 'start_call');
  const canRequest =
    permissions &&
    canPerformCallAction(permissions, 'send_call_permission_request');
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('title')}
        aria-label={t('title')}
        onClick={() => {
          setRequested(false);
          setHistory([]);
          setOpen(true);
        }}
      >
        <Phone className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('title')}</SheetTitle>
            <SheetDescription>{name}</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-6">
            {!calling.enabled ? (
              <p className="text-muted-foreground text-sm">
                {t('disabledHint')}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  {canCall ? t('permissionGranted') : t('permissionNeeded')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={loading || pending || calling.busy || !canCall}
                    onClick={async () => {
                      setPending(true);
                      setError('');
                      try {
                        await calling.start(conversationId);
                        setOpen(false);
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : t('connectionFailed')
                        );
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    <Phone />
                    {t('callCustomer')}
                  </Button>
                  {!canCall && (
                    <Button
                      variant="outline"
                      disabled={loading || pending || !canRequest || requested}
                      onClick={async () => {
                        setPending(true);
                        setError('');
                        try {
                          await callingFetch('/permissions', {
                            conversation_id: conversationId,
                            locale,
                          });
                          setRequested(true);
                          await load();
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : t('connectionFailed')
                          );
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      {t(requested ? 'requestSent' : 'requestPermission')}
                    </Button>
                  )}
                </div>
                {requested && (
                  <p className="text-muted-foreground text-xs" role="status">
                    {t('requestSentHint')}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={calling.soundEnabled}
                  onClick={() => {
                    void calling
                      .enableSound()
                      .catch((error) => setError(error.message));
                  }}
                >
                  <Volume2 />
                  {t(calling.soundEnabled ? 'soundEnabled' : 'enableRinging')}
                </Button>
              </div>
            )}
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('history')}</h3>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={loading || pending}
                  aria-label={t('refresh')}
                  onClick={() => void load()}
                >
                  <RefreshCw
                    className={
                      loading
                        ? 'size-4 animate-spin motion-reduce:animate-none'
                        : 'size-4'
                    }
                  />
                </Button>
              </div>
              {loading && (
                <p className="text-muted-foreground text-sm" role="status">
                  {t('loading')}
                </p>
              )}
              {!loading && !history.length && (
                <p className="text-muted-foreground text-sm">
                  {t('noHistory')}
                </p>
              )}
              <ul className="divide-border divide-y">
                {history.map((call) => (
                  <li key={call.id} className="flex items-center gap-3 py-3">
                    {call.direction === 'inbound' ? (
                      <PhoneIncoming className="text-muted-foreground size-4 shrink-0" />
                    ) : (
                      <PhoneOutgoing className="text-muted-foreground size-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          call.state === 'missed' || call.state === 'failed'
                            ? 'text-destructive text-sm font-medium'
                            : 'text-sm font-medium'
                        }
                      >
                        {t(call.direction)} · {t(call.state)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(call.created_at))}
                      </p>
                      {call.error_message && (
                        <p className="text-destructive mt-1 text-xs">
                          {call.error_message}
                        </p>
                      )}
                    </div>
                    {call.duration_seconds !== null && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {Math.floor(call.duration_seconds / 60)}:
                        {String(call.duration_seconds % 60).padStart(2, '0')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
