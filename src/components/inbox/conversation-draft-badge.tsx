'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { useConversationDraft } from '@/hooks/use-conversation-draft';
import { draftScope } from '@/lib/inbox/drafts';

export function ConversationDraftBadge({
  conversationId,
}: {
  conversationId: string;
}) {
  const { accountId, user } = useAuth();
  if (!accountId || !user) return null;
  const scope = draftScope(accountId, user.id);
  return (
    <ScopedDraftBadge
      key={`${scope}${conversationId}`}
      scope={scope}
      conversationId={conversationId}
    />
  );
}
function ScopedDraftBadge({
  scope,
  conversationId,
}: {
  scope: string;
  conversationId: string;
}) {
  const { draft } = useConversationDraft(scope, conversationId);
  const t = useTranslations('Inbox.composer');
  if (!draft.text && !draft.attachment && !draft.interactive && !draft.recovery)
    return null;
  const label = draft.recovery
    ? draft.recovery.state === 'rejected'
      ? 'sendRejectedLabel'
      : 'sendNeedsCheck'
    : 'draftLabel';
  return <span className="text-warning me-1 font-medium">{t(label)} ·</span>;
}
