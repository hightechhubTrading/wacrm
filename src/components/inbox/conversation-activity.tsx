'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useConversationActivity } from '@/hooks/use-conversation-activity';
import { Button } from '@/components/ui/button';
export function ConversationActivity({
  conversationId,
  assignedAgentId,
  onTakeOver,
}: {
  conversationId: string;
  assignedAgentId?: string;
  onTakeOver: () => Promise<unknown>;
}) {
  const t = useTranslations('Inbox.activity'),
    { user } = useAuth(),
    enabled = useCan('send-messages');
  const { peers, unavailable, now } = useConversationActivity(
    conversationId,
    enabled
  );
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  if (unavailable)
    return (
      <p role="status" className="text-muted-foreground px-4 py-1 text-xs">
        {t('unavailable')}
      </p>
    );
  if (!peers.length) return null;
  const others = peers.filter((peer) => peer.userId !== user?.id),
    self = peers.some((peer) => peer.userId === user?.id);
  const names = [
    ...new Set(others.map((peer) => peer.name || t('teammate'))),
  ].join(', ');
  const composing = others.some((peer) => peer.composingUntil > now);
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-muted/40 flex flex-wrap items-center gap-2 border-b px-4 py-2"
    >
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {others.length > 0 && (
          <p>{t(composing ? 'composing' : 'viewing', { names })}</p>
        )}
        {self && <p>{t('otherSession')}</p>}
      </div>
      {assignedAgentId !== user?.id && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onTakeOver();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('takeOver')}
        </Button>
      )}
    </div>
  );
}
